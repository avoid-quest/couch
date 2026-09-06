import { strict as assert } from "node:assert";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const image = "jellyfin/jellyfin:10.11.11";
export const sha256 = (bytes: Uint8Array | ArrayBuffer) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
export function pgsPackets(bytes: Uint8Array) {
  const data = Buffer.from(bytes), packets = [];
  for (let offset = 0; offset < data.length;) {
    assert.ok(offset + 13 <= data.length && data.readUInt16BE(offset) === 0x5047, "Complete PGS packet header");
    const length = data.readUInt16BE(offset + 11);
    assert.ok(offset + 13 + length <= data.length, "Complete PGS packet body");
    packets.push({ pts: data.readUInt32BE(offset + 2), type: data[offset + 10], length, body: sha256(data.subarray(offset + 13, offset + 13 + length)) });
    offset += 13 + length;
  }
  return packets;
}

/** Disposable official server and generated media only. Credentials stay in this process. */
export async function startSubtitleFixture(corpusPath: string, evidencePath: string) {
  const corpus = resolve(corpusPath), evidence = resolve(evidencePath);
  const name = `couch-jellyfin-subtitles-${crypto.randomUUID().slice(0, 8)}`;
  let container = false, network = false;
  const run = async (...args: string[]) => {
    const child = Bun.spawn(["docker", ...args], { stdout: "pipe", stderr: "pipe", timeout: 30_000 });
    const [output, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    assert.equal(code, 0, error);
    return output.trim();
  };
  const close = async () => {
    try { if (container) await run("rm", "--force", name); }
    finally { if (network) await run("network", "rm", name); }
  };
  try {
    await mkdir(evidence, { recursive: true, mode: 0o700 });
    const imageId = await run("image", "inspect", image, "--format", "{{.Id}}");
    assert.equal(imageId, "sha256:aefb67e6a7ff1debdd154a78a7bbb780fd0c873d8639210a7f6a2016ad2b35db", "Reviewed official Jellyfin image");
    const original = Buffer.from(await Bun.file(`${corpus}/images.sup`).arrayBuffer());
    assert.equal(sha256(original), "987c17c2b9849ea422072bb15d1559385aa7dd70ae165ab40ea145a911b0318a", "Preserved generated corpus");
    // Explicit blank at zero prevents the server's codec-copy extraction from shifting the first cue.
    const blank = Buffer.alloc(37);
    blank.write("PG"); blank[10] = 0x16; blank.writeUInt16BE(11, 11);
    original.copy(blank, 13, 13, 24); blank[23] = 0;
    blank.write("PG", 24); blank[34] = 0x80;
    const anchored = Buffer.concat([blank, original]);
    const background = await Bun.file(`${corpus}/background.mkv`).arrayBuffer();
    assert.equal(sha256(background), "017cd96c92c8eba861e44ab86d8366fb4ae664c257bd2ecc36fc82f0446e1bb9");
    assert.deepEqual(pgsPackets(anchored).slice(2), pgsPackets(original));
    await Bun.write(`${evidence}/original.sup`, original);
    await Bun.write(`${evidence}/zero.sup`, anchored);
    await run("run", "--rm", "--cpus", "2", "--memory", "2g", "--mount", `type=bind,source=${evidence},target=/evidence`, "--entrypoint", "/bin/sh", image, "-c", 'for kind in original zero; do /usr/lib/jellyfin-ffmpeg/ffmpeg -v error -y -copyts -i /evidence/$kind.sup -c:s copy -f matroska /evidence/$kind.mks; done');
    for (const variant of ["Zero", "Raw", "Late", "Invalid", "Missing", "Failed"]) {
      const folder = `${evidence}/media/${variant}`;
      await mkdir(folder, { recursive: true });
      await Bun.write(`${folder}/${variant}.mkv`, background);
      await Bun.write(`${folder}/${variant}.eng.${variant === "Raw" ? "sup" : "mks"}`, Bun.file(`${evidence}/${variant === "Raw" ? "original.sup" : variant === "Late" ? "original.mks" : "zero.mks"}`));
    }
    await run("network", "create", name); network = true;
    await run("run", "--detach", "--name", name, "--network", name, "--network-alias", "jellyfin", "--publish", "127.0.0.1::8096", "--cpus", "2", "--memory", "2g", "--mount", `type=bind,source=${evidence}/media,target=/media,readonly`, "--tmpfs", "/config", "--tmpfs", "/cache", image); container = true;
    const binding = await run("port", name, "8096/tcp");
    assert.match(binding, /^127\.0\.0\.1:\d+$/);
    const url = `http://${binding}`;
    let token = "";
    const username = "subtitle-fixture", password = crypto.randomUUID() + crypto.randomUUID();
    const request = async (path: string, body?: unknown) => {
      const response = await fetch(url + path, { method: body === undefined ? "GET" : "POST", signal: AbortSignal.timeout(10_000), headers: {
        "Content-Type": "application/json", Authorization: `MediaBrowser Client="Couch fixture", Device="Test", DeviceId="${name}", Version="0.1.0"${token ? `, Token="${token}"` : ""}`,
      }, body: body === undefined ? undefined : JSON.stringify(body) });
      assert.ok(response.ok, `Fixture API ${path.split("?")[0]} returned ${response.status}`);
      const text = await response.text(); return text ? JSON.parse(text) : null;
    };
    const until = async (label: string, check: () => Promise<any>) => {
      const deadline = Date.now() + 90_000;
      while (Date.now() < deadline) { try { const result = await check(); if (result) return result; } catch { /* Startup and library scanning are asynchronous. */ } await Bun.sleep(250); }
      throw new Error(`Fixture timeout: ${label}`);
    };
    const info = await until("complete public startup state", async () => { const result = await request("/System/Info/Public"); return typeof result.StartupWizardCompleted === "boolean" ? result : null; });
    assert.equal(info.StartupWizardCompleted, false);
    assert.equal(info.Version, "10.11.11");
    await request("/Startup/Configuration", { UICulture: "en-US", MetadataCountryCode: "US", PreferredMetadataLanguage: "en" });
    await request("/Startup/User");
    await request("/Startup/User", { Name: username, Password: password });
    await request("/Startup/RemoteAccess", { EnableRemoteAccess: true, EnableAutomaticPortMapping: false });
    await request("/Startup/Complete", {});
    const auth = await request("/Users/AuthenticateByName", { Username: username, Pw: password }); token = auth.AccessToken;
    await request("/Library/VirtualFolders?name=Subtitles&collectionType=movies&refreshLibrary=true", { LibraryOptions: { PathInfos: [{ Path: "/media" }], EnableRealtimeMonitor: false, TypeOptions: [{ Type: "Movie", MetadataFetchers: [], ImageFetchers: [] }] } });
    const items = await until("six image subtitle fixtures", async () => {
      const page = await request(`/Items?recursive=true&includeItemTypes=Movie&fields=MediaStreams&userId=${auth.User.Id}`);
      return page.Items.length === 6 && page.Items.every((item: any) => item.MediaStreams?.some((stream: any) => stream.IsExternal)) ? page.Items : null;
    });
    const item = (title: string) => { const result = items.find((entry: any) => entry.Name === title); assert.ok(result, title); return result; };
    const download = async (title: string) => {
      const entry = item(title);
      const playback = await request(`/Items/${entry.Id}/PlaybackInfo`, { UserId: auth.User.Id, EnableDirectPlay: true, EnableDirectStream: false, EnableTranscoding: false, DeviceProfile: { Name: "PGS qualification", DirectPlayProfiles: [{ Type: "Video" }], SubtitleProfiles: [{ Format: "pgssub", Method: "External" }] } });
      const source = playback.MediaSources[0], track = source.MediaStreams.find((stream: any) => stream.IsExternal);
      const response = await fetch(`${url}/Videos/${entry.Id}/${source.Id}/Subtitles/${track.Index}/Stream.pgssub?copyTimestamps=true`, { headers: { "X-Emby-Token": token }, signal: AbortSignal.timeout(10_000) });
      const bytes = new Uint8Array(await response.arrayBuffer());
      await Bun.write(`${evidence}/${title}-response.sup`, bytes);
      return { bytes, status: response.status, type: response.headers.get("Content-Type"), codec: track.Codec, external: track.IsExternal, pathExtension: track.Path?.split(".").at(-1) };
    };
    const positive = await download("Zero"), raw = await download("Raw"), late = await download("Late");
    assert.equal(positive.status, 200); assert.equal(positive.pathExtension, "mks");
    assert.deepEqual(pgsPackets(positive.bytes), pgsPackets(anchored), "Codec-copy response preserves all display timestamps and payloads");
    let invalidRaw = false;
    try { pgsPackets(raw.bytes); } catch { invalidRaw = true; }
    assert.equal(raw.status, 200); assert.ok(invalidRaw, "Direct SUP response retains the upstream framing failure");
    assert.equal(late.status, 200);
    const originalPackets = pgsPackets(original), latePackets = pgsPackets(late.bytes);
    assert.deepEqual(latePackets, originalPackets.map(packet => ({ ...packet, pts: packet.pts - originalPackets[0]!.pts })), "Unanchored Matroska preserves payloads but shifts authored timing");
    const summary = { server: info.Version, image: imageId, background: sha256(background), zero: { matroskaHash: sha256(await Bun.file(`${evidence}/zero.mks`).arrayBuffer()), sampleHash: sha256(anchored), responseHash: sha256(positive.bytes), bytes: positive.bytes.length, packets: pgsPackets(positive.bytes) }, raw: { sampleHash: sha256(original), responseHash: sha256(raw.bytes), status: raw.status, bytes: raw.bytes.length, invalidFraming: invalidRaw }, late: { matroskaHash: sha256(await Bun.file(`${evidence}/original.mks`).arrayBuffer()), responseHash: sha256(late.bytes), packets: pgsPackets(late.bytes), originalFirstPts: pgsPackets(original)[0]!.pts } };
    await Bun.write(`${evidence}/api-result.json`, JSON.stringify(summary, null, 2));
    // Only these never-downloaded items are damaged; positive extraction/cache stays untouched.
    await Bun.write(`${evidence}/media/Invalid/Invalid.eng.mks`, "invalid Matroska sidecar");
    await rm(`${evidence}/media/Missing/Missing.eng.mks`);
    const removeQueuedMovie = async () => {
      await rm(`${evidence}/media/Failed`, { recursive: true });
      await request("/Library/Refresh", {});
      await until("queued fixture removed from upstream library", async () => !(await request(`/Items?recursive=true&includeItemTypes=Movie&userId=${auth.User.Id}`)).Items.some((entry: any) => entry.Id === item("Failed").Id));
    };
    return { name, network: name, username, password, token, item, request, close, removeQueuedMovie, evidence, summary, containerUrl: "http://jellyfin:8096" };
  } catch (error) { await close(); throw error; }
}
