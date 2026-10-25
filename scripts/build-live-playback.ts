import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Linux playback helper. Links the system libpulse; never starts an audio server. */
export async function buildLivePlayback(platform: string, arch: string, destination: string) {
  if (platform !== "linux") return;
  if (process.platform !== "linux" || arch !== process.arch || !["x64", "arm64"].includes(arch))
    throw new Error(`Build native Live playback for ${arch} on a ${arch} Linux machine.`);
  const cache = join(root, ".artifacts", "native-playback");
  await mkdir(cache, { recursive: true });
  const work = await mkdtemp(join(cache, `${arch}-`));
  const source = join(root, "native/live-audio/playback");
  const files = ["playback.cpp", "pulse_sink.cpp", "pcm_volume.cpp", "sink_recovery.cpp", "audio_sink.cpp"];
  const headers = ["pulse_sink.h", "clock-servo.h", "pcm_volume.h", "sink_recovery.h", "audio_sink.h", "null_sink.h", "log.h", "adapter/sendspin/client.h"];
  let flags: string[];
  try { flags = (await exec("pkg-config", ["--cflags", "--libs", "libpulse"], { timeout: 5000 })).stdout.trim().split(/\s+/); }
  catch (cause) { throw new Error("Native Live playback needs a C++20 compiler, pkg-config and libpulse development headers.", { cause }); }
  const executable = join(work, "couch-playback");
  const args = ["-std=c++20", "-O2", "-Wall", "-Wextra", "-Werror", "-ffunction-sections", "-fdata-sections", "-Wl,--gc-sections",
    `-I${source}`, `-I${join(source, "adapter")}`, ...files.map(file => join(source, file)), ...flags, "-pthread", "-o", executable];
  try {
    const result = await exec(process.env.CXX || "c++", args, { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
    await writeFile(join(work, "build.log"), result.stdout + result.stderr);
  } catch (cause) {
    const error = cause as Error & { stdout?: string; stderr?: string };
    await writeFile(join(work, "build.log"), `${error.stdout ?? ""}${error.stderr ?? ""}\n${error.message}\n`);
    throw new Error(`Native Live playback build failed; see ${work}/build.log`, { cause });
  }
  await mkdir(destination, { recursive: true });
  await copyFile(executable, join(destination, "couch-playback"));
  await copyFile(join(source, "LICENSE"), join(destination, "Sendspin-CLI-LICENSE.txt"));
  const sources = Object.fromEntries(await Promise.all([...files, ...headers].map(async file => [file, createHash("sha256").update(await readFile(join(source, file))).digest("hex")])));
  await writeFile(join(destination, "playback-build-info.json"), JSON.stringify({ platform, arch, sources,
    upstream: JSON.parse(await readFile(join(source, "upstream-pins.json"), "utf8")),
    executableSha256: createHash("sha256").update(await readFile(executable)).digest("hex"),
  }, null, 2) + "\n");
}

if (import.meta.main) await buildLivePlayback(process.platform, process.arch, join(root, "build/live-audio"));
