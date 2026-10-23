import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Upstream's Mac release binaries target macOS 26. Build its unmodified source
// for Couch's oldest supported Mac instead; no runtime compiler or download.
const quickjs = { version: "0.17.0", commit: "6d46d07d04041b40f4f49eaa7fdebe44c314c699", repository: "https://github.com/quickjs-ng/quickjs" };

export async function buildQuickJS(platform: string, arch: string, destination: string) {
  if (platform !== "darwin") return;
  const target = ({ arm64: "arm64", x64: "x86_64" } as Record<string, string>)[arch];
  if (!target) throw new Error(`The bundled QuickJS does not support macOS/${arch}.`);
  if (process.platform !== "darwin") throw new Error("Building Couch's Mac QuickJS requires macOS, CMake and Xcode command line tools.");
  const artifacts = join(root, ".artifacts");
  await mkdir(artifacts, { recursive: true });
  // Per-build source/build trees also keep concurrent architecture builds independent.
  const work = await mkdtemp(join(artifacts, `quickjs-${arch}-`));
  const source = join(work, "source"), build = join(work, "build");
  const run = (command: string, args: string[]) => exec(command, args, { cwd: work, maxBuffer: 16 * 1024 * 1024 });
  try {
    await run("git", ["init", "--quiet", source]);
    await run("git", ["-C", source, "fetch", "--quiet", "--depth", "1", quickjs.repository, quickjs.commit]);
    await run("git", ["-C", source, "checkout", "--quiet", "--detach", "FETCH_HEAD"]);
    if ((await run("git", ["-C", source, "rev-parse", "HEAD"])).stdout.trim() !== quickjs.commit) throw new Error("QuickJS source does not match the pinned commit.");
    await run("cmake", ["-S", source, "-B", build, "-DCMAKE_BUILD_TYPE=Release", "-DBUILD_SHARED_LIBS=OFF", `-DCMAKE_OSX_ARCHITECTURES=${target}`, "-DCMAKE_OSX_DEPLOYMENT_TARGET=14.0"]);
    await run("cmake", ["--build", build, "--target", "qjs_exe", "--parallel"]);
    const executable = join(build, "qjs");
    if ((await run("lipo", ["-archs", executable])).stdout.trim() !== target) throw new Error(`QuickJS is not a ${target} executable.`);
    const commands = (await run("otool", ["-l", executable])).stdout;
    if (!/\bminos 14\.0(?:\.0)?\s/.test(commands)) throw new Error("QuickJS does not declare macOS 14.0 as its deployment target.");
    // Only the host's native slice is executed here; x64 on an ARM runner is cross-built.
    if (arch === process.arch && (await run(executable, ["-e", "console.log(1 + 1)"])).stdout.trim() !== "2") throw new Error("The bundled QuickJS did not run.");
    await mkdir(destination, { recursive: true });
    await copyFile(executable, join(destination, "qjs"));
    await copyFile(join(source, "LICENSE"), join(destination, "LICENSE"));
    await writeFile(join(destination, "NOTICE.txt"), `QuickJS-NG ${quickjs.version} (MIT)\n${quickjs.repository}/tree/${quickjs.commit}\nUnmodified upstream source, built for ${target}, macOS 14.0 or later.\n`);
    console.log(`Built QuickJS-NG ${quickjs.version} for macOS/${arch}`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

if (import.meta.main) await buildQuickJS(process.platform, process.arch, join(root, "build/quickjs"));
