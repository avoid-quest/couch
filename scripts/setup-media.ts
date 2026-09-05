import { chmod, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { identifier } from "../src-tauri/tauri.conf.json";

const ytDlpVersion = "2026.08.19";
const denoVersion = "2.9.6";
const targets: Record<string, string> = {
  "linux-x64": "x86_64-unknown-linux-gnu",
  "linux-arm64": "aarch64-unknown-linux-gnu",
  "darwin-x64": "x86_64-apple-darwin",
  "darwin-arm64": "aarch64-apple-darwin",
};

export function mediaToolsDirectory(platform = process.platform, home = homedir(), dataHome = process.env.XDG_DATA_HOME) {
  if (platform === "darwin") return join(home, "Library/Application Support", identifier, "tools");
  if (platform === "linux") return join(dataHome && isAbsolute(dataHome) ? dataHome : join(home, ".local/share"), identifier, "tools");
  throw new Error("Media setup supports Linux and macOS on x64 or arm64.");
}

export function mediaReleases(platform = process.platform, arch = process.arch) {
  const target = targets[`${platform}-${arch}`];
  if (!target) throw new Error("Media setup supports Linux and macOS on x64 or arm64.");
  const ytDlpFile = platform === "darwin" ? "yt-dlp_macos" : arch === "arm64" ? "yt-dlp_linux_aarch64" : "yt-dlp_linux";
  const denoFile = `deno-${target}.zip`;
  return [
    { name: "yt-dlp", file: ytDlpFile, version: ytDlpVersion, base: `https://github.com/yt-dlp/yt-dlp/releases/download/${ytDlpVersion}`, sums: "SHA2-256SUMS" },
    { name: "deno", file: denoFile, version: denoVersion, base: `https://github.com/denoland/deno/releases/download/v${denoVersion}`, sums: `${denoFile}.sha256sum` },
  ];
}

type FetchRelease = (url: string, options: RequestInit) => Promise<Response>;

async function download(url: string, limit: number, fetchRelease: FetchRelease) {
  const response = await fetchRelease(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}): ${url}`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return Buffer.concat(chunks);
      size += value.length;
      if (size > limit) throw new Error(`Download exceeds ${limit} bytes: ${url}`);
      chunks.push(value);
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
}

async function run(command: string[]) {
  const child = Bun.spawn(command, { stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 30_000, killSignal: "SIGKILL" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(`${command[0]} failed: ${stderr.trim() || `exit ${code}`}`);
  return stdout.trim();
}

export async function installMediaTools(directory = mediaToolsDirectory(), fetchRelease: FetchRelease = fetch) {
  const releases = mediaReleases();
  const unzip = Bun.which("unzip");
  if (!unzip) throw new Error("Install unzip, then run bun run setup:media again.");
  directory = resolve(directory);
  await mkdir(directory, { recursive: true });
  const staging = await mkdtemp(join(directory, ".setup-"));
  try {
    for (const release of releases) {
      console.log(`Downloading ${release.name} ${release.version} for ${process.platform}/${process.arch}...`);
      const manifest = (await download(`${release.base}/${release.sums}`, 64 * 1024, fetchRelease)).toString();
      const checksums = manifest.split(/\r?\n/).map(line => /^([a-f0-9]{64})[ \t]+\*?(.+)$/i.exec(line)).filter(match => match?.[2] === release.file);
      if (checksums.length !== 1) throw new Error(`Missing or ambiguous SHA-256 checksum for ${release.file}`);
      const bytes = await download(`${release.base}/${release.file}`, 128 * 1024 * 1024, fetchRelease);
      if (new Bun.CryptoHasher("sha256").update(bytes).digest("hex") !== checksums[0]![1]!.toLowerCase()) throw new Error(`SHA-256 checksum mismatch for ${release.file}`);
      const executable = join(staging, release.name);
      if (release.name === "deno") {
        const archive = join(staging, release.file);
        await Bun.write(archive, bytes);
        await run([unzip, "-q", archive, "deno", "-d", staging]);
      } else await Bun.write(executable, bytes);
      await chmod(executable, 0o755);
      const version = await run([executable, ...(release.name === "yt-dlp" ? ["--ignore-config", "--no-plugin-dirs"] : []), "--version"]);
      if (release.name === "yt-dlp" ? version !== release.version : !version.startsWith(`deno ${release.version} `)) throw new Error(`Unexpected ${release.name} version: ${version}`);
    }
    for (const release of releases) await rename(join(staging, release.name), join(directory, release.name));
  } finally { await rm(staging, { recursive: true, force: true }); }
  console.log(`Installed yt-dlp ${ytDlpVersion} and Deno ${denoVersion} in ${directory}`);
  return directory;
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== "--dir" || !args[1])) throw new Error("Usage: bun run setup:media [--dir /path/to/tools]");
    await installMediaTools(args[1]);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
