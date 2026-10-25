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

// Capture-only CoreAudio helper, built on its target Mac before app signing.
// Ordinary web/Core builds and other platforms do not require a C toolchain.
export async function buildLiveAudio(platform: string, arch: string, destination: string) {
  if (platform !== "darwin") return;
  if (process.platform !== "darwin" || arch !== process.arch || !["arm64", "x64"].includes(arch))
    throw new Error(`Build native Live audio for ${arch} on a ${arch} Mac with Xcode command-line tools.`);
  const cache = join(root, ".artifacts", "portaudio");
  await mkdir(cache, { recursive: true });
  const archive = join(cache, `${portAudio.commit}.tar.gz`);
  let bytes = await readFile(archive).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    return undefined;
  });
  if (!bytes) {
    const response = await fetch(`https://codeload.github.com/PortAudio/portaudio/tar.gz/${portAudio.commit}`, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`PortAudio download failed (${response.status}).`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (createHash("sha256").update(bytes).digest("hex") !== portAudio.sha256) throw new Error("PortAudio source archive checksum mismatch.");
  await writeFile(archive, bytes);
  // Fresh source/build directories avoid reusing another architecture's objects.
  // Retain build logs, including failures, for inspection.
  const work = await mkdtemp(join(cache, `${arch}-`));
  const source = join(work, `portaudio-${portAudio.commit}`);
  const run = async (name: string, command: string, args: string[], cwd: string) => {
    try {
      const result = await exec(command, args, { cwd, timeout: 180_000, maxBuffer: 16 * 1024 * 1024 });
      await writeFile(join(work, `${name}.log`), result.stdout + result.stderr);
    } catch (error) {
      const failure = error as Error & { stdout?: string; stderr?: string };
      await writeFile(join(work, `${name}.log`), `${failure.stdout ?? ""}${failure.stderr ?? ""}\n${failure.message}\n`);
      throw new Error(`Native Live audio ${name} failed; see ${work}/${name}.log`, { cause: error });
    }
  };
  await run("extract", "/usr/bin/tar", ["-xzf", archive, "-C", work], work);
  await run("configure", "./configure", ["--disable-shared", "--enable-static", "--disable-mac-universal"], source);
  await run("portaudio", "/usr/bin/make", ["-j2", "lib/libportaudio.la"], source);
  const executable = join(work, "couch-capture");
  await run("capture", "/usr/bin/clang", ["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror",
    `-I${join(source, "include")}`, `-I${join(source, "src/common")}`,
    join(root, "native/live-audio/capture.c"), join(source, "lib/.libs/libportaudio.a"),
    "-framework", "CoreAudio", "-framework", "AudioToolbox", "-framework", "AudioUnit",
    "-framework", "CoreFoundation", "-framework", "CoreServices", "-o", executable], root);
  await mkdir(destination, { recursive: true });
  await copyFile(executable, join(destination, "couch-capture"));
  await copyFile(join(source, "LICENSE.txt"), join(destination, "PortAudio-LICENSE.txt"));
  await writeFile(join(destination, "build-info.json"), JSON.stringify({ platform, arch, portAudio,
    captureSha256: createHash("sha256").update(await readFile(join(root, "native/live-audio/capture.c"))).digest("hex"),
    queueSha256: createHash("sha256").update(await readFile(join(root, "native/live-audio/capture-queue.h"))).digest("hex"),
    executableSha256: createHash("sha256").update(await readFile(executable)).digest("hex"),
  }, null, 2) + "\n");
  console.log(`Built native Live audio for ${platform}/${arch}`);
}

if (import.meta.main) await buildLiveAudio(process.platform, process.arch, join(root, "build/live-audio"));
