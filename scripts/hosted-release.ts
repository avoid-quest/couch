import { strict as assert } from "node:assert";
import { lstat, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { application, assetPlatforms, cdn, channelArgs, downloadUrl, publicFiles, publicKey, releaseVersion, packageFormat, releasePlatforms, type PackageFormat, type Channel } from "./hosted-policy";

type FileIdentity = { bytes: number; sha256: string; signature?: string };
export type Manifest = {
  schemaVersion: 1;
  format?: PackageFormat;
  buildRun?: { id: number; attempt: number };
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

export async function verifySignature(file: string, key: string, signature?: string) {
  const temporary = await mkdtemp(join(tmpdir(), "couch-signature-"));
  try {
    await Bun.write(join(temporary, "key"), Buffer.from(publicKey(key), "base64"));
    await Bun.write(join(temporary, "signature"), Buffer.from(signature ?? (await Bun.file(`${file}.sig`).text()).trim(), "base64"));
    run(["minisign", "-Vm", file, "-p", join(temporary, "key"), "-x", join(temporary, "signature")]);
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

export function validateManifest(manifest: Manifest) {
  assert.equal(manifest.schemaVersion, 1);
  releaseVersion(manifest.version);
  assert.match(manifest.revision, /^[a-f0-9]{40}$/);
  publicKey(manifest.publicKey);
  if (manifest.buildRun) assert.ok(Number.isSafeInteger(manifest.buildRun.id) && manifest.buildRun.id > 0 && Number.isSafeInteger(manifest.buildRun.attempt) && manifest.buildRun.attempt > 0);
  assert.match(manifest.inventorySha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(manifest.files).sort(), publicFiles(manifest.version, packageFormat(manifest.format)).sort(), "The public asset allowlist differs.");
  for (const [name, file] of Object.entries(manifest.files)) {
    assert.ok(Number.isSafeInteger(file.bytes) && file.bytes > 0 && file.bytes <= 2 * 1024 ** 3, `Invalid size: ${name}`);
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
    assert.ok(file.signature, `Missing signature: ${name}`);
  }
}

export async function verifyFiles(directory: string, manifest: Manifest) {
  validateManifest(manifest);
  assert.deepEqual((await readdir(join(directory, "public"))).sort(), publicFiles(manifest.version, packageFormat(manifest.format)).sort(), "Unexpected or missing public file.");
  for (const [name, expected] of Object.entries(manifest.files)) {
    const path = join(directory, "public", name);
    assert.ok((await lstat(path)).isFile(), `Public assets must be regular files: ${name}`);
    const bytes = await read(path);
    assert.equal(bytes.length, expected.bytes, `Size changed: ${name}`);
    assert.equal(hash(bytes), expected.sha256, `Bytes changed: ${name}`);
    await verifySignature(path, manifest.publicKey, expected.signature);
  }
}

export function verifyCloud(release: CloudRelease, manifest: Manifest, channel: Channel, allowOtherAssets = false) {
  validateManifest(manifest);
  assert.equal(release.version, manifest.version, "Cloud version differs from the built app.");
  assert.equal(release.channel, channel === "preview" ? "preview" : null, "Cloud channel differs.");
  assert.match(release.id, /^[A-Z0-9]{26}$/);
  const format = packageFormat(manifest.format);
  const expectedNames = publicFiles(manifest.version, format);
  const allNames = ["deb", "appimage", "dmg", "nsis"].flatMap(value => publicFiles(manifest.version, value as PackageFormat));
  assert.deepEqual(release.assets.filter(asset => expectedNames.includes(asset.filename)).map(asset => asset.filename).sort(), expectedNames.slice().sort(), "Cloud has an incomplete asset set for this format.");
  assert.ok(release.assets.every(asset => allowOtherAssets ? allNames.includes(asset.filename) : expectedNames.includes(asset.filename)), "Cloud has an unapproved public asset.");
  assert.equal(new Set(release.assets.map(asset => asset.filename)).size, release.assets.length, "Cloud has duplicate asset names.");
  for (const asset of release.assets.filter(asset => expectedNames.includes(asset.filename))) {
    const expected = manifest.files[asset.filename]!;
    assert.equal(Number(asset.size), expected.bytes, `Cloud size differs: ${asset.filename}`);
    assert.equal(asset.signature ?? undefined, expected.signature, `Cloud signature differs: ${asset.filename}`);
    const platforms = assetPlatforms(manifest.version, format, asset.filename);
    assert.equal(asset.publicPlatform, platforms.public);
    assert.equal(asset.updatePlatform, platforms.update);
  }
}

export function qualificationChecks(format: PackageFormat) {
  if (format === "dmg" || format === "nsis") return ["signatures", `${format}-package`];
  return ["signatures", "typecheck", "bun", "native", "signed-manifest-extraction", format === "deb" ? "debian-desktop" : "appimage-client"];
}

export function verifyQualification(qualified: { version: string; revision: string; files: Manifest["files"]; checks: string[] }, manifest: Manifest) {
  assert.equal(qualified.revision, manifest.revision);
  assert.equal(qualified.version, manifest.version);
  assert.deepEqual(qualified.files, manifest.files, "Qualification must identify these exact files.");
  assert.deepEqual(qualified.checks, qualificationChecks(packageFormat(manifest.format)));
}

// These small signed receipts allow retries without keeping another binary copy in Actions.
export async function verifyReceipt(directory: string) {
  const manifest: Manifest = await Bun.file(join(directory, "manifest.json")).json();
  validateManifest(manifest);
  assert.equal(manifest.publicKey, publicKey(process.env.COUCH_UPDATER_PUBLIC_KEY), "Use the enrolled production key for receipt reuse.");
  await verifySignature(join(directory, "manifest.json"), manifest.publicKey);
  await verifySignature(join(directory, "qualified.json"), manifest.publicKey);
  verifyQualification(await Bun.file(join(directory, "qualified.json")).json(), manifest);
  return manifest;
}

export async function restorePublic(directory: string, manifest: Manifest, fetcher: typeof fetch = fetch) {
  const receipt = await Bun.file(join(directory, "readiness-preview.json")).json();
  assert.equal(receipt.channel, "preview");
  assert.equal(receipt.version, manifest.version);
  assert.equal(receipt.revision, manifest.revision);
  assert.deepEqual(receipt.files, manifest.files, "Restore the exact qualified Preview.");
  for (const [name, identity] of Object.entries(manifest.files)) {
    const check = receipt.checks.find((value: { url: string }) => value.url === downloadUrl(name, "preview"));
    assert.equal(check?.sha256, identity.sha256);
    const url = new URL(check.finalUrl);
    assert.equal(url.origin, "https://cdn.crabnebula.app");
    assert.match(url.pathname, /^\/asset\/[A-Z0-9]{26}$/);
    const { bytes } = await downloadPublic(url.href, identity, fetcher);
    await Bun.write(join(directory, "public", name), bytes);
  }
  await verifyFiles(directory, manifest);
}

async function ghApi(args: string[], payload?: string): Promise<{ id: number; tag_name: string } | null> {
  const temporary = payload ? join(tmpdir(), `couch-ghapi-${crypto.randomUUID()}.json`) : undefined;
  try {
    if (payload && temporary) await Bun.write(temporary, payload);
    const result = Bun.spawnSync(["gh", "api", ...args, ...(temporary ? ["--input", temporary] : [])], { stderr: "pipe", env: { ...process.env, CI: "true" }, maxBuffer: 16 * 1024 * 1024 });
    const stderr = result.stderr.toString().trim();
    if (result.exitCode !== 0) {
      if (stderr.endsWith("(HTTP 404)")) return null;
      throw new Error(stderr || `gh api ${args.join(" ")} failed.`);
    }
    return JSON.parse(result.stdout.toString());
  } finally {
    if (temporary) await rm(temporary, { force: true });
  }
}

// The mirror carries only changelog notes; bytes stay on CrabNebula. Preview publishes
// prereleases, Stable promotion requires the final version and publishes the full release.
export const githubTag = (version: string) => `v${releaseVersion(version)}`;
export async function githubRelease(directory: string, manifest: Manifest, channel: Channel, api: typeof ghApi = ghApi) {
  validateManifest(manifest);
  const repository = process.env.GITHUB_REPOSITORY;
  assert.ok(repository && repository.includes("/"), "GitHub Releases require GITHUB_REPOSITORY.");
  if (channel === "stable") assert.ok(!manifest.version.includes("-"), "Stable promotion requires the final version qualified in Preview.");
  const tag = githubTag(manifest.version);
  const notes = await Bun.file(join(directory, "notes.md")).text();
  // Dispatch concurrency serializes publications, so check-then-write cannot race another run.
  const existing = await api(["repos/" + repository + "/releases/tags/" + tag]);
  // Notes belong to creation only: retries and flips keep the changelog already on the release.
  const release: Record<string, unknown> = { tag_name: tag, target_commitish: manifest.revision, name: tag, prerelease: channel === "preview" };
  if (!existing) release.body = notes;
  const written = existing
    ? await api(["-X", "PATCH", `repos/${repository}/releases/${existing.id}`], JSON.stringify(release))
    : await api(["-X", "POST", `repos/${repository}/releases`], JSON.stringify(release));
  assert.equal(written?.tag_name, tag, "The GitHub Release write did not stick.");
  return written;
}

// Each package format keeps its own version history. The public updater endpoint serves the
// newest published release per update platform and channel, or rejects the platform when empty.
export async function assertIncreasing(version: string, channel: Channel, updatePlatform: string, fetcher: typeof fetch = fetch, sleep: (milliseconds: number) => Promise<void> = Bun.sleep) {
  releaseVersion(version);
  if (channel === "stable") assert.ok(!version.includes("-"), "Stable promotion requires the final version qualified in Preview.");
  const url = new URL(`${cdn}/update/${application}/${updatePlatform}/0.0.0`);
  if (channel === "preview") url.searchParams.set("channel", "preview");
  let response = await fetcher(url, { signal: AbortSignal.timeout(60_000) });
  for (let retries = 0; (response.status === 400 || response.status === 404) && retries < 3; retries++) {
    // A just-published release takes minutes to reach every feed region; recheck before trusting "empty".
    await response.body?.cancel();
    console.warn(`Feed ${updatePlatform} not visible yet; rechecking in 20s (${retries + 1}/3).`);
    await sleep(20_000);
    response = await fetcher(url, { signal: AbortSignal.timeout(60_000) });
  }
  if (response.status === 400 || response.status === 404) {
    await response.body?.cancel();
    return;
  }
  assert.equal(response.status, 200, `The ${updatePlatform} update feed answered ${response.status}. Retry later.`);
  const latest = await response.json();
  assert.ok(latest && typeof latest.version === "string", "The update feed returned no release version.");
  assert.ok(Bun.semver.order(version, latest.version) > 0, `Publish a version newer than ${latest.version} in ${channel}.`);
}

export async function downloadPublic(url: string, expected?: FileIdentity, fetcher: typeof fetch = fetch, sleep: (milliseconds: number) => Promise<void> = Bun.sleep) {
  assert.equal(new URL(url).protocol, "https:", "Public downloads require HTTPS.");
  let response = await fetcher(url, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
  for (let retries = 0; (response.status === 429 || response.status === 404) && retries < (response.status === 404 ? 3 : 2); retries++) {
    const retry = response.headers.get("retry-after");
    const milliseconds = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : retry ? Date.parse(retry) - Date.now() : NaN;
    const wait = response.status === 404 ? 20_000 : Number.isNaN(milliseconds) ? 60_000 : Math.max(0, milliseconds);
    await response.body?.cancel();
    assert.ok(Number.isFinite(wait) && wait <= 120_000, `CDN Retry-After exceeds the readiness wait limit: ${url}. Retry verification later.`);
    console.warn(`CDN ${response.status === 404 ? "has not propagated" : "rate limited"} ${url}; retrying in ${wait / 1000}s (${retries + 1}/${response.status === 404 ? 3 : 2}).`);
    await sleep(wait);
    response = await fetcher(url, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
  }
  if (response.status !== 200) await response.body?.cancel();
  assert.equal(response.status, 200, `Public download is not ready: ${url} (${response.status}). Retry verification of the existing release.`);
  assert.equal(new URL(response.url || url).protocol, "https:");
  const maximum = expected?.bytes ?? 64 * 1024;
  assert.ok(response.body, "The download body is missing.");
  const chunks: Uint8Array[] = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.byteLength; assert.ok(size <= maximum, "The download exceeds its expected size."); chunks.push(chunk); }
  const bytes = Buffer.concat(chunks, size);
  if (expected) {
    assert.equal(bytes.length, expected.bytes, `Public download size differs: ${url}`);
    assert.equal(hash(bytes), expected.sha256, `Public download bytes differ: ${url}`);
  }
  return { bytes, finalUrl: response.url || url };
}

export async function verifyPublic(manifest: Manifest, channel: Channel, fetcher: typeof fetch = fetch, sleep: (milliseconds: number) => Promise<void> = Bun.sleep) {
  validateManifest(manifest);
  const checks: { url: string; finalUrl: string; sha256: string }[] = [];
  const get = async (url: string, expected?: FileIdentity) => {
    const result = await downloadPublic(url, expected, fetcher, sleep);
    checks.push({ url, finalUrl: result.finalUrl, sha256: hash(result.bytes) });
    return result.bytes;
  };
  const format = packageFormat(manifest.format), platforms = releasePlatforms(format);
  const files = publicFiles(manifest.version, format);
  const installer = manifest.files[files[0]!]!;
  const updater = manifest.files[files.at(-1)!]!;
  for (const [name, identity] of Object.entries(manifest.files)) await get(downloadUrl(name, channel), identity);
  await get(downloadUrl(`platform/${platforms.public}`, channel), installer);
  // An earlier current version asks for metadata even when this is the first release.
  const endpoint = `https://cdn.crabnebula.app/update/${application}/${platforms.update}/0.0.0` + (channel === "preview" ? "?channel=preview" : "");
  const metadata = JSON.parse(new TextDecoder().decode(await get(endpoint)));
  assert.equal(metadata.version, manifest.version, "CDN still offers another version. Retry verification without republishing.");
  assert.equal(metadata.signature.trim(), updater.signature);
  await get(metadata.url, updater);
  return { version: manifest.version, format: packageFormat(manifest.format), revision: manifest.revision, channel, checkedAt: new Date().toISOString(), files: manifest.files, checks };
}

async function seal(directory: string) {
  const build = await Bun.file("src-tauri/build-info.json").json();
  assert.equal(build.dirty, false, "Release source must be committed.");
  assert.equal(build.target, "x86_64-unknown-linux-gnu");
  assert.equal(build.packaged, true);
  const config = await Bun.file(".artifacts/tauri-release.conf.json").json();
  assert.equal(build.version, config.version);
  assert.equal(config.plugins.updater.pubkey, publicKey(process.env.COUCH_UPDATER_PUBLIC_KEY));
  const format = packageFormat(process.env.COUCH_PACKAGE_FORMAT);
  assert.ok(format === "deb" || format === "appimage", "The hosted builder only seals Linux packages.");
  const inventory = await read(format === "deb" ? ".artifacts/deb-inventory.json" : ".artifacts/appimage-inventory.json");
  const details = JSON.parse(new TextDecoder().decode(inventory));
  assert.deepEqual(details.build, build);
  const manifest: Manifest = { schemaVersion: 1, format, version: build.version, revision: build.revision, publicKey: publicKey(process.env.COUCH_UPDATER_PUBLIC_KEY), inventorySha256: hash(inventory), files: {} };
  if (process.env.GITHUB_RUN_ID) manifest.buildRun = { id: Number(process.env.GITHUB_RUN_ID), attempt: Number(process.env.GITHUB_RUN_ATTEMPT) };
  for (const name of publicFiles(build.version, format)) {
    const path = join(directory, "public", name);
    const bytes = await read(path);
    assert.equal(details.sha256, hash(bytes), "The package inventory describes another artifact");
    manifest.files[name] = { bytes: bytes.length, sha256: hash(bytes), signature: (await Bun.file(join(directory, "signatures", `${name}.sig`)).text()).trim() };
  }
  await verifyFiles(directory, manifest);
  await Bun.write(join(directory, "inventory.json"), inventory);
  await Bun.write(join(directory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
}

if (import.meta.main) {
  const [operation, input = ".artifacts/hosted-release", channelInput = "preview", releaseId] = process.argv.slice(2);
  const directory = resolve(input);
  const channel = channelInput as Channel;
  const channels = channelArgs(channel);
  if (operation === "publish" && channel === "preview") throw new Error("Publish Preview through the four-manifest assembler.");
  if (operation === "draft-source") {
    assert.equal(channel, "preview", "Fresh builds go through Preview before Stable.");
    const version = releaseVersion((await Bun.file("src-tauri/tauri.conf.json").json()).version);
    publicFiles(version, packageFormat(process.env.COUCH_PACKAGE_FORMAT));
    publicKey(process.env.COUCH_UPDATER_PUBLIC_KEY);
    await assertIncreasing(version, channel, releasePlatforms(packageFormat(process.env.COUCH_PACKAGE_FORMAT)).update);
    const release: CloudRelease = releaseId
      ? JSON.parse(cn(["show", application, releaseId, ...channels]))
      : JSON.parse(cn(["draft", application, version, ...channels, "--notes-file", join(directory, "notes.md")]));
    assert.equal(release.status, "Draft");
    assert.equal(release.version, version);
    assert.equal(release.channel, "preview");
    if (releaseId && packageFormat(process.env.COUCH_PACKAGE_FORMAT) === "appimage") {
      assert.ok(release.assets.every(asset => publicFiles(version, "deb").includes(asset.filename)), "Attach AppImage only to a Debian-only draft.");
    } else assert.equal(release.assets.length, 0, "A fresh build cannot replace an uploaded candidate. Reuse its signed receipt or choose a new version.");
    assert.match(release.id, /^[A-Z0-9]{26}$/);
    await Bun.write(join(directory, "draft-preview.json"), JSON.stringify(release, null, 2));
    if (process.env.GITHUB_OUTPUT) await Bun.write(Bun.file(process.env.GITHUB_OUTPUT), `${await Bun.file(process.env.GITHUB_OUTPUT).text()}release-id=${release.id}\n`);
  } else if (operation === "seal") await seal(directory);
  else {
    const manifest: Manifest = await Bun.file(join(directory, "manifest.json")).json();
    if (["verify-receipt", "restore", "resume"].includes(operation!) || !await Bun.file(join(directory, "inventory.json")).exists()) await verifyReceipt(directory);
    else {
      await verifyFiles(directory, manifest);
      assert.equal(hash(await read(join(directory, "inventory.json"))), manifest.inventorySha256, "The retained inventory changed.");
    }
    const key = process.env.COUCH_UPDATER_PUBLIC_KEY;
    if (key) assert.equal(manifest.publicKey, publicKey(key), "The artifact uses another signing key.");
    if (operation === "verify" || operation === "verify-receipt") console.log(`Verified ${manifest.version} from ${manifest.revision}`);
    else if (operation === "qualify") {
      await Bun.write(join(directory, "qualified.json"), JSON.stringify({ version: manifest.version, revision: manifest.revision, files: manifest.files, checks: qualificationChecks(packageFormat(manifest.format)) }, null, 2) + "\n");
    } else if (operation === "restore") await restorePublic(directory, manifest);
    else if (operation === "resume") {
      const uploaded: CloudRelease = await Bun.file(join(directory, "receipts", `upload-${channel}.json`)).json();
      verifyCloud(uploaded, manifest, channel, channel === "preview");
      if (releaseId) assert.equal(releaseId, uploaded.id, "Retry the completed uploaded draft.");
      verifyCloud(JSON.parse(cn(["show", application, uploaded.id, ...channels])), manifest, channel, channel === "preview");
      if (process.env.GITHUB_OUTPUT) await Bun.write(Bun.file(process.env.GITHUB_OUTPUT), `${await Bun.file(process.env.GITHUB_OUTPUT).text()}release-id=${uploaded.id}\n`);
    } else if (operation === "readiness") {
      await Bun.write(join(directory, `readiness-${channel}.json`), JSON.stringify(await verifyPublic(manifest, channel), null, 2) + "\n");
    } else if (operation === "github-release") await githubRelease(directory, manifest, channel);
    else if (operation === "draft") {
      await assertIncreasing(manifest.version, channel, releasePlatforms(packageFormat(manifest.format)).update);
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
      verifyQualification(qualified, manifest);
      if (operation === "upload") await verifyFiles(directory, manifest);
      assert.match(releaseId ?? "", /^[A-Z0-9]{26}$/, "Use the recorded draft release ID for retries.");
      let release: CloudRelease = JSON.parse(cn(["show", application, releaseId!, ...channels]));
      assert.equal(release.status, "Draft", "This release is already published. Run readiness instead.");
      assert.equal(release.version, manifest.version);
      assert.equal(release.channel, channel === "preview" ? "preview" : null);
      if (operation === "upload") {
        // Explicit provider uploads keep private receipts, source and stale bundles out of Cloud.
        for (const name of publicFiles(manifest.version, packageFormat(manifest.format))) {
          const existing = release.assets.find(asset => asset.filename === name);
          if (existing) {
            assert.equal(Number(existing.size), manifest.files[name]!.bytes);
            assert.equal(existing.signature ?? undefined, manifest.files[name]!.signature);
            continue;
          }
          const platforms = assetPlatforms(manifest.version, packageFormat(manifest.format), name);
          const signaturePath = join(directory, "signatures", `${name}.sig`);
          await Bun.write(signaturePath, manifest.files[name]!.signature!);
          cn(["upload", application, releaseId!, ...channels, "--file", join(directory, "public", name), ...(platforms.public ? ["--public-platform", platforms.public] : []), ...(platforms.update ? ["--update-platform", platforms.update] : []), "--signature", signaturePath]);
        }
        release = JSON.parse(cn(["show", application, releaseId!, ...channels]));
      }
      verifyCloud(release, manifest, channel, operation === "upload" && channel === "preview");
      if (operation === "publish") {
        await assertIncreasing(manifest.version, channel, releasePlatforms(packageFormat(manifest.format)).update);
        cn(["publish", application, releaseId!, ...channels]);
        release = JSON.parse(cn(["show", application, releaseId!, ...channels]));
        verifyCloud(release, manifest, channel);
        assert.equal(release.status, "Published");
      }
      await mkdir(join(directory, "receipts"), { recursive: true });
      await Bun.write(join(directory, "receipts", `${operation}-${channel}.json`), JSON.stringify(release, null, 2) + "\n");
    } else throw new Error("Use draft-source, seal, verify, qualify, verify-receipt, restore, resume, draft, upload, publish, readiness or github-release.");
  }
}
