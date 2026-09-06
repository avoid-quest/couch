import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authenticateMetadata, createUpdateFeed, publicKeyBytes, validateManifest } from "./update-feed";

const directories: string[] = [], servers: ReturnType<typeof Bun.serve>[] = [];
afterEach(async () => { for (const server of servers.splice(0)) await server.stop(true); for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export function fixture() {
  const packages = ["couch", "couch-appliance"].map(name => ({ name, version: "0.1.0+build.2.1", architecture: name === "couch" ? "amd64" : "all", filename: `${name}.deb`, size: name.length, sha256: digest(name) }));
  const manifest = { schemaVersion: 1, releaseId: "2.1", build: { version: packages[0]!.version, revision: "a".repeat(40), dirty: false, packaged: true, target: "x86_64-unknown-linux-gnu" }, compatibility: { os: "ubuntu", osVersion: "24.04", architecture: "amd64" }, ci: { ref: "main", repository: "avoid-quest/couch", workflow: "Package", runId: "2", attempt: "1" }, qualification: { checks: ["fixture"] }, releaseNotes: "Second fixture", packages };
  const metadata = Buffer.from(JSON.stringify(manifest));
  const index = Buffer.from(packages.map(p => `Package: ${p.name}\nVersion: ${p.version}\nArchitecture: ${p.architecture}\nFilename: releases/2.1/${p.filename}\nSize: ${p.size}\nSHA256: ${p.sha256}\n`).join("\n"));
  const signedText = `Origin: Couch\nSuite: preview\nCodename: preview\nArchitectures: amd64\nComponents: main\nDate: ${new Date(Date.now() - 1_000).toUTCString()}\nValid-Until: ${new Date(Date.now() + 86_400_000).toUTCString()}\nSHA256:\n ${digest(metadata)} ${metadata.length} release.json\n ${digest(index)} ${index.length} main/binary-amd64/Packages\n`;
  return { packages, manifest, metadata, index, signedText };
}
async function setup(options: { tamper?: string; signature?: boolean; compatible?: boolean; free?: number; older?: boolean; archive?: boolean } = {}) {
  const f = fixture(), paths: string[] = [];
  const directory = await mkdtemp(join(tmpdir(), "couch-staging-test-")); directories.push(directory);
  const server = Bun.serve({ port: 0, fetch(request) {
    const path = new URL(request.url).pathname; paths.push(path);
    if (path.includes("InRelease")) return new Response("signed fixture handled by injected verifier");
    if (path.includes("by-hash")) return new Response(f.index);
    if (path.endsWith("release.json")) return new Response(options.tamper === "manifest" ? `${f.metadata} ` : f.metadata);
    const p = f.packages.find(p => path.endsWith(p.filename));
    return p ? new Response(options.tamper === "package" ? p.name.toUpperCase() : p.name) : new Response(null, { status: 404 });
  } }); servers.push(server);
  const feed = createUpdateFeed(directory, "0.1.0+build.1.1", {
    enrollment: async () => ({ feed: `http://127.0.0.1:${server.port}/`, key: "-----BEGIN PGP PUBLIC KEY BLOCK-----\n\nYWJj\n=AAAA\n-----END PGP PUBLIC KEY BLOCK-----\n" }),
    compatible: async () => options.compatible !== false,
    free: async () => options.free ?? Number.MAX_SAFE_INTEGER,
    command: async args => {
      if (args[0]?.endsWith("gpgv")) { if (options.signature === false) throw new Error(); return f.signedText; }
      if (args[0]?.endsWith("dpkg")) { if (options.older) throw Object.assign(new Error(), { code: 1 }); return ""; }
      if (args.includes("--contents")) return "drwxr-xr-x root/root 0 2026-09-06 12:00 ./\n-rw-r--r-- root/root 123 2026-09-06 12:00 ./data\n";
      const p = f.packages.find(p => args.at(-1)?.endsWith(`/${p.filename}`))!;
      return `Package: ${options.archive === false ? "wrong" : p.name}\nVersion: ${p.version}\nArchitecture: ${p.architecture}\n`;
    },
  });
  return { ...f, feed, directory, paths };
}
const signal = () => AbortSignal.timeout(5_000);

test("authenticates manifest and index, stages exact bytes without an Installed-Size field", async () => {
  const f = await setup();
  const candidate = (await f.feed.check("preview", signal()))!;
  expect(candidate.summary.id).toBe(digest(f.metadata));
  await f.feed.stage(candidate, signal());
  expect(await readFile(join(f.directory, candidate.summary.id, "couch.deb"), "utf8")).toBe("couch");
  expect(await readFile(join(f.directory, candidate.summary.id, "InRelease"), "utf8")).toContain("signed fixture");
  expect(await readdir(f.directory)).toEqual([candidate.summary.id]);
  expect(f.paths.some(path => path.includes(`/by-hash/SHA256/${digest(f.index)}`))).toBe(true);
});

test("rejects signature failure, altered manifest, architecture mismatch and downgraded channels", async () => {
  for (const options of [{ signature: false }, { tamper: "manifest" }, { compatible: false }]) {
    const f = await setup(options);
    await expect(f.feed.check("preview", signal())).rejects.toThrow();
    expect(await readdir(f.directory)).toEqual([]);
  }
  expect(await (await setup({ older: true })).feed.check("preview", signal())).toBeNull();
});

test("tampered or mismatched archives and full disk never produce ready files", async () => {
  for (const options of [{ tamper: "package" }, { free: 0 }, { archive: false }]) {
    const f = await setup(options), candidate = (await f.feed.check("preview", signal()))!;
    await expect(f.feed.stage(candidate, signal())).rejects.toThrow();
    expect(await readdir(f.directory)).toEqual([]);
  }
});

test("restart removes interrupted partial files and preserves earlier complete releases", async () => {
  const f = await setup();
  await writeFile(join(f.directory, ".partial-download-old"), "interrupted");
  await writeFile(join(f.directory, "b".repeat(64)), "previous release retained for recovery");
  const candidate = (await f.feed.check("preview", signal()))!;
  await f.feed.stage(candidate, signal());
  expect((await readdir(f.directory)).sort()).toEqual([candidate.summary.id, "b".repeat(64)].sort());
});

test("metadata enforces expiry, suite, unique hashes and exact manifest identities", () => {
  const f = fixture();
  expect(() => authenticateMetadata(f.signedText, "stable")).toThrow();
  expect(() => authenticateMetadata(f.signedText, "preview", Date.now() + 2 * 86_400_000)).toThrow();
  expect(() => authenticateMetadata(`${f.signedText} ${digest(f.metadata)} ${f.metadata.length} release.json\n`, "preview")).toThrow();
  for (const change of [() => { f.manifest.compatibility.architecture = "arm64"; }, () => { f.manifest.packages[0]!.filename = "../couch.deb"; }, () => { f.manifest.ci.runId = "7"; }]) {
    change(); expect(() => validateManifest(Buffer.from(JSON.stringify(f.manifest)), f.index)).toThrow();
  }
  expect(publicKeyBytes("-----BEGIN PGP PUBLIC KEY BLOCK-----\n\nYWJj\n=AAAA\n-----END PGP PUBLIC KEY BLOCK-----\n").toString()).toBe("abc");
  expect(() => publicKeyBytes("PRIVATE KEY")).toThrow();
});
