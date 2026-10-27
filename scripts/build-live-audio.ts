import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const portAudio = {
  commit: "1ca0eeedb678c3cca80f3306c474d69a7a4b5278",
  sha256: "2602de95236428dcf1329e66f1adb1b603b12d16f8d368e11f909a84ba1ccd83",
};

// Capture-only CoreAudio helper, cross-built on macOS before app signing.
// Ordinary web/Core builds and other platforms do not require a C toolchain.
export async function buildLiveAudio(platform: string, arch: string, destination: string) {
  if (platform !== "darwin") return;
  const target = ({ arm64: "arm64", x64: "x86_64" } as Record<string, string>)[arch];
  if (!target) throw new Error(`Native Live audio does not support macOS/${arch}.`);
  if (process.platform !== "darwin") throw new Error("Building Mac capture requires macOS, CMake and Xcode command line tools.");
  const cache = join(root, ".artifacts", "portaudio");
  await mkdir(cache, { recursive: true });
  // Per-build archives and source/build directories keep concurrent target
  // builds independent, including while the verified download is being written.
  // Retain build logs, including failures, for inspection.
  const work = await mkdtemp(join(cache, `${arch}-`));
  const archive = join(work, "portaudio.tar.gz");
  const response = await fetch(`https://codeload.github.com/PortAudio/portaudio/tar.gz/${portAudio.commit}`, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`PortAudio download failed (${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== portAudio.sha256) throw new Error("PortAudio source archive checksum mismatch.");
  await writeFile(archive, bytes);
  const source = join(work, `portaudio-${portAudio.commit}`);
  const build = join(work, "build");
  const run = async (name: string, command: string, args: string[], cwd: string) => {
    try {
      const result = await exec(command, args, { cwd, timeout: 180_000, maxBuffer: 16 * 1024 * 1024 });
      await writeFile(join(work, `${name}.log`), result.stdout + result.stderr);
      return result.stdout;
    } catch (error) {
      const failure = error as Error & { stdout?: string; stderr?: string };
      await writeFile(join(work, `${name}.log`), `${failure.stdout ?? ""}${failure.stderr ?? ""}\n${failure.message}\n`);
      throw new Error(`Native Live audio ${name} failed; see ${work}/${name}.log`, { cause: error });
    }
  };
  await run("extract", "/usr/bin/tar", ["-xzf", archive, "-C", work], work);
  await run("configure", "cmake", ["-S", source, "-B", build, "-DCMAKE_BUILD_TYPE=Release",
    "-DPA_BUILD_SHARED_LIBS=OFF", "-DPA_BUILD_TESTS=OFF", "-DPA_BUILD_EXAMPLES=OFF",
    `-DCMAKE_OSX_ARCHITECTURES=${target}`, "-DCMAKE_OSX_DEPLOYMENT_TARGET=13.0"], work);
  await run("portaudio", "cmake", ["--build", build, "--target", "portaudio", "--parallel", "2"], work);
  const executable = join(work, "couch-capture");
  await run("capture", "/usr/bin/clang", ["-arch", target, "-mmacosx-version-min=13.0", "-std=c11", "-O2", "-Wall", "-Wextra", "-Werror",
    `-I${join(source, "include")}`, `-I${join(source, "src/common")}`,
    join(root, "native/live-audio/capture.c"), join(build, "libportaudio.a"),
    "-framework", "CoreAudio", "-framework", "AudioToolbox", "-framework", "AudioUnit",
    "-framework", "CoreFoundation", "-framework", "CoreServices", "-o", executable], root);
  const libraryArch = (await run("library-arch", "/usr/bin/lipo", ["-archs", join(build, "libportaudio.a")], work)).trim();
  const executableArch = (await run("capture-arch", "/usr/bin/lipo", ["-archs", executable], work)).trim();
  if (libraryArch !== target || executableArch !== target) throw new Error(`Capture and PortAudio must both target ${target}.`);
  const commands = await run("deployment", "/usr/bin/otool", ["-l", executable], work);
  if (!/\bminos 13\.0(?:\.0)?\s/.test(commands)) throw new Error("Capture must target macOS 13.0.");
  const linked = await run("dependencies", "/usr/bin/otool", ["-L", executable], work);
  if (linked.split("\n").slice(1).some(line => line.trim() && !/^\s*\/(?:System\/Library\/|usr\/lib\/)/.test(line)))
    throw new Error("Capture must link PortAudio statically and use only system libraries.");
  // Discovery opens no stream and changes no device settings. Do not execute a
  // cross-built slice or treat discovery as permission/runtime capture coverage.
  const nativeSmoke = arch === process.arch;
  if (nativeSmoke && !Array.isArray(JSON.parse(await run("smoke", executable, ["--list"], work)))) throw new Error("Capture discovery did not return an input list.");
  await run("sign", "/usr/bin/codesign", ["--force", "--sign", "-", executable], work);
  await run("verify-signature", "/usr/bin/codesign", ["--verify", "--strict", executable], work);
  await mkdir(destination, { recursive: true });
  await copyFile(executable, join(destination, "couch-capture"));
  await copyFile(join(source, "LICENSE.txt"), join(destination, "PortAudio-LICENSE.txt"));
  await writeFile(join(destination, "NOTICE.txt"), `Couch host audio capture\nPortAudio (MIT-style license): https://github.com/PortAudio/portaudio/tree/${portAudio.commit}\nUnmodified static PortAudio, ${target}, macOS 13.0 or later.\nSee PortAudio-LICENSE.txt.\n`);
  await writeFile(join(destination, "build-info.json"), JSON.stringify({ platform, arch, target, deploymentTarget: "13.0", portAudio,
    libraryArch, executableArch, nativeSmoke, signature: "ad-hoc verified before app signing",
    captureSha256: createHash("sha256").update(await readFile(join(root, "native/live-audio/capture.c"))).digest("hex"),
    queueSha256: createHash("sha256").update(await readFile(join(root, "native/live-audio/capture-queue.h"))).digest("hex"),
    executableSha256: createHash("sha256").update(await readFile(executable)).digest("hex"),
  }, null, 2) + "\n");
  console.log(`Built native Live audio for ${platform}/${arch}`);
}

if (import.meta.main) await buildLiveAudio(process.platform, process.arch, join(root, "build/live-audio"));
