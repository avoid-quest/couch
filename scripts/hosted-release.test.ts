import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { channelArgs, downloadUrl, publicFiles, releaseVersion } from "./hosted-policy";
import { assertIncreasing, hash, verifyCloud, verifyFiles, verifyPublic, type CloudRelease, type Manifest } from "./hosted-release";

const key = (await Bun.file("src-tauri/tests/fixtures/update/public.key").text()).trim();
const signature = (await Bun.file("src-tauri/tests/fixtures/update/archive.sig").text()).trim();
const archive = new Uint8Array(await Bun.file("src-tauri/tests/fixtures/update/archive").arrayBuffer());
function fixture(version = "0.1.0"): Manifest {
  return { schemaVersion: 1, version, revision: "a".repeat(40), publicKey: key, inventorySha256: "b".repeat(64), files: Object.fromEntries(publicFiles(version).map(name => {
    const bytes = name.endsWith(".sig") ? new TextEncoder().encode(signature) : archive;
    return [name, { bytes: bytes.length, sha256: hash(bytes), ...(!name.endsWith(".sig") ? { signature } : {}) }];
  })) };
}
function cloud(manifest: Manifest): CloudRelease {
  return { id: "A".repeat(26), version: manifest.version, channel: null, status: "Draft", assets: Object.entries(manifest.files).map(([filename, file]) => ({ id: filename, filename, size: String(file.bytes), signature: file.signature ?? null, publicPlatform: filename.endsWith(".AppImage") ? "appimage-x86_64" : null, updatePlatform: filename.endsWith(".AppImage") ? "linux-x86_64-appimage" : null })) };
}

describe("hosted versions and promotion", () => {
  test("Preview uses numeric suffixes and final versions can be promoted unchanged", () => {
    const versions = ["0.1.0-preview.9", "0.1.0-preview.10", "0.1.0", "0.2.0-preview.1", "0.2.0"];
    for (const [i, version] of versions.entries()) {
      expect(releaseVersion(version)).toBe(version);
      if (i) expect(Bun.semver.order(versions[i - 1]!, version)).toBe(-1);
    }
    expect(channelArgs("stable")).toEqual([]);
    expect(channelArgs("preview")).toEqual(["--channel", "preview"]);
    for (const version of ["01.0.0", "0.1.0+build.1.1", "0.1.0-preview.01", "0.1.0-beta.1"]) expect(() => releaseVersion(version)).toThrow();
  });
  test("a newer Preview waits for Stable, equal versions do not reinstall, and skips order normally", () => {
    expect(Bun.semver.order("0.2.0-preview.1", "0.1.0")).toBe(1);
    expect(Bun.semver.order("0.2.0", "0.2.0")).toBe(0);
    expect(Bun.semver.order("0.1.0-preview.1", "0.3.0")).toBe(-1);
    expect(() => assertIncreasing([{ version: "0.2.0", channel: null, status: "Published" }], "0.1.0", "stable")).toThrow();
    expect(() => assertIncreasing([], "0.1.0-preview.1", "stable")).toThrow();
    expect(() => assertIncreasing([{ version: "0.1.0", channel: "preview", status: "Published" }], "0.1.0", "stable")).not.toThrow();
  });
  test("Cloud must have the complete approved asset set, platform and original signatures", () => {
    const manifest = fixture();
    expect(() => verifyCloud(cloud(manifest), manifest, "stable")).not.toThrow();
    for (const mutate of [
      (r: CloudRelease) => r.assets.pop(),
      (r: CloudRelease) => r.assets.push({ ...r.assets[0]!, filename: "couch-source.tar.gz" }),
      (r: CloudRelease) => { r.assets[0]!.signature = "changed"; },
      (r: CloudRelease) => { r.assets[0]!.updatePlatform = "linux-x86_64-deb"; },
      (r: CloudRelease) => { r.channel = "stable"; },
    ]) { const release = cloud(manifest); mutate(release); expect(() => verifyCloud(release, manifest, "stable")).toThrow(); }
  });
  test.skipIf(!Bun.which("minisign"))("retained bytes and signatures are verified before reuse", async () => {
    const directory = await mkdtemp(join(tmpdir(), "couch-hosted-test-"));
    try {
      const manifest = fixture();
      for (const name of publicFiles(manifest.version)) await Bun.write(join(directory, "public", name), name.endsWith(".sig") ? signature : archive);
      await verifyFiles(directory, manifest);
      await Bun.write(join(directory, "public", publicFiles(manifest.version)[0]!), "tampered");
      await expect(verifyFiles(directory, manifest)).rejects.toThrow();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  test("public readiness checks all downloads plus installer and Tauri metadata-selected bytes", async () => {
    const manifest = fixture();
    const fetcher = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/update/")) return Response.json({ version: manifest.version, signature, url: "https://assets.example/Couch.AppImage" });
      return new Response(url.includes(".sig") ? signature : archive);
    }) as typeof fetch;
    expect((await verifyPublic(manifest, "preview", fetcher)).checks).toHaveLength(9);
    expect(downloadUrl("platform/appimage-x86_64", "preview")).toEndWith("?channel=preview");
    for (const response of [new Response(null, { status: 404 }), new Response("bad"), Response.json({ version: "0.0.1", signature, url: "https://example.com/app" })]) {
      await expect(verifyPublic(manifest, "preview", (async () => response.clone()) as unknown as typeof fetch)).rejects.toThrow();
    }
  });
});
