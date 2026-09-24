import { strict as assert } from "node:assert";
import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import inputs from "../packaging/inputs.json";
import { binaryArchitectures } from "./desktop-payload";

const resources = "src-tauri/resources";
const staging = ".artifacts/package-tools/windows";
const hash = async (path: string) => new Bun.CryptoHasher("sha256").update(await Bun.file(path).arrayBuffer()).digest("hex");

function run(command: string[]) {
  const result = Bun.spawnSync(command, { stderr: "inherit" });
  assert.equal(result.exitCode, 0, `Failed: ${command.join(" ")}`);
  return result.stdout.toString();
}

async function download(input: { url: string; sha256: string }, name: string) {
  const path = join(staging, name);
  if (await Bun.file(path).exists() && await hash(path) === input.sha256) return path;
  const response = await fetch(input.url, { signal: AbortSignal.timeout(120_000) });
  assert.ok(response.ok, `Download failed: ${input.url} (${response.status})`);
  await Bun.write(path, response);
  assert.equal(await hash(path), input.sha256, `SHA-256 mismatch: ${input.url}`);
  return path;
}

export async function stageWindowsNative() {
  const tools = join(resources, "tools");
  const native = join(resources, "windows-native");
  const notices = join(resources, "notices", "windows-native");
  await Promise.all([mkdir(staging, { recursive: true }), mkdir(tools, { recursive: true }), mkdir(native, { recursive: true }), mkdir(notices, { recursive: true })]);

  const mpvArchive = await download(inputs.windowsTools.mpv, "mpv-dev.7z");
  run(["7zz", "x", "-y", `-o${staging}`, mpvArchive, "libmpv-2.dll"]);
  const mpv = join(native, "libmpv-2.dll");
  await cp(join(staging, "libmpv-2.dll"), mpv);
  assert.equal(await hash(mpv), "9f3d750132d7cb83ba7680e6f13421dcc32c5e7f118986dfa720b207d12ca3c7");
  const exports = [...run(["llvm-readobj", "--coff-exports", mpv]).matchAll(/^  Name: (mpv_[A-Za-z0-9_]+)$/gm)].map(match => match[1]!);
  assert.ok(exports.length >= 40, "The pinned libmpv DLL has too few API exports");
  const definitions = join(native, "mpv.def");
  await Bun.write(definitions, `LIBRARY libmpv-2.dll\nEXPORTS\n${[...new Set(exports)].sort().join("\n")}\n`);
  run(["llvm-dlltool", "-m", "i386:x86-64", "-d", definitions, "-l", join(native, "mpv.lib")]);

  await cp(await download(inputs.windowsTools["yt-dlp"], "yt-dlp.exe"), join(tools, "yt-dlp.exe"));
  const denoArchive = await download(inputs.windowsTools.deno, "deno.zip");
  run(["unzip", "-o", "-q", denoArchive, "deno.exe", "-d", staging]);
  await cp(join(staging, "deno.exe"), join(tools, "deno.exe"));

  const ffmpegArchive = await download(inputs.windowsTools.ffprobe, "ffmpeg.tar.gz");
  run(["tar", "-xzf", ffmpegArchive, "-C", staging]);
  const runtimeDlls = ["libvpl-2.dll", "libwinpthread-1.dll", "libgcc_s_seh-1.dll", "libstdc++-6.dll", "libopenh264-7.dll"];
  for (const name of ["ffprobe.exe", ...runtimeDlls]) await cp(join(staging, name), join(tools, name));
  for (const name of ["COPYING.LGPLv2.1", "SOURCE.txt", "LIBVPL-LICENSE.txt", "LIBWINPTHREAD-LICENSE.txt", "LIBOPENH264-LICENSE.txt", "GCC-LICENSE.txt"]) await cp(join(staging, name), join(notices, name));
  for (const [name, source] of [["LICENSE.LGPL", "72b672113d642cbb8ef5dcc76938db801983c56e50b1400ab930f1a64d6dc8d9"], ["Copyright", "bfe9ee4cceabcb8ecbfadf208d04156f73d801e6a57369a5606bb8341e204a23"]] as const) {
    const url = `https://raw.githubusercontent.com/mpv-player/mpv/c64675679925df40c3cbecb49bdfb9c93f918745/${name}`;
    await cp(await download({ url, sha256: source }, `mpv-${name}`), join(notices, `mpv-${name}`));
  }
  for (const name of ["yt-dlp-LICENSE", "yt-dlp-NOTICES.txt", "deno-LICENSE.md"]) {
    const notice = inputs.notices.find(input => input.name === name)!;
    await cp(await download(notice, name), join(resources, "notices", name));
  }
  for (const name of ["yt-dlp.exe", "deno.exe", "ffprobe.exe", ...runtimeDlls]) assert.deepEqual(await binaryArchitectures(join(tools, name)), ["x86_64"], `Wrong architecture: ${name}`);
  assert.deepEqual(await binaryArchitectures(mpv), ["x86_64"], "Wrong libmpv architecture");
  const helpers = {
    "yt-dlp": { version: "2026.08.19", sha256: await hash(join(tools, "yt-dlp.exe")), archiveSha256: inputs.windowsTools["yt-dlp"].sha256 },
    deno: { version: "2.9.6", sha256: await hash(join(tools, "deno.exe")), archiveSha256: inputs.windowsTools.deno.sha256 },
    ffprobe: { version: "8.1.2", sha256: await hash(join(tools, "ffprobe.exe")), archiveSha256: inputs.windowsTools.ffprobe.sha256 },
  };
  await Bun.write(join(resources, "tools.json"), JSON.stringify(helpers, null, 2));
  await Bun.write(join(resources, "windows-native.json"), JSON.stringify({ mpv: { url: inputs.windowsTools.mpv.url, archiveSha256: inputs.windowsTools.mpv.sha256, revision: "c64675679925df40c3cbecb49bdfb9c93f918745", bundledSha256: await hash(mpv) }, ffprobe: inputs.windowsTools.ffprobe, runtimeDlls: await Promise.all(runtimeDlls.map(async name => ({ name, sha256: await hash(join(tools, name)) }))) }, null, 2));
  return { mpv, helpers };
}
