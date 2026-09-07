import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm, statfs, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ReleaseChannel, UpdateCandidate } from "../shared/updates";

const execute = promisify(execFile);
const hash = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const versionPattern = /^\d+\.\d+\.\d+(?:\+build\.[1-9]\d*\.[1-9]\d*)?$/;
const reserve = 256 * 1024 * 1024;
export class UpdateError extends Error {}
function fail(message: string): never { throw new UpdateError(message); }
type Package = { name: string; version: string; architecture: string; filename: string; size: number; sha256: string };
type Manifest = { schemaVersion: number; releaseId: string; build: { version: string; revision: string; packaged: boolean; dirty: boolean; target: string }; ci: { ref: string; repository: string; workflow: string; runId: string; attempt: string }; qualification: { checks: unknown[] }; compatibility: { os: string; osVersion: string; architecture: string }; releaseNotes: string; packages: Package[] };
export type VerifiedRelease = { summary: UpdateCandidate; manifest: Manifest; metadata: Buffer; index: Buffer; signed: Buffer; feed: string; channel: ReleaseChannel };
export type UpdateRelease = { summary: UpdateCandidate; staged?: boolean };
export type UpdateFeed<T extends UpdateRelease = VerifiedRelease> = { installationUnavailable?: string; check(channel: ReleaseChannel, signal: AbortSignal): Promise<T | null>; stage(candidate: T, signal: AbortSignal, progress?: (value: { received: number; total: number }) => void): Promise<void> };

// These paths are installation inputs. No HTTP request can replace them.
async function enrolledFeed() {
  const trusted = async (path: string) => {
    const info = await lstat(path);
    if (!info.isFile() || info.uid !== 0 || info.mode & 0o022) fail("Release trust configuration must be an administrator-owned file. Run the supported installer to enroll it.");
    return readFile(path, "utf8");
  };
  try {
    const source = fields(await trusted("/etc/apt/sources.list.d/couch.sources"));
    if (source["Signed-By"] !== "/etc/apt/keyrings/couch.asc" || source.Types !== "deb" || source.Components !== "main" || source.Architectures !== "amd64" || !["stable", "preview"].includes(source.Suites!)) throw new Error();
    const url = new URL(source.URIs!);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || /[\s\\]/.test(source.URIs!)) throw new Error();
    if (!url.pathname.endsWith("/")) url.pathname += "/";
    return { feed: url.href, key: await trusted(source["Signed-By"]) };
  } catch (error) {
    if (error instanceof UpdateError) throw error;
    return fail("The signed release feed is not enrolled. Ask the TV administrator to enroll its public key and address through the installer.");
  }
}

export function fields(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  let key = "";
  for (const line of text.trim().split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && key) { result[key] += `\n${line}`; continue; }
    const match = /^([A-Za-z][A-Za-z0-9-]*):\s*(.*)$/.exec(line);
    if (!match || Object.hasOwn(result, match[1]!)) fail("The release metadata has invalid or repeated fields. Ask the publisher to repair the feed.");
    key = match[1]!; result[key] = match[2]!;
  }
  return result;
}

export function publicKeyBytes(armor: string) {
  const block = /^-----BEGIN PGP PUBLIC KEY BLOCK-----\r?\n(?:[^\r\n:]+:[^\r\n]*\r?\n)*\r?\n([A-Za-z0-9+/=\r\n]+)\r?\n-----END PGP PUBLIC KEY BLOCK-----\s*$/.exec(armor);
  if (!block) return fail("The enrolled public key is invalid. Re-enroll the trusted key through the installer.");
  const data = block[1]!.split(/\r?\n/).filter(line => !line.startsWith("=")).join("");
  return Buffer.from(data, "base64");
}

async function download(url: string, limit: number, signal: AbortSignal, destination?: string, expectedHash?: string) {
  let file: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const response = await fetch(url, { signal, redirect: "error", credentials: "omit" });
    if (!response.ok || !response.body) fail("The release feed is unavailable. Keep the publishing Mac awake on the home network and try Check now.");
    if (Number(response.headers.get("Content-Length")) > limit) fail("The release download exceeds its advertised size. Ask the publisher to repair the feed.");
    if (destination) file = await open(destination, "wx", 0o600);
    const digest = createHash("sha256"), chunks: Buffer[] = [];
    let size = 0;
    for await (const value of response.body) {
      signal.throwIfAborted();
      size += value.length;
      if (size > limit) fail("The release download exceeds its advertised size. Ask the publisher to repair the feed.");
      digest.update(value);
      if (file) await file.writeFile(value); else chunks.push(Buffer.from(value));
    }
    if (expectedHash && (size !== limit || digest.digest("hex") !== expectedHash)) fail("Release authentication failed: a download does not match the signed hash. Check the publisher's files and retry.");
    if (file) await file.sync();
    return Buffer.concat(chunks);
  } catch (error) {
    if (error instanceof UpdateError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOSPC") fail("The TV ran out of staging storage. Free space and try again.");
    return fail("The release download was interrupted or the feed is offline. Keep the publishing Mac awake and retry; the installed app is unchanged.");
  } finally { await file?.close(); }
}

export function authenticateMetadata(text: string, channel: ReleaseChannel, now = Date.now()) {
  const metadata = fields(text);
  const publishedAt = Date.parse(metadata.Date!), expiresAt = Date.parse(metadata["Valid-Until"]!);
  if (metadata.Origin !== "Couch" || metadata.Suite !== channel || metadata.Codename !== channel || metadata.Architectures !== "amd64" || metadata.Components !== "main") fail("The signed release targets another channel or architecture. Ask the publisher to repair the feed.");
  if (!Number.isFinite(publishedAt) || !Number.isFinite(expiresAt) || publishedAt > now + 60_000 || expiresAt <= now || expiresAt <= publishedAt || expiresAt - publishedAt > 7 * 24 * 60 * 60_000) fail("The signed release metadata has expired or its dates are invalid. Check the TV clock and ask the publisher to refresh the feed.");
  const entries = (metadata.SHA256 ?? "").trim().split("\n").map(line => /^\s*([a-f0-9]{64})\s+([1-9]\d*)\s+(\S+)$/.exec(line));
  const entry = (name: string) => {
    const matches = entries.filter(value => value?.[3] === name);
    if (entries.some(value => !value) || matches.length !== 1) return fail("The signed release is missing a unique content hash. Ask the publisher to repair the feed.");
    const size = Number(matches[0]![2]);
    if (!Number.isSafeInteger(size) || size > 1024 * 1024) return fail("The signed release metadata is too large.");
    return { sha256: matches[0]![1]!, size };
  };
  return { publishedAt, expiresAt, manifest: entry("release.json"), index: entry("main/binary-amd64/Packages") };
}

export function validateManifest(bytes: Buffer, index: Buffer): Manifest {
  try {
    const value = JSON.parse(bytes.toString()) as Manifest;
    if (value.schemaVersion !== 1 || !/^[1-9]\d*\.[1-9]\d*$/.test(value.releaseId) || !versionPattern.test(value.build.version) || !value.build.version.endsWith(`+build.${value.releaseId}`) || !/^[a-f0-9]{40}$/.test(value.build.revision) || value.build.dirty || !value.build.packaged || value.build.target !== "x86_64-unknown-linux-gnu") throw new Error();
    if (value.ci.ref !== "main" || value.ci.repository !== "avoid-quest/couch" || value.ci.workflow !== "Package" || `${value.ci.runId}.${value.ci.attempt}` !== value.releaseId || !Array.isArray(value.qualification.checks) || !value.qualification.checks.length) throw new Error();
    if (value.compatibility.os !== "ubuntu" || value.compatibility.osVersion !== "24.04" || value.compatibility.architecture !== "amd64") fail("This release is not compatible with Ubuntu 24.04 on this TV's architecture.");
    if (typeof value.releaseNotes !== "string" || !value.releaseNotes.trim() || value.releaseNotes.length > 64_000 || value.packages.length !== 2) throw new Error();
    const paragraphs = index.toString().trim().split(/\r?\n\r?\n/).map(fields);
    if (paragraphs.length !== 2) throw new Error();
    for (const [name, architecture] of [["couch", "amd64"], ["couch-appliance", "all"]]) {
      const packages = value.packages.filter(item => item.name === name), records = paragraphs.filter(item => item.Package === name);
      if (packages.length !== 1 || records.length !== 1) throw new Error();
      const p = packages[0]!, record = records[0]!;
      if (p.version !== value.build.version || p.architecture !== architecture || !/^[A-Za-z0-9_.+~-]+\.deb$/.test(p.filename) || !Number.isSafeInteger(p.size) || p.size <= 0 || p.size > 2 * 1024 ** 3 || !/^[a-f0-9]{64}$/.test(p.sha256)) throw new Error();
      if (record.Version !== p.version || record.Architecture !== p.architecture || record.Filename !== `releases/${value.releaseId}/${p.filename}` || record.Size !== String(p.size) || record.SHA256 !== p.sha256) throw new Error();
    }
    return value;
  } catch (error) {
    if (error instanceof UpdateError) throw error;
    return fail("The release manifest and signed package index disagree or contain an unsupported build. Ask the publisher to repair the feed.");
  }
}

export function createUpdateFeed(directory: string, runningVersion: string, overrides: {
  enrollment?: typeof enrolledFeed;
  command?: (args: string[], signal: AbortSignal) => Promise<string>;
  compatible?: () => Promise<boolean>;
  free?: (path: string) => Promise<number>;
} = {}): UpdateFeed {
  const command = overrides.command ?? (async (args, signal) => (await execute(args[0]!, args.slice(1), { signal, timeout: 30_000, maxBuffer: 2 * 1024 * 1024, env: { PATH: "/usr/bin:/bin", LC_ALL: "C" } })).stdout);
  const free = overrides.free ?? (async path => { const info = await statfs(path); return info.bavail * info.bsize; });
  const compatible = overrides.compatible ?? (async () => process.platform === "linux" && process.arch === "x64" && /^ID=ubuntu$/m.test(await readFile("/etc/os-release", "utf8")) && /^VERSION_ID="24\.04"$/m.test(await readFile("/etc/os-release", "utf8")));
  const initialize = async () => {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    for (const name of await readdir(directory)) if (/^\.partial-/.test(name)) await rm(join(directory, name), { recursive: true, force: true });
  };
  return {
    async check(channel, signal) {
      if (!await compatible()) fail("Updates require the packaged Ubuntu 24.04 x86_64 installation.");
      await initialize();
      const { feed, key } = await (overrides.enrollment ?? enrolledFeed)();
      const temporary = await mkdtemp(join(directory, ".partial-check-"));
      try {
        const signed = await download(`${feed}dists/${channel}/InRelease`, 2 * 1024 * 1024, signal);
        await writeFile(join(temporary, "InRelease"), signed);
        await writeFile(join(temporary, "trusted.gpg"), publicKeyBytes(key));
        let text: string;
        try { text = await command(["/usr/bin/gpgv", "--homedir", temporary, "--keyring", join(temporary, "trusted.gpg"), "--weak-digest", "SHA1", "--output", "-", join(temporary, "InRelease")], signal); }
        catch { return fail("The release signature could not be authenticated with the enrolled key. Check the publisher and TV trust enrollment."); }
        const metadata = authenticateMetadata(text, channel);
        const index = await download(`${feed}dists/${channel}/main/binary-amd64/by-hash/SHA256/${metadata.index.sha256}`, metadata.index.size, signal, undefined, metadata.index.sha256);
        const bytes = await download(`${feed}dists/${channel}/release.json`, metadata.manifest.size, signal, undefined, metadata.manifest.sha256);
        const manifest = validateManifest(bytes, index);
        if (!versionPattern.test(runningVersion)) fail("The running build has no supported package version. Reinstall through the supported installer.");
        // dpkg owns Debian version ordering. Equal or older channels never become candidates.
        let newer = false;
        try { await command(["/usr/bin/dpkg", "--compare-versions", manifest.build.version, "gt", runningVersion], signal); newer = true; }
        catch (error) { if ((error as { code?: number }).code !== 1) throw error; }
        if (!newer) return null;
        return { summary: { id: hash(bytes), releaseId: manifest.releaseId, version: manifest.build.version, revision: manifest.build.revision, notes: manifest.releaseNotes, bytes: manifest.packages.reduce((sum, p) => sum + p.size, 0), publishedAt: metadata.publishedAt, expiresAt: metadata.expiresAt }, manifest, metadata: bytes, index, signed, feed, channel };
      } finally { await rm(temporary, { recursive: true, force: true }); }
    },
    async stage(candidate, signal) {
      if (candidate.summary.expiresAt <= Date.now()) fail("This candidate's signed metadata expired. Use Check now before downloading again.");
      if (!await compatible()) fail("This release is not compatible with this TV.");
      if (await free(directory) < candidate.summary.bytes + reserve) fail("The TV needs more staging storage. Free space before downloading this release.");
      const temporary = await mkdtemp(join(directory, ".partial-download-"));
      try {
        let installedBytes = 0;
        for (const p of candidate.manifest.packages) {
          const path = join(temporary, p.filename);
          await download(`${candidate.feed}releases/${candidate.manifest.releaseId}/${p.filename}`, p.size, signal, path, p.sha256);
          const control = fields(await command(["/usr/bin/dpkg-deb", "--field", path], signal));
          if (control.Package !== p.name || control.Version !== p.version || control.Architecture !== p.architecture) fail("A downloaded Debian archive has an unexpected identity or installed size. Ask the publisher to repair it.");
          const contents = await command(["/usr/bin/dpkg-deb", "--contents", path], signal);
          for (const line of contents.trim().split("\n")) {
            const entry = /^\S+\s+\S+\s+(\d+)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+/.exec(line);
            if (!entry) fail("The Debian archive's unpacked size could not be verified.");
            installedBytes += Number(entry[1]);
          }
        }
        if (!Number.isSafeInteger(installedBytes) || await free("/usr") < installedBytes + reserve) fail("The TV needs more installation storage. Free space before staging this release again.");
        signal.throwIfAborted();
        if (candidate.summary.expiresAt <= Date.now()) fail("The signed metadata expired during download. Use Check now and retry.");
        await writeFile(join(temporary, "InRelease"), candidate.signed);
        await writeFile(join(temporary, "release.json"), candidate.metadata);
        await writeFile(join(temporary, "Packages"), candidate.index);
        // The identity names immutable verified content; no partial download is ever ready.
        const destination = join(directory, candidate.summary.id);
        await rm(destination, { recursive: true, force: true });
        await rename(temporary, destination);
      } finally { await rm(temporary, { recursive: true, force: true }); }
    },
  };
}
