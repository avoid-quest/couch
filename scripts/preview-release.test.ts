import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assetPlatforms, publicFiles } from "./hosted-policy";
import { hash, qualificationChecks, type CloudRelease, type Manifest } from "./hosted-release";
import { assemble, uploadNative } from "./preview-release";

test.skipIf(!Bun.which("minisign"))("assembly needs every signed same-revision receipt and all six Cloud assets", async () => {
  const root = await mkdtemp(join(tmpdir(), "couch-preview-assembly-"));
  const saved = { key: process.env.COUCH_UPDATER_PUBLIC_KEY, token: process.env.CN_API_KEY, bin: process.env.CN_BIN, state: process.env.FAKE_CLOUD };
  const run = (args: string[]) => {
    const result = Bun.spawnSync(args, { stderr: "pipe" });
    expect(result.exitCode, result.stderr.toString()).toBe(0);
  };
  try {
    run(["minisign", "-G", "-W", "-p", join(root, "key.pub"), "-s", join(root, "key")]);
    const key = Buffer.from(await Bun.file(join(root, "key.pub")).text()).toString("base64");
    process.env.COUCH_UPDATER_PUBLIC_KEY = key;
    process.env.CN_API_KEY = "fixture";
    process.env.CN_BIN = join(root, "cn");
    process.env.FAKE_CLOUD = join(root, "cloud.json");
    await Bun.write(join(root, "cn"), "#!/bin/sh\ncat \"$FAKE_CLOUD\"\n");
    await chmod(join(root, "cn"), 0o755);
    const version = "0.1.5-preview.11", revision = "a".repeat(40), id = "A".repeat(26);
    const release: CloudRelease = { id, version, channel: "preview", status: "Draft", assets: [] };
    async function receipt(format: "deb" | "appimage" | "dmg" | "nsis", source = revision) {
      const dir = join(root, format);
      await mkdir(join(dir, "receipts"), { recursive: true });
      const files = Object.fromEntries(publicFiles(version, format).map(name => [name, { bytes: 7, sha256: hash(new TextEncoder().encode("archive")), signature: "signed" }]));
      const manifest: Manifest = { schemaVersion: 1, format, version, revision: source, publicKey: key, inventorySha256: "b".repeat(64), files };
      for (const name of ["manifest", "qualified"] as const) {
        const data = name === "manifest" ? manifest : { version, revision: source, files, checks: qualificationChecks(format) };
        const path = join(dir, `${name}.json`);
        await Bun.write(path, JSON.stringify(data));
        run(["minisign", "-S", "-s", join(root, "key"), "-m", path, "-x", `${path}.minisig`]);
        await Bun.write(`${path}.sig`, Buffer.from(await Bun.file(`${path}.minisig`).text()).toString("base64"));
      }
      for (const name of publicFiles(version, format)) {
        const platforms = assetPlatforms(version, format, name);
        release.assets.push({ id: name, filename: name, size: "7", signature: "signed", publicPlatform: platforms.public, updatePlatform: platforms.update });
      }
      await Bun.write(join(dir, "receipts/upload-preview.json"), JSON.stringify(release));
    }
    for (const format of ["deb", "appimage", "dmg", "nsis"] as const) await receipt(format);
    await Bun.write(join(root, "cloud.json"), JSON.stringify(release));
    await expect(assemble(root, id, "verify")).resolves.toBeUndefined();
    const missing = { ...release, assets: release.assets.slice(0, -1) };
    await Bun.write(join(root, "cloud.json"), JSON.stringify(missing));
    await expect(assemble(root, id, "verify")).rejects.toThrow("all six");
    await Bun.write(join(root, "cloud.json"), JSON.stringify(release));
    await receipt("nsis", "c".repeat(40));
    await expect(assemble(root, id, "verify")).rejects.toThrow("one source revision");
  } finally {
    for (const [name, value] of [["COUCH_UPDATER_PUBLIC_KEY", saved.key], ["CN_API_KEY", saved.token], ["CN_BIN", saved.bin], ["FAKE_CLOUD", saved.state]] as const) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
});

test.skipIf(!Bun.which("minisign"))("Mac upload keeps installer and updater platforms separate and retries without replacing bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "couch-preview-upload-"));
  const saved = { key: process.env.COUCH_UPDATER_PUBLIC_KEY, token: process.env.CN_API_KEY, bin: process.env.CN_BIN, state: process.env.FAKE_CLOUD };
  const run = (args: string[]) => {
    const result = Bun.spawnSync(args, { stderr: "pipe" });
    expect(result.exitCode, result.stderr.toString()).toBe(0);
  };
  try {
    run(["minisign", "-G", "-W", "-p", join(root, "key.pub"), "-s", join(root, "key")]);
    const key = Buffer.from(await Bun.file(join(root, "key.pub")).text()).toString("base64");
    const version = "0.1.5-preview.11", id = "A".repeat(26);
    process.env.COUCH_UPDATER_PUBLIC_KEY = key;
    process.env.CN_API_KEY = "fixture";
    process.env.CN_BIN = join(root, "cn");
    process.env.FAKE_CLOUD = join(root, "cloud.json");
    await Bun.write(join(root, "cn"), `#!/usr/bin/env bun
const args = process.argv.slice(2), operation = args[2], path = process.env.FAKE_CLOUD;
const release = await Bun.file(path).json();
if (operation === "upload") {
  const option = flag => args[args.indexOf(flag) + 1];
  const filename = option("--file").split("/").at(-1);
  release.assets.push({ id: filename, filename, size: String(Bun.file(option("--file")).size), signature: (await Bun.file(option("--signature")).text()).trim(), publicPlatform: args.includes("--public-platform") ? option("--public-platform") : null, updatePlatform: args.includes("--update-platform") ? option("--update-platform") : null });
  await Bun.write(path, JSON.stringify(release));
}
console.log(JSON.stringify(release));
`);
    await chmod(join(root, "cn"), 0o755);
    const release: CloudRelease = { id, version, channel: "preview", status: "Draft", assets: [] };
    await Bun.write(join(root, "cloud.json"), JSON.stringify(release));
    const dir = join(root, "dmg");
    await mkdir(join(dir, "public"), { recursive: true });
    await mkdir(join(dir, "signatures"), { recursive: true });
    const files: Manifest["files"] = {};
    for (const name of publicFiles(version, "dmg")) {
      const path = join(dir, "public", name);
      await Bun.write(path, "archive");
      run(["minisign", "-S", "-s", join(root, "key"), "-m", path, "-x", `${path}.minisig`]);
      const signature = Buffer.from(await Bun.file(`${path}.minisig`).text()).toString("base64");
      files[name] = { bytes: 7, sha256: hash(new TextEncoder().encode("archive")), signature };
      await Bun.write(join(dir, "signatures", `${name}.sig`), signature);
      await rm(`${path}.minisig`);
    }
    const inventory = "inventory";
    const manifest: Manifest = { schemaVersion: 1, format: "dmg", version, revision: "a".repeat(40), publicKey: key, inventorySha256: hash(new TextEncoder().encode(inventory)), files };
    await Bun.write(join(dir, "inventory.json"), inventory);
    for (const [name, data] of [["manifest", manifest], ["qualified", { version, revision: manifest.revision, files, checks: qualificationChecks("dmg") }]] as const) {
      const path = join(dir, `${name}.json`);
      await Bun.write(path, JSON.stringify(data));
      run(["minisign", "-S", "-s", join(root, "key"), "-m", path, "-x", `${path}.minisig`]);
      await Bun.write(`${path}.sig`, Buffer.from(await Bun.file(`${path}.minisig`).text()).toString("base64"));
    }
    await uploadNative(dir, id);
    await uploadNative(dir, id);
    const uploaded: CloudRelease = await Bun.file(join(root, "cloud.json")).json();
    expect(uploaded.assets).toHaveLength(2);
    expect(uploaded.assets.map(asset => [asset.publicPlatform, asset.updatePlatform])).toEqual([["dmg-aarch64", null], [null, "darwin-aarch64"]]);
    expect((await Bun.file(join(dir, "receipts/upload-preview.json")).json()).assets).toHaveLength(2);
  } finally {
    for (const [name, value] of [["COUCH_UPDATER_PUBLIC_KEY", saved.key], ["CN_API_KEY", saved.token], ["CN_BIN", saved.bin], ["FAKE_CLOUD", saved.state]] as const) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
});
