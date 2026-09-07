import { strict as assert } from "node:assert";
import { cp, mkdir, mkdtemp, open, readlink, readdir, rename, rm, symlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { verifiedArchive } from "./download-release";
const sha256 = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
async function run(args: string[]) {
  const child = Bun.spawn(args, { stdout: "pipe", stderr: "inherit", env: { ...process.env } });
  const bytes = new Uint8Array(await new Response(child.stdout).arrayBuffer());
  assert.equal(await child.exited, 0, `${args[0]} failed`);
  return bytes;
}
const version = (text: string) => {
  assert.match(text, /^\d+\.\d+\.\d+\+build\.[1-9]\d*\.[1-9]\d*$/);
  return text.replace("+build.", ".").split(".").map(BigInt);
};
const compare = (a: string, b: string) => {
  const left = version(a), right = version(b);
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return left[i]! > right[i]! ? 1 : -1;
  return 0;
};
async function sign(path: string) {
  // Tauri owns signing and reads its standard private-key/password environment variables.
  await run(["bunx", "--no-install", "tauri", "signer", "sign", path]);
  return (await Bun.file(`${path}.sig`).text()).trim();
}
async function point(path: string, target: string) {
  await rm(`${path}.tmp`, { force: true });
  await symlink(target, `${path}.tmp`);
  await rename(`${path}.tmp`, path);
}
async function link(path: string, target: string) {
  try { await symlink(target, path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; assert.equal(await readlink(path), target); }
}

export async function download(artifactId: string, destination: string) {
  assert.match(artifactId, /^[1-9]\d*$/);
  const { identity, run: workflow, archive: bytes } = verifiedArchive(artifactId, "couch-appimage");
  const temporary = await mkdtemp(join(tmpdir(), "couch-appimage-download-"));
  try {
    const archive = join(temporary, "artifact.zip");
    await Bun.write(archive, bytes);
    const names = new TextDecoder().decode(await run(["unzip", "-Z1", archive])).trim().split("\n");
    assert.ok(names.every(name => !name.startsWith("/") && !name.includes("\\") && !name.split("/").includes("..")), "Unsafe artifact path");
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await mkdir(destination, { mode: 0o700 });
    await run(["unzip", "-q", archive, "-d", destination]);
    const build = await Bun.file(join(destination, "build-info.json")).json();
    assert.equal(build.revision, workflow.head_sha);
    assert.ok(build.version.endsWith(`+build.${identity}`));
    await Bun.write(join(destination, "github-artifact.json"), JSON.stringify({ artifactId, digest: `sha256:${sha256(bytes)}`, identity, revision: workflow.head_sha }));
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

export async function publish(artifact: string, feed: string, baseUrl: string, channel: "stable" | "preview", notes: string) {
  const url = new URL(baseUrl);
  assert.ok(["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash);
  const base = url.href.replace(/\/?$/, "/");
  const build = await Bun.file(join(artifact, "build-info.json")).json();
  version(build.version);
  assert.ok(build.dirty === false && build.packaged === true && build.target === "x86_64-unknown-linux-gnu" && build.dataFormat === 1);
  assert.match(build.revision, /^[a-f0-9]{40}$/);
  const archives = (await readdir(artifact)).filter(name => name.endsWith(".AppImage"));
  assert.equal(archives.length, 1);
  const name = archives[0]!, bytes = new Uint8Array(await Bun.file(join(artifact, name)).arrayBuffer());
  const evidence = [...new Bun.Glob("appimage-qualification/*/result.json").scanSync(artifact)];
  assert.equal(evidence.length, 1);
  const qualification = await Bun.file(join(artifact, evidence[0]!)).json();
  assert.deepEqual(qualification.build, build);
  assert.equal(qualification.packageSha256, sha256(bytes));
  assert.ok(qualification.format === "AppImage" && qualification.checks.length > 0);
  assert.ok(await Bun.file(join(artifact, "couch-source.tar.gz")).exists());
  await mkdir(feed, { recursive: true });
  const lockPath = join(feed, ".publish.lock"), lock = await open(lockPath, "wx", 0o600);
  try {
    const current = Bun.file(join(feed, `${channel}.json`));
    if (await current.exists()) assert.ok(compare(build.version, (await current.json()).version) >= 0, "A channel cannot move backwards");
    const releaseId = build.version.split("+build.")[1];
    const releases = join(feed, "releases"), destination = join(releases, releaseId);
    await mkdir(releases, { recursive: true });
    if (await Bun.file(join(destination, name)).exists()) {
      assert.equal(sha256(new Uint8Array(await Bun.file(join(destination, name)).arrayBuffer())), sha256(bytes), "Release bytes cannot change");
      assert.deepEqual(await Bun.file(join(destination, "build-info.json")).json(), build);
    } else {
      const staging = await mkdtemp(join(releases, ".release-"));
      try {
        await Bun.write(join(staging, name), bytes);
        await cp(join(artifact, "build-info.json"), join(staging, "build-info.json"));
        await sign(join(staging, name));
        await rename(staging, destination);
      } finally { await rm(staging, { recursive: true, force: true }); }
    }
    const signature = (await Bun.file(join(destination, `${name}.sig`)).text()).trim();
    const publishedAt = Math.floor(Date.now() / 1000) * 1000;
    const metadata = { version: build.version, notes, pub_date: new Date(publishedAt).toISOString(), platforms: { "linux-x86_64": { url: `${base}releases/${releaseId}/${encodeURIComponent(name)}`, signature } }, revision: build.revision, dataFormat: build.dataFormat, releaseId, bytes: bytes.length, expiresAt: publishedAt + 7 * 86400_000 };
    await mkdir(join(feed, ".metadata"), { recursive: true });
    const snapshot = await mkdtemp(join(feed, ".metadata", `${releaseId}-`));
    await Bun.write(join(snapshot, "release.json"), JSON.stringify(metadata, null, 2));
    await sign(join(snapshot, "release.json"));
    for (const suffix of ["", ".sig"]) {
      await link(join(feed, `${channel}.json${suffix}`), `${channel}/release.json${suffix}`);
      await link(join(destination, `release.json${suffix}`), `metadata/release.json${suffix}`);
    }
    await point(join(destination, "metadata"), `../../.metadata/${snapshot.split("/").at(-1)}`);
    await point(join(feed, channel), `.metadata/${snapshot.split("/").at(-1)}`);
    return metadata;
  } finally { await lock.close(); await rm(lockPath); }
}

if (import.meta.main) {
  const [artifactId, directory, feed, base, channel, notes] = Bun.argv.slice(2);
  assert.ok(artifactId && directory && feed && base && (channel === "stable" || channel === "preview") && notes, "Usage: bun scripts/publish-appimage.ts ARTIFACT_ID NEW_PRIVATE_DIRECTORY FEED_DIRECTORY BASE_URL stable|preview NOTES");
  await download(artifactId, resolve(directory));
  const result = await publish(resolve(directory), resolve(feed), base, channel, notes);
  console.log(`Published ${channel}: ${result.version} (${result.revision})`);
}
