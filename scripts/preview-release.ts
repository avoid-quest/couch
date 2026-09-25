import { strict as assert } from "node:assert";
import { cp, mkdir, rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { application, assetPlatforms, publicFiles, publicKey, releasePlatforms } from "./hosted-policy";
import { assertIncreasing, githubRelease, hash, qualificationChecks, verifyCloud, verifyFiles, verifyPublic, verifyReceipt, type CloudRelease, type Manifest } from "./hosted-release";

const formats = ["deb", "appimage", "dmg", "nsis"] as const;
const allNames = (version: string) => formats.flatMap(format => publicFiles(version, format));

function run(args: string[]) {
  const result = Bun.spawnSync(args, { stderr: "inherit", env: { ...process.env, CI: "true" }, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.exitCode, 0, `Failed: ${args[0]} ${args[1] ?? ""}`);
  return result.stdout.toString().trim();
}
function cn(args: string[]) {
  assert.ok(process.env.CN_API_KEY, "Supply CN_API_KEY only for Cloud operations.");
  return run([process.env.CN_BIN ?? "cn", "--no-quality-reports", "release", ...args]);
}
function show(id: string) {
  assert.match(id, /^[A-Z0-9]{26}$/, "Use the recorded Preview draft ID.");
  return JSON.parse(cn(["show", application, id, "--channel", "preview"])) as CloudRelease;
}
function sign(path: string) {
  assert.ok(process.env.TAURI_SIGNING_PRIVATE_KEY, "Supply the enrolled signing key only while sealing receipts.");
  run([process.execPath, "x", "--no-install", "tauri", "signer", "sign", path]);
}

// The platform verifiers wrote these inventories after inspecting the real package bytes.
export async function sealNative(format: "dmg" | "nsis", directory: string) {
  const inventoryPath = `.artifacts/${format === "dmg" ? "mac" : "windows"}-inventory.json`;
  const inventoryBytes = new Uint8Array(await Bun.file(inventoryPath).arrayBuffer());
  const inventory = JSON.parse(new TextDecoder().decode(inventoryBytes));
  const revision = run(["git", "rev-parse", "HEAD"]);
  const version = (await Bun.file("src-tauri/tauri.conf.json").json()).version as string;
  const key = publicKey(process.env.COUCH_UPDATER_PUBLIC_KEY);
  assert.equal(inventory.build?.revision ?? inventory.revision, revision, "Package inventory belongs to another revision.");
  assert.equal(inventory.build?.version ?? inventory.version, version, "Package inventory belongs to another version.");
  assert.equal(inventory.build?.dirty ?? false, false, "Package inventory has dirty source.");
  assert.equal(inventory.build?.clientOnly ?? inventory.clientOnly, false, "Desktop packages must be Full capable.");
  assert.equal(inventory.build?.target ?? inventory.target, format === "dmg" ? "aarch64-apple-darwin" : "x86_64-pc-windows-msvc");
  const entries = format === "dmg"
    ? [inventory.dmg, inventory.updater]
    : [{ ...inventory.installer, path: join("src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis", inventory.installer.name) }, { ...inventory.update, path: join("src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis", inventory.update.name) }];
  assert.deepEqual(entries.map(entry => basename(entry.path)), publicFiles(version, format), "Tauri asset names differ from the release allowlist.");
  const manifest: Manifest = { schemaVersion: 1, format, version, revision, publicKey: key, inventorySha256: hash(inventoryBytes), files: {} };
  if (process.env.GITHUB_RUN_ID) manifest.buildRun = { id: Number(process.env.GITHUB_RUN_ID), attempt: Number(process.env.GITHUB_RUN_ATTEMPT) };
  await mkdir(join(directory, "public"), { recursive: true });
  await mkdir(join(directory, "signatures"), { recursive: true });
  for (const entry of entries) {
    const name = basename(entry.path), path = join(directory, "public", name);
    await cp(entry.path, path);
    const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
    assert.equal(bytes.length, entry.bytes, `Inventory size differs: ${name}`);
    assert.equal(hash(bytes), entry.sha256, `Inventory hash differs: ${name}`);
    if (format === "dmg" && name.endsWith(".dmg")) sign(path);
    else await cp(`${entry.path}.sig`, `${path}.sig`);
    const signature = (await Bun.file(`${path}.sig`).text()).trim();
    manifest.files[name] = { bytes: bytes.length, sha256: hash(bytes), signature };
    await Bun.write(join(directory, "signatures", `${name}.sig`), signature);
    await rm(`${path}.sig`);
  }
  await verifyFiles(directory, manifest);
  const qualified = { version, revision, files: manifest.files, checks: qualificationChecks(format) };
  await Bun.write(join(directory, "inventory.json"), inventoryBytes);
  await Bun.write(join(directory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  await Bun.write(join(directory, "qualified.json"), JSON.stringify(qualified, null, 2) + "\n");
  sign(join(directory, "manifest.json"));
  sign(join(directory, "qualified.json"));
  await verifyReceipt(directory);
  console.log(`Sealed ${format} ${version} from ${revision}.`);
}

function checkDraft(release: CloudRelease, manifest: Manifest, id: string) {
  assert.equal(release.id, id);
  assert.equal(release.version, manifest.version);
  assert.equal(release.channel, "preview");
  assert.equal(release.status, "Draft", "Use a new version after publication.");
  assert.ok(release.assets.every(asset => allNames(manifest.version).includes(asset.filename)), "Draft contains an unapproved asset.");
  assert.equal(new Set(release.assets.map(asset => asset.filename)).size, release.assets.length, "Draft has duplicate asset names.");
}

export async function uploadNative(directory: string, id: string) {
  const manifest = await verifyReceipt(directory);
  const format = manifest.format;
  assert.ok(format === "dmg" || format === "nsis", "Use Package for Linux uploads.");
  await verifyFiles(directory, manifest);
  assert.equal(hash(new Uint8Array(await Bun.file(join(directory, "inventory.json")).arrayBuffer())), manifest.inventorySha256);
  let release = show(id);
  checkDraft(release, manifest, id);
  for (const name of publicFiles(manifest.version, format)) {
    const asset = release.assets.find(value => value.filename === name);
    const expected = manifest.files[name]!;
    const platforms = assetPlatforms(manifest.version, format, name);
    if (asset) {
      assert.equal(Number(asset.size), expected.bytes);
      assert.equal(asset.signature, expected.signature);
      assert.equal(asset.publicPlatform, platforms.public);
      assert.equal(asset.updatePlatform, platforms.update);
      continue;
    }
    cn(["upload", application, id, "--channel", "preview", "--file", join(directory, "public", name), ...(platforms.public ? ["--public-platform", platforms.public] : []), ...(platforms.update ? ["--update-platform", platforms.update] : []), "--signature", join(directory, "signatures", `${name}.sig`)]);
    release = show(id);
    checkDraft(release, manifest, id);
  }
  verifyCloud(release, manifest, "preview", true);
  await mkdir(join(directory, "receipts"), { recursive: true });
  await Bun.write(join(directory, "receipts/upload-preview.json"), JSON.stringify(release, null, 2) + "\n");
  console.log(`Uploaded exact qualified ${format} bytes to Preview draft ${id}.`);
}

export async function assemble(directory: string, id: string, operation: "verify" | "publish" | "readiness") {
  const manifests = await Promise.all(formats.map(format => verifyReceipt(join(directory, format))));
  const [first] = manifests;
  for (let i = 0; i < formats.length; i++) {
    const manifest = manifests[i]!;
    assert.equal(manifest.format, formats[i], "Receipt directory format differs.");
    assert.equal(manifest.version, first!.version, "All platforms need one version.");
    assert.equal(manifest.revision, first!.revision, "All platforms need one source revision.");
    assert.equal(manifest.publicKey, first!.publicKey, "All platforms need one enrolled key.");
    const receipt: CloudRelease = await Bun.file(join(directory, formats[i]!, "receipts/upload-preview.json")).json();
    assert.equal(receipt.id, id, "The upload receipt belongs to another draft.");
    verifyCloud(receipt, manifest, "preview", true);
  }
  const release = show(id);
  assert.equal(release.version, first!.version);
  assert.equal(release.channel, "preview");
  assert.deepEqual(release.assets.map(asset => asset.filename).sort(), allNames(first!.version).sort(), "Preview needs all six approved assets.");
  for (const manifest of manifests) verifyCloud(release, manifest, "preview", true);
  if (operation === "verify") return;
  if (operation === "publish") {
    assert.equal(release.status, "Draft", "This release is already published. Run readiness.");
    for (const format of formats) await assertIncreasing(first!.version, "preview", releasePlatforms(format).update);
    cn(["publish", application, id, "--channel", "preview"]);
    const published = show(id);
    assert.equal(published.status, "Published");
    for (const manifest of manifests) verifyCloud(published, manifest, "preview", true);
    await Bun.write(join(directory, "publish-preview.json"), JSON.stringify(published, null, 2) + "\n");
    return;
  }
  assert.equal(release.status, "Published");
  for (let i = 0; i < formats.length; i++) {
    const path = join(directory, formats[i]!);
    await Bun.write(join(path, "readiness-preview.json"), JSON.stringify(await verifyPublic(manifests[i]!, "preview"), null, 2) + "\n");
  }
  assert.equal(run(["git", "rev-parse", "HEAD"]), first!.revision, "Mirror only from the released source revision.");
  await Bun.write(join(directory, "notes.md"), run([process.execPath, "scripts/release-notes.ts", first!.revision]) + "\n");
  await githubRelease(directory, first!, "preview");
  console.log(`All four Preview feeds serve ${first!.version}; retain signed receipts and readiness results.`);
}

if (import.meta.main) {
  const [operation, input, arg] = process.argv.slice(2);
  assert.ok(input, "Use seal <dmg|nsis> <directory>, upload <directory> <draft-id>, or verify/publish/readiness <assembly-directory> <draft-id>.");
  if (operation === "seal" || operation === "upload" || operation === "publish" || operation === "readiness") {
    assert.equal(process.env.GITHUB_ACTIONS, "true", "Production Preview operations run only in GitHub Actions.");
    assert.equal(process.env.GITHUB_REF, "refs/heads/main", "Production Preview operations require main.");
    assert.equal(process.env.COUCH_RELEASES_ENABLED, "true", "Enable releases before production Preview operations.");
  }
  if (operation === "seal") {
    assert.ok(input === "dmg" || input === "nsis");
    assert.ok(arg);
    await sealNative(input, resolve(arg));
  } else if (operation === "upload") {
    assert.ok(arg);
    await uploadNative(resolve(input), arg);
  } else if (operation === "verify" || operation === "publish" || operation === "readiness") {
    assert.ok(arg);
    await assemble(resolve(input), arg, operation);
  } else throw new Error("Unknown Preview operation.");
}
