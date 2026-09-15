import { describe, expect, spyOn, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { channelArgs, downloadUrl, publicFiles, releaseVersion } from "./hosted-policy";
import { assertIncreasing, hash, qualificationChecks, restorePublic, verifyCloud, verifyFiles, verifyPublic, verifyQualification, verifyReceipt, type CloudRelease, type Manifest } from "./hosted-release";

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
    expect(() => assertIncreasing([{ version: "0.1.0", channel: "preview", status: "Published", assets: [{ updatePlatform: "linux-x86_64-appimage" }] }], "0.1.0", "preview", "linux-x86_64-deb")).not.toThrow();
    expect(() => assertIncreasing([{ version: "0.1.0", channel: "preview", status: "Published", assets: [{ updatePlatform: "linux-x86_64-deb" }] }], "0.1.0", "preview", "linux-x86_64-deb")).toThrow();
    expect(() => assertIncreasing([{ version: "0.1.0", channel: "preview", status: "Published" }], "0.1.0", "preview", "linux-x86_64-deb")).toThrow();
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
  test("a rate-limited metadata-selected asset waits and retries only that download", async () => {
    const manifest = fixture(), calls: string[] = [], waits: number[] = [];
    let limitedBodyCancelled = false;
    const fetcher = (async (input: string | URL | Request) => {
      const url = String(input); calls.push(url);
      if (url.includes("/update/")) return Response.json({ version: manifest.version, signature, url: "https://assets.example/Couch.AppImage" });
      if (url === "https://assets.example/Couch.AppImage" && calls.filter(value => value === url).length === 1) {
        return new Response(new ReadableStream({ cancel() { limitedBodyCancelled = true; } }), { status: 429, headers: { "Retry-After": "51" } });
      }
      return new Response(url.includes(".sig") ? signature : archive);
    }) as typeof fetch;
    expect((await verifyPublic(manifest, "preview", fetcher, async wait => { waits.push(wait); })).checks).toHaveLength(9);
    expect(waits).toEqual([51_000]);
    expect(calls).toHaveLength(10);
    expect(calls.slice(-2)).toEqual(["https://assets.example/Couch.AppImage", "https://assets.example/Couch.AppImage"]);
    expect(limitedBodyCancelled).toBe(true);
  });
  test("rate-limit waits support HTTP dates and fallbacks, stop after two retries, and reject excessive waits", async () => {
    const clock = spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-15T00:00:00Z"));
    try {
      for (const [header, wait] of [["Tue, 15 Sep 2026 00:00:51 GMT", 51_000], ["invalid", 60_000], [null, 60_000], ["0", 0], ["121", null]] as const) {
        let calls = 0; const waits: number[] = [];
        const fetcher = (async () => { calls++; return new Response(null, { status: 429, headers: header === null ? {} : { "Retry-After": header } }); }) as unknown as typeof fetch;
        await expect(verifyPublic(fixture(), "preview", fetcher, async milliseconds => { waits.push(milliseconds); })).rejects.toThrow();
        expect(calls).toBe(wait === null ? 1 : 3);
        expect(waits).toEqual(wait === null ? [] : [wait, wait]);
      }
    } finally { clock.mockRestore(); }
  });
  test("a successful retry still rejects changed asset bytes", async () => {
    let calls = 0;
    const fetcher = (async () => ++calls === 1 ? new Response(null, { status: 429, headers: { "Retry-After": "51" } }) : new Response(new Uint8Array(archive.length))) as unknown as typeof fetch;
    await expect(verifyPublic(fixture(), "preview", fetcher, async () => {})).rejects.toThrow("Public download bytes differ");
    expect(calls).toBe(2);
  });
});

describe("native package delivery", () => {
  function nativeFixture(): Manifest {
    const manifest = fixture();
    return { ...manifest, format: "deb", files: { [publicFiles(manifest.version, "deb")[0]!]: { bytes: archive.length, sha256: hash(archive), signature } } };
  }

  test("one public Debian package carries its signature in provider metadata", async () => {
    const manifest = nativeFixture(), release = cloud(manifest);
    release.assets[0]!.publicPlatform = "deb-x86_64";
    release.assets[0]!.updatePlatform = "linux-x86_64-deb";
    expect(() => verifyCloud(release, manifest, "stable")).not.toThrow();
    expect(publicFiles("0.1.1", "deb")).toEqual(["Couch_0.1.1_amd64.deb"]);
    expect(() => publicFiles("0.1.1-preview.1", "deb")).toThrow("final");
    expect(publicFiles("0.1.0")).toHaveLength(6);
    const urls: string[] = [];
    const receipt = await verifyPublic(manifest, "preview", (async input => {
      const url = String(input); urls.push(url);
      return url.includes("/update/") ? Response.json({ version: manifest.version, signature, url: "https://cdn.crabnebula.app/asset/AAAAAAAAAAAAAAAAAAAAAAAAAA" }) : new Response(archive);
    }) as typeof fetch);
    expect(receipt.format).toBe("deb");
    expect(receipt.checks).toHaveLength(4);
    expect(urls.some(url => url.includes("linux-x86_64-deb"))).toBe(true);
    expect(urls.some(url => url.includes("platform/deb-x86_64"))).toBe(true);
    expect(urls.some(url => url.includes(".sig"))).toBe(false);
    const qualified = { ...manifest, checks: qualificationChecks("deb") };
    expect(() => verifyQualification(qualified, manifest)).not.toThrow();
    expect(() => verifyQualification({ ...qualified, checks: qualificationChecks("appimage") }, manifest)).toThrow();
  });

  test.skipIf(!Bun.which("minisign"))("restore uses the recorded immutable Preview URL, rejects tampering, and needs no public signature file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "couch-native-restore-"));
    try {
      const manifest = nativeFixture(), name = Object.keys(manifest.files)[0]!;
      const finalUrl = "https://cdn.crabnebula.app/asset/AAAAAAAAAAAAAAAAAAAAAAAAAA";
      const receipt = { ...manifest, channel: "preview", checks: [{ url: downloadUrl(name, "preview"), finalUrl, sha256: hash(archive) }] };
      await Bun.write(join(directory, "readiness-preview.json"), JSON.stringify(receipt));
      const calls: string[] = [];
      await restorePublic(directory, manifest, (async input => { calls.push(String(input)); return new Response(archive); }) as typeof fetch);
      expect(calls).toEqual([finalUrl]);
      expect(await Bun.file(join(directory, "public", `${name}.sig`)).exists()).toBe(false);
      await expect(restorePublic(directory, manifest, (async () => new Response("tampered")) as unknown as typeof fetch)).rejects.toThrow();
      receipt.checks[0]!.finalUrl = "https://another.example/asset/AAAAAAAAAAAAAAAAAAAAAAAAAA";
      await Bun.write(join(directory, "readiness-preview.json"), JSON.stringify(receipt));
      await expect(restorePublic(directory, manifest)).rejects.toThrow();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  test.skipIf(!Bun.which("minisign"))("only authentic complete qualification receipts authorize binary-free retries", async () => {
    const directory = await mkdtemp(join(tmpdir(), "couch-native-receipt-"));
    const previousKey = process.env.COUCH_UPDATER_PUBLIC_KEY;
    const run = (args: string[]) => {
      const result = Bun.spawnSync(["minisign", ...args], { stdout: "ignore", stderr: "pipe" });
      expect(result.exitCode).toBe(0);
    };
    try {
      run(["-G", "-W", "-p", join(directory, "key.pub"), "-s", join(directory, "key")]);
      const manifest = { ...nativeFixture(), publicKey: Buffer.from(await Bun.file(join(directory, "key.pub")).text()).toString("base64") };
      process.env.COUCH_UPDATER_PUBLIC_KEY = manifest.publicKey;
      const qualified = { version: manifest.version, revision: manifest.revision, files: manifest.files, checks: qualificationChecks("deb") };
      for (const [name, value] of [["manifest.json", manifest], ["qualified.json", qualified]] as const) {
        const file = join(directory, name);
        await Bun.write(file, JSON.stringify(value));
        run(["-S", "-s", join(directory, "key"), "-m", file, "-x", `${file}.minisig`]);
        await Bun.write(`${file}.sig`, Buffer.from(await Bun.file(`${file}.minisig`).text()).toString("base64"));
      }
      expect((await verifyReceipt(directory)).revision).toBe(manifest.revision);
      await Bun.write(join(directory, "qualified.json"), JSON.stringify({ ...qualified, checks: [] }));
      await expect(verifyReceipt(directory)).rejects.toThrow();
      process.env.COUCH_UPDATER_PUBLIC_KEY = key;
      await expect(verifyReceipt(directory)).rejects.toThrow("production key");
    } finally {
      if (previousKey === undefined) delete process.env.COUCH_UPDATER_PUBLIC_KEY; else process.env.COUCH_UPDATER_PUBLIC_KEY = previousKey;
      await rm(directory, { recursive: true, force: true });
    }
  });

  test.skipIf(!Bun.which("minisign"))("a qualified native upload and later publication reuse only signed receipts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "couch-native-cloud-"));
    const execute = async (args: string[], env?: Record<string, string>) => {
      const child = Bun.spawn(args, { env: env ?? process.env, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      expect(code, stderr).toBe(0);
      return stdout;
    };
    try {
      await execute(["minisign", "-G", "-W", "-p", join(directory, "key.pub"), "-s", join(directory, "key")]);
      const sign = async (file: string) => {
        await execute(["minisign", "-S", "-s", join(directory, "key"), "-m", file, "-x", `${file}.minisig`]);
        const signature = Buffer.from(await Bun.file(`${file}.minisig`).text()).toString("base64");
        await Bun.write(`${file}.sig`, signature);
        await rm(`${file}.minisig`);
        return signature;
      };
      const manifest = nativeFixture(), name = Object.keys(manifest.files)[0]!;
      const app = join(directory, "public", name);
      await Bun.write(app, archive);
      manifest.publicKey = Buffer.from(await Bun.file(join(directory, "key.pub")).text()).toString("base64");
      manifest.files[name]!.signature = await sign(app);
      await rm(`${app}.sig`);
      await Bun.write(join(directory, "manifest.json"), JSON.stringify(manifest));
      await sign(join(directory, "manifest.json"));
      await Bun.write(join(directory, "qualified.json"), JSON.stringify({ ...manifest, checks: qualificationChecks("deb") }));
      await sign(join(directory, "qualified.json"));
      const fake = join(directory, "cn");
      await Bun.write(fake, `#!/usr/bin/env bun
const [flag, release, operation, application, id, ...args] = process.argv.slice(2);
const stateFile = process.env.COUCH_FAKE_STATE;
const state = await Bun.file(stateFile).json();
if (operation === "upload") {
  const option = name => args[args.indexOf(name) + 1];
  if (!args.includes("--signature")) throw Error("Missing provider signature metadata");
  const path = option("--file");
  state.assets.push({id:"BBBBBBBBBBBBBBBBBBBBBBBBBB",filename:path.split("/").at(-1),size:String(Bun.file(path).size),signature:(await Bun.file(option("--signature")).text()).trim(),publicPlatform:option("--public-platform"),updatePlatform:option("--update-platform")});
}
if (operation === "publish") state.status = "Published";
await Bun.write(stateFile, JSON.stringify(state));
console.log(JSON.stringify(operation === "list" ? [] : state));
`);
      await chmod(fake, 0o755);
      const stateFile = join(directory, "cloud.json"), releaseId = "A".repeat(26);
      await Bun.write(stateFile, JSON.stringify({ id: releaseId, version: manifest.version, channel: "preview", status: "Draft", assets: [] }));
      const env = { PATH: process.env.PATH!, CN_BIN: fake, COUCH_FAKE_STATE: stateFile, COUCH_UPDATER_PUBLIC_KEY: manifest.publicKey };
      const command = (operation: string) => [process.execPath, "scripts/hosted-release.ts", operation, directory, "preview", releaseId];
      await execute(command("upload"), env);
      const uploaded = await Bun.file(stateFile).json();
      expect(uploaded.assets).toHaveLength(1);
      expect(uploaded.assets[0].signature).toBe(manifest.files[name]!.signature);
      expect(uploaded.assets[0].updatePlatform).toBe("linux-x86_64-deb");
      await rm(join(directory, "public"), { recursive: true });
      await execute(command("resume"), env);
      await execute(command("publish"), env);
      expect((await Bun.file(stateFile).json()).status).toBe("Published");
      expect(await Bun.file(join(directory, "public", name)).exists()).toBe(false);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
