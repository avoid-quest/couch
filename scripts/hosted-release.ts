import { strict as assert } from "node:assert";
import { lstat, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { application, channelArgs, downloadUrl, publicFiles, publicKey, releaseVersion, updaterEndpoint, type Channel } from "./hosted-policy";

type FileIdentity = { bytes: number; sha256: string; signature?: string };
export type Manifest = {
  schemaVersion: 1;
  version: string;
  revision: string;
  publicKey: string;
  files: Record<string, FileIdentity>;
  inventorySha256: string;
};
export type CloudRelease = {
  id: string; version: string; channel: string | null; status: "Draft" | "Published";
  assets: { id: string; filename: string; size: string; signature: string | null; publicPlatform: string | null; updatePlatform: string | null }[];
};
export const hash = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const read = async (path: string) => new Uint8Array(await Bun.file(path).arrayBuffer());

function run(args: string[]) {
  const result = Bun.spawnSync(args, { stderr: "inherit", env: { ...process.env, CI: "true" }, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.exitCode, 0, `Failed: ${args[0]} ${args[1] ?? ""}`);
  return result.stdout.toString();
}
function cn(args: string[]) {
  return run([process.env.CN_BIN ?? "cn", "--no-quality-reports", "release", ...args]);
}

export async function verifySignature(file: string, key: string) {
  const temporary = await mkdtemp(join(tmpdir(), "couch-signature-"));
  try {
    await Bun.write(join(temporary, "key"), Buffer.from(publicKey(key), "base64"));
    await Bun.write(join(temporary, "signature"), Buffer.from((await Bun.file(`${file}.sig`).text()).trim(), "base64"));
    run(["minisign", "-Vm", file, "-p", join(temporary, "key"), "-x", join(temporary, "signature")]);
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

export function validateManifest(manifest: Manifest) {
  assert.equal(manifest.schemaVersion, 1);
  releaseVersion(manifest.version);
  assert.match(manifest.revision, /^[a-f0-9]{40}$/);
  publicKey(manifest.publicKey);
  assert.match(manifest.inventorySha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(manifest.files).sort(), publicFiles(manifest.version).sort(), "The public asset allowlist differs.");
  for (const [name, file] of Object.entries(manifest.files)) {
    assert.ok(Number.isSafeInteger(file.bytes) && file.bytes > 0 && file.bytes <= 2 * 1024 ** 3, `Invalid size: ${name}`);
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
    if (!name.endsWith(".sig")) assert.ok(file.signature, `Missing signature: ${name}`);
  }
}

export async function verifyFiles(directory: string, manifest: Manifest) {
  validateManifest(manifest);
  assert.deepEqual((await readdir(join(directory, "public"))).sort(), publicFiles(manifest.version).sort(), "Unexpected or missing public file.");
  for (const [name, expected] of Object.entries(manifest.files)) {
    const path = join(directory, "public", name);
    assert.ok((await lstat(path)).isFile(), `Public assets must be regular files: ${name}`);
    const bytes = await read(path);
    assert.equal(bytes.length, expected.bytes, `Size changed: ${name}`);
    assert.equal(hash(bytes), expected.sha256, `Bytes changed: ${name}`);
    if (!name.endsWith(".sig")) {
      assert.equal((await Bun.file(`${path}.sig`).text()).trim(), expected.signature, `Signature changed: ${name}`);
      await verifySignature(path, manifest.publicKey);
    }
  }
}

export function verifyCloud(release: CloudRelease, manifest: Manifest, channel: Channel) {
  validateManifest(manifest);
  assert.equal(release.version, manifest.version, "Cloud version differs from the built app.");
  assert.equal(release.channel, channel === "preview" ? "preview" : null, "Cloud channel differs.");
  assert.match(release.id, /^[A-Z0-9]{26}$/);
  assert.deepEqual(release.assets.map(asset => asset.filename).sort(), publicFiles(manifest.version).sort(), "Cloud has an incomplete or unapproved public asset set.");
  for (const asset of release.assets) {
    const expected = manifest.files[asset.filename]!;
    assert.equal(Number(asset.size), expected.bytes, `Cloud size differs: ${asset.filename}`);
    assert.equal(asset.signature ?? undefined, expected.signature, `Cloud signature differs: ${asset.filename}`);
    assert.equal(asset.publicPlatform, asset.filename.endsWith(".AppImage") ? "appimage-x86_64" : null);
    assert.equal(asset.updatePlatform, asset.filename.endsWith(".AppImage") ? "linux-x86_64-appimage" : null);
  }
}

// cn latest follows publication order. Inspect published records, including Stable's null channel.
export function assertIncreasing(releases: { version: string; channel: string | null; status: string }[], version: string, channel: Channel) {
  releaseVersion(version);
  for (const release of releases) if (release.status === "Published" && release.channel === (channel === "preview" ? "preview" : null)) {
    assert.ok(Bun.semver.order(version, release.version) > 0, `Publish a version newer than ${release.version} in ${channel}.`);
  }
  if (channel === "stable") assert.ok(!version.includes("-"), "Stable promotion requires the final version qualified in Preview.");
}

export async function verifyPublic(manifest: Manifest, channel: Channel, fetcher: typeof fetch = fetch) {
  validateManifest(manifest);
  const checks: { url: string; finalUrl: string; sha256: string }[] = [];
  const get = async (url: string, expected?: FileIdentity) => {
    assert.equal(new URL(url).protocol, "https:", "Public downloads require HTTPS.");
    const response = await fetcher(url, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
    assert.equal(response.status, 200, `Public download is not ready: ${url} (${response.status}). Retry verification of the existing release.`);
    assert.equal(new URL(response.url || url).protocol, "https:");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (expected) {
      assert.equal(bytes.length, expected.bytes, `Public download size differs: ${url}`);
      assert.equal(hash(bytes), expected.sha256, `Public download bytes differ: ${url}`);
    }
    checks.push({ url, finalUrl: response.url || url, sha256: hash(bytes) });
    return bytes;
  };
  const app = manifest.files[`Couch_${manifest.version}_amd64.AppImage`]!;
  for (const [name, identity] of Object.entries(manifest.files)) await get(downloadUrl(name, channel), identity);
  await get(downloadUrl("platform/appimage-x86_64", channel), app);
  // An earlier current version asks for metadata even when this is the first release.
  const endpoint = updaterEndpoint.replace("{{current_version}}", "0.0.0") + (channel === "preview" ? "?channel=preview" : "");
  const metadata = JSON.parse(new TextDecoder().decode(await get(endpoint)));
  assert.equal(metadata.version, manifest.version, "CDN still offers another version. Retry verification without republishing.");
  assert.equal(metadata.signature.trim(), app.signature);
  await get(metadata.url, app);
  return { version: manifest.version, revision: manifest.revision, channel, checkedAt: new Date().toISOString(), files: manifest.files, checks };
}

async function seal(directory: string) {
  const build = await Bun.file("src-tauri/build-info.json").json();
  assert.equal(build.dirty, false, "Release source must be committed.");
  assert.equal(build.target, "x86_64-unknown-linux-gnu");
  assert.equal(build.packaged, true);
  assert.equal(build.version, (await Bun.file(".artifacts/tauri-release.conf.json").json()).version);
  const inventory = await read(".artifacts/appimage-inventory.json");
  assert.deepEqual(JSON.parse(new TextDecoder().decode(inventory)).build, build);
  const manifest: Manifest = { schemaVersion: 1, version: build.version, revision: build.revision, publicKey: publicKey(process.env.COUCH_UPDATER_PUBLIC_KEY), inventorySha256: hash(inventory), files: {} };
  for (const name of publicFiles(build.version)) {
    const path = join(directory, "public", name);
    const bytes = await read(path);
    manifest.files[name] = { bytes: bytes.length, sha256: hash(bytes), ...(!name.endsWith(".sig") ? { signature: (await Bun.file(`${path}.sig`).text()).trim() } : {}) };
  }
  await verifyFiles(directory, manifest);
  await Bun.write(join(directory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
}

if (import.meta.main) {
  const [operation, input = ".artifacts/hosted-release", channelInput = "preview", releaseId] = process.argv.slice(2);
  const directory = resolve(input);
  const channel = channelInput as Channel;
  const channels = channelArgs(channel);
  if (operation === "draft-source") {
    assert.equal(channel, "preview", "Fresh builds go through Preview before Stable.");
    const version = releaseVersion((await Bun.file("src-tauri/tauri.conf.json").json()).version);
    publicKey(process.env.COUCH_UPDATER_PUBLIC_KEY);
    assertIncreasing(JSON.parse(cn(["list", application, "--format", "json", "--limit", "10000", "--status", "published"])), version, channel);
    const release: CloudRelease = releaseId
      ? JSON.parse(cn(["show", application, releaseId, ...channels]))
      : JSON.parse(cn(["draft", application, version, ...channels, "--notes-file", join(directory, "notes.md")]));
    assert.equal(release.status, "Draft");
    assert.equal(release.version, version);
    assert.equal(release.channel, "preview");
    assert.match(release.id, /^[A-Z0-9]{26}$/);
    await Bun.write(join(directory, "draft-preview.json"), JSON.stringify(release, null, 2));
    if (process.env.GITHUB_OUTPUT) await Bun.write(Bun.file(process.env.GITHUB_OUTPUT), `${await Bun.file(process.env.GITHUB_OUTPUT).text()}release-id=${release.id}\n`);
  } else if (operation === "seal") await seal(directory);
  else {
    const manifest: Manifest = await Bun.file(join(directory, "manifest.json")).json();
    await verifyFiles(directory, manifest);
    const key = process.env.COUCH_UPDATER_PUBLIC_KEY;
    if (key) assert.equal(manifest.publicKey, publicKey(key), "The artifact uses another signing key.");
    if (operation === "verify") console.log(`Verified ${manifest.version} from ${manifest.revision}`);
    else if (operation === "readiness") {
      await Bun.write(join(directory, `readiness-${channel}.json`), JSON.stringify(await verifyPublic(manifest, channel), null, 2) + "\n");
    } else if (operation === "draft") {
      const releases = JSON.parse(cn(["list", application, "--format", "json", "--limit", "10000", "--status", "published"]));
      assertIncreasing(releases, manifest.version, channel);
      if (channel === "stable") {
        const receipt = await Bun.file(join(directory, "readiness-preview.json")).json();
        assert.equal(receipt.version, manifest.version);
        assert.equal(receipt.revision, manifest.revision);
        assert.deepEqual(receipt.files, manifest.files, "Promote the exact files verified in Preview.");
      }
      const release: CloudRelease = releaseId
        ? JSON.parse(cn(["show", application, releaseId, ...channels]))
        : JSON.parse(cn(["draft", application, manifest.version, ...channels, "--notes-file", join(directory, "notes.md")]));
      assert.equal(release.status, "Draft");
      assert.equal(release.version, manifest.version);
      assert.equal(release.channel, channel === "preview" ? "preview" : null);
      await Bun.write(join(directory, `draft-${channel}.json`), JSON.stringify(release, null, 2));
      if (process.env.GITHUB_OUTPUT) await Bun.write(Bun.file(process.env.GITHUB_OUTPUT), `${await Bun.file(process.env.GITHUB_OUTPUT).text()}release-id=${release.id}\n`);
    } else if (operation === "upload" || operation === "publish") {
      const qualified = await Bun.file(join(directory, "qualified.json")).json();
      assert.equal(qualified.revision, manifest.revision);
      assert.equal(qualified.version, manifest.version);
      assert.deepEqual(qualified.files, manifest.files, "Qualification must identify these exact files.");
      assert.deepEqual(qualified.checks, ["signatures", "typecheck", "bun", "native", "signed-manifest-extraction", "installer"]);
      assert.match(releaseId ?? "", /^[A-Z0-9]{26}$/, "Use the recorded draft release ID for retries.");
      let release: CloudRelease = JSON.parse(cn(["show", application, releaseId!, ...channels]));
      assert.equal(release.status, "Draft", "This release is already published. Run readiness instead.");
      assert.equal(release.version, manifest.version);
      assert.equal(release.channel, channel === "preview" ? "preview" : null);
      if (operation === "upload") {
        // Explicit provider uploads keep private receipts, source and stale bundles out of Cloud.
        for (const name of publicFiles(manifest.version)) {
          const existing = release.assets.find(asset => asset.filename === name);
          if (existing) {
            assert.equal(Number(existing.size), manifest.files[name]!.bytes);
            assert.equal(existing.signature ?? undefined, manifest.files[name]!.signature);
            continue;
          }
          cn(["upload", application, releaseId!, ...channels, "--file", join(directory, "public", name), ...(name.endsWith(".AppImage") ? ["--public-platform", "appimage-x86_64", "--update-platform", "linux-x86_64-appimage"] : [])]);
        }
        release = JSON.parse(cn(["show", application, releaseId!, ...channels]));
      }
      verifyCloud(release, manifest, channel);
      if (operation === "publish") {
        assertIncreasing(JSON.parse(cn(["list", application, "--format", "json", "--limit", "10000", "--status", "published"])), manifest.version, channel);
        release = JSON.parse(cn(["publish", application, releaseId!, ...channels]));
        verifyCloud(release, manifest, channel);
        assert.equal(release.status, "Published");
      }
      await mkdir(join(directory, "receipts"), { recursive: true });
      await Bun.write(join(directory, "receipts", `${operation}-${channel}.json`), JSON.stringify(release, null, 2) + "\n");
    } else throw new Error("Use draft-source, seal, verify, draft, upload, publish or readiness.");
  }
}
