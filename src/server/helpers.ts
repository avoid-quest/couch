import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { access, constants, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, delimiter, dirname, join } from "node:path";
import { unzipSync } from "fflate";

// Core's media helpers. It uses the system's copy when it is recent enough.
// Otherwise it downloads the official build into <data>/helpers/<name>/<version>,
// checks its SHA-256 and that it runs. yt-dlp is kept at its latest release, and
// a helper that goes missing or stops working is downloaded again. mpv is fetched only
// when a channel needs it (#644 ticket 1); Linux has no official build, so it uses the system's.
export type Helper = "yt-dlp" | "qjs" | "ffmpeg" | "mpv";
type Release = { version: string; url: string; sha256: string };

const names: Helper[] = ["yt-dlp", "qjs", "ffmpeg"];
const exe = process.platform === "win32" ? ".exe" : "";
// Official builds per system: yt-dlp's and QuickJS-NG's own releases; for ffmpeg,
// which publishes source only, Martin Riedl's builds on macOS and Linux and
// BtbN's (linked from ffmpeg.org) on Windows.
const assets = ({
  "darwin-arm64": ["yt-dlp_macos.zip", "qjs-darwin-arm64", "macos/arm64", "macos-14-arm"],
  "darwin-x64": ["yt-dlp_macos.zip", "qjs-darwin-x86_64", "macos/amd64", "macos-15-intel"],
  "linux-arm64": ["yt-dlp_linux_aarch64.zip", "qjs-linux-aarch64", "linux/arm64", ""],
  "linux-x64": ["yt-dlp_linux.zip", "qjs-linux-x86_64", "linux/amd64", ""],
  "win32-arm64": ["yt-dlp_win_arm64.zip", "qjs-windows-x86_64.exe", "winarm64", "aarch64-pc-windows-msvc"],
  "win32-x64": ["yt-dlp_win.zip", "qjs-windows-x86_64.exe", "win64", "x86_64-pc-windows-msvc"],
} as Record<string, [string, string, string, string]>)[`${process.platform}-${process.arch}`];

async function get(url: string) {
  const response = await fetch(url, { headers: { "User-Agent": "Couch" }, signal: AbortSignal.timeout(300_000) });
  if (!response.ok) throw new Error(`${new URL(url).host} answered ${response.status}`);
  return response;
}

async function github(repo: string, pick: (name: string) => boolean): Promise<Release & { name: string }> {
  const release = await (await get(`https://api.github.com/repos/${repo}/releases/latest`)).json() as { tag_name: string; assets: Array<{ name: string; browser_download_url: string; digest?: string }> };
  const asset = release.assets.filter(asset => pick(asset.name)).sort((a, b) => b.name.localeCompare(a.name, "en", { numeric: true }))[0];
  // GitHub records each asset's SHA-256 when it is uploaded.
  if (!asset?.digest?.startsWith("sha256:")) throw new Error(`${repo} has no verifiable build for this system`);
  return { name: asset.name, version: release.tag_name, url: asset.browser_download_url, sha256: asset.digest.slice(7) };
}

async function latest(name: Helper): Promise<Release> {
  if (!assets) throw new Error(`Couch can't download ${name} for this system`);
  const [ytDlp, qjs, ffmpeg, mpv] = assets;
  if (name === "yt-dlp") return github("yt-dlp/yt-dlp", asset => asset === ytDlp);
  if (name === "mpv") {
    if (!mpv) throw new Error("This channel needs mpv, which has no official build for this system. Install the mpv package.");
    return github("mpv-player/mpv", asset => new RegExp(`^mpv-v[\\d.]+-${mpv}\\.zip$`).test(asset));
  }
  if (name === "qjs") return github("quickjs-ng/quickjs", asset => asset === qjs);
  if (process.platform === "win32") {
    const build = await github("BtbN/FFmpeg-Builds", asset => new RegExp(`^ffmpeg-n([\\d.]+)-latest-${ffmpeg}-gpl-\\1\\.zip$`).test(asset));
    return { ...build, version: build.name.split("-")[1]! };
  }
  // Martin Riedl publishes a .sha256 beside each build; the macOS build is also signed (see verify).
  // Its "latest" link redirects to the versioned build; HEAD requests there can answer 404.
  const redirect = await fetch(`https://ffmpeg.martin-riedl.de/redirect/latest/${ffmpeg}/release/ffmpeg.zip`, { redirect: "manual", signal: AbortSignal.timeout(30_000) });
  const location = redirect.headers.get("location");
  if (!location) throw new Error(`ffmpeg.martin-riedl.de answered ${redirect.status}`);
  const url = new URL(location, redirect.url).href;
  const sha256 = (await (await get(`${url}.sha256`)).text()).split(/\s/)[0]!;
  return { version: /_([^/]+)\/ffmpeg\.zip$/.exec(url)?.[1] ?? "release", url, sha256 };
}

function run(path: string, args: string[]): Promise<string | null> {
  // A fresh macOS download takes seconds to pass its first security scan.
  // A file that isn't a program throws from execFile itself on macOS (ENOEXEC).
  return new Promise(resolve => {
    try { execFile(path, args, { timeout: 60_000 }, (error, stdout) => resolve(error ? null : stdout.trim().split("\n")[0]!)); }
    catch { resolve(null); }
  });
}

const version = (name: Helper, path: string) => run(path, [name === "ffmpeg" ? "-version" : "--version"]);
const tar = (file: string, directory: string) => new Promise<void>((resolve, reject) => execFile("tar", ["-xzf", file, "-C", directory], error => error ? reject(error) : resolve()));

function recentEnough(name: Helper, found: string, current?: string) {
  if (name === "yt-dlp") return !current || found >= current;
  // Older QuickJS-NG builds lack the optimisations yt-dlp's challenge solver needs.
  const [major = 0, minor = 0] = found.split(".").map(Number);
  if (name === "qjs") return /^\d+\.\d+\.\d+$/.test(found) && (major > 0 || minor >= 12);
  if (name === "mpv") return Number(/^mpv v?0\.(\d+)/.exec(found)?.[1] ?? 99) >= 35;
  return Number(/^ffmpeg version n?(\d+)\./.exec(found)?.[1]) >= 7;
}

async function onPath(name: Helper) {
  for (const directory of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    const path = join(directory, name + exe);
    if (await access(path, constants.X_OK).then(() => true, () => false)) return path;
  }
  return null;
}

// The executable is the one top-level file; yt-dlp keeps its libraries in _internal beside it.
// mpv ships an app bundle on macOS and its DLLs beside mpv.exe on Windows.
async function executable(directory: string, name?: Helper) {
  if (name === "mpv") {
    const path = join(directory, process.platform === "darwin" ? "mpv.app/Contents/MacOS/mpv" : "mpv.exe");
    return await access(path).then(() => path, () => null);
  }
  const file = (await readdir(directory, { withFileTypes: true }).catch(() => [])).find(entry => entry.isFile());
  return file ? join(directory, file.name) : null;
}

let root = "";

// The newest installed copy that runs. Older copies are removed here, a check
// after the update, so a yt-dlp run that started before it can finish.
async function installed(name: Helper) {
  const directory = join(root, name);
  let found: { version: string; path: string } | null = null;
  for (const entry of (await readdir(directory).catch(() => [])).sort((a, b) => b.localeCompare(a, "en", { numeric: true }))) {
    const path: string | null | false = !found && !entry.endsWith(".partial") && await executable(join(directory, entry), name);
    if (path && await version(name, path)) found = { version: entry, path };
    else await rm(join(directory, entry), { recursive: true, force: true }).catch(() => {});
  }
  return found;
}

async function verify(name: Helper, release: Release, path: string) {
  const found = await version(name, path);
  if (!found || name === "yt-dlp" && found !== release.version) throw new Error(`the downloaded ${name} doesn't run`);
  if (process.platform === "darwin" && name === "ffmpeg" && await run("/usr/bin/codesign", ["--verify", "-R=anchor apple generic and certificate leaf[subject.OU] = \"KU3N25YGLU\"", path]) === null)
    throw new Error("the downloaded ffmpeg isn't signed by Martin Riedl");
}

async function install(name: Helper, release: Release) {
  console.error(`Couch helpers: downloading ${name} ${release.version}`);
  const data = new Uint8Array(await (await get(release.url)).arrayBuffer());
  if (createHash("sha256").update(data).digest("hex") !== release.sha256) throw new Error(`the ${name} download doesn't match its SHA-256`);
  const target = join(root, name, release.version);
  const partial = `${target}.partial`;
  await rm(partial, { recursive: true, force: true });
  const files = release.url.endsWith(".zip")
    ? unzipSync(data, { filter: file => name !== "ffmpeg" || basename(file.name) === `ffmpeg${exe}` })
    : { [name + exe]: data };
  for (const [entry, content] of Object.entries(files)) {
    if (entry.endsWith("/")) continue;
    if (entry.split("/").includes("..")) throw new Error(`the ${name} download has an unsafe path`);
    const file = join(partial, name === "ffmpeg" ? basename(entry) : entry);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content, { mode: 0o755 });
  }
  // macOS mpv zips hold one tarball with the app bundle.
  if (name === "mpv" && files["mpv.tar.gz"]) { await tar(join(partial, "mpv.tar.gz"), partial); await rm(join(partial, "mpv.tar.gz")); }
  const path = await executable(partial, name);
  if (!path) throw new Error(`the ${name} download has no program`);
  await verify(name, release, path);
  await rm(target, { recursive: true, force: true });
  await rename(partial, target);
  console.error(`Couch helpers: installed ${name} ${release.version} (SHA-256 verified)`);
  return join(target, path.slice(partial.length + 1));
}

async function check(name: Helper): Promise<string> {
  const system = await onPath(name);
  const systemVersion = system && await version(name, system);
  // Only yt-dlp is kept current, so only its latest release matters up front.
  const current = name === "yt-dlp" ? await latest(name).catch(() => null) : null;
  // A failed release check must not prefer an older PATH copy over the cached one.
  const offlineCopy = name === "yt-dlp" && !current ? await installed(name) : null;
  if (system && systemVersion && recentEnough(name, systemVersion, current?.version ?? offlineCopy?.version)) return system;
  const copy = offlineCopy ?? await installed(name);
  if (copy && (!current || copy.version >= current.version)) return copy.path;
  try { return await install(name, current ?? await latest(name)); }
  catch (error) {
    const fallback = copy?.path ?? (systemVersion ? system : null);
    console.error(`Couch helpers: couldn't download ${name}: ${(error as Error).message}${fallback ? `; using ${fallback}` : ""}`);
    if (fallback) return fallback;
    if (name === "mpv" && !assets?.[3]) throw error;
    throw new Error(`Couch couldn't download ${name}. Check the internet connection and try again.`);
  }
}

const chosen = new Map<Helper, Promise<string>>();

// Checks run one at a time per helper, so a repair never races an update.
export function checkHelper(name: Helper) {
  const previous = chosen.get(name)?.then(path => path, () => "") ?? Promise.resolve("");
  const next = previous.then(before => check(name).then(path => {
    if (path !== before) console.error(`Couch helpers: ${name} is ${path}`);
    return path;
  }));
  next.catch((error: Error) => console.error(`Couch helpers: ${error.message}`));
  chosen.set(name, next);
  return next;
}

// Checks every helper now and once a day: first-run downloads, yt-dlp updates and repairs.
export function startHelpers(directory: string) {
  root = directory;
  // Martin Riedl's ffmpeg links a static OpenSSL that doesn't know where the system keeps its
  // certificates, so every https read failed ("certificate verify failed"). Point it there.
  const certificates = ["/etc/ssl/cert.pem", "/etc/ssl/certs/ca-certificates.crt"].find(file => existsSync(file));
  if (certificates) process.env.SSL_CERT_FILE ??= certificates;
  const all = () => { for (const name of names) void checkHelper(name); };
  all();
  setInterval(all, 24 * 60 * 60 * 1000).unref();
}

// The helper's path, repaired first if it has gone missing since the last check.
export async function helper(name: Helper): Promise<string> {
  const path = await (chosen.get(name) ?? checkHelper(name)).catch(() => checkHelper(name));
  return await access(path, constants.X_OK).then(() => path, () => checkHelper(name));
}
