import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import type { ControllerIdentity } from "../shared/controllers";
import type { GuidePage, GuideSource } from "../shared/iptv";
import type { PlaybackCommand, PlayerState, ServerMessage } from "../shared/protocol";
import { createGuide } from "./iptv";
import { createHub } from "./hub";
import { guideLimits, parseGuideChannels, parseGuidePrograms, xmltvTime } from "./iptv-feeds";

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const timestamp = (ms: number) => new Date(ms).toISOString().replace(/[-:T]/g, "").slice(0, 14) + " +0000";
const epoch = Date.now();
const playlist = (root = "https://stream.example", name = "First", key = "first") => `#EXTM3U\n#EXTINF:-1 tvg-id="${key}" group-title="News, live" tvg-logo="${root}/logo?secret=logo",${name}\n${root}/live.m3u8?secret=stream\n`;
const xml = (title = "News &amp; caf&#233; &#xE9;", key = "first") => `<tv><channel id="${key}"/><programme channel="${key}" start="${timestamp(epoch - 600_000)}" stop="${timestamp(epoch + 600_000)}"><title>${title}</title><desc>A generated guide.</desc></programme><programme channel="${key}" start="${timestamp(epoch + 600_000)}" stop="${timestamp(epoch + 1_200_000)}"><title>Next show</title></programme></tv>`;
const host: ControllerIdentity = { authority: "host", controller: null, claimAvailable: false };
const guest: ControllerIdentity = { authority: "controller", controller: null, claimAvailable: false };
const hostToken = "private-iptv-host-token-for-tests-123456789";
const idle: PlayerState = { playbackId: null, status: "idle", position: 0, duration: null, volume: 80, seekable: false, error: null };
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n1kAAAAASUVORK5CYII=", "base64");
const liveManifest = "#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:3\n#EXTINF:2,\nsegment.ts\n";

function upstream() {
  let m3u = playlist(), programs = xml(), manifest = liveManifest, fail = false;
  let gate: Promise<void> | undefined;
  let entered: (() => void) | undefined;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/logo") return new Response(png);
    if (path === "/live.m3u8") return new Response(manifest);
    if (path === "/redirect") return new Response(null, { status: 302, headers: { Location: "/list.m3u?secret=redirect" } });
    if (path === "/list.m3u") { entered?.(); await gate; }
    if (fail) return new Response("https://private.example/token", { status: 503 });
    return new Response(path === "/list.m3u" ? m3u : programs);
  } });
  cleanup.push(() => server.stop(true));
  const origin = `http://127.0.0.1:${server.port}`;
  m3u = playlist(origin);
  return { origin, set m3u(value: string) { m3u = value; }, set xml(value: string) { programs = value; }, set manifest(value: string) { manifest = value; }, set fail(value: boolean) { fail = value; },
    block() { const ready = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(); entered = ready.resolve; gate = release.promise; cleanup.push(() => release.resolve()); return { ready: ready.promise, release: () => { gate = undefined; entered = undefined; release.resolve(); } }; },
    definition: { name: "Generated guide", playlistUrl: `${origin}/list.m3u?secret=playlist`, guideUrl: `${origin}/guide.xml?secret=guide` },
  };
}
function fixture(databasePath = ":memory:", onChange = () => {}, onSourcesChanged = (_ids: string[]) => {}) {
  let identity: ControllerIdentity | null = host;
  const guide = createGuide({ databasePath, onChange, onSourcesChanged });
  cleanup.push(() => guide.close());
  const api = (path: string, method = "GET", body?: unknown) => guide.handle(new Request(`http://localhost/api/iptv/${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }), () => identity);
  return { guide, api, set identity(value: ControllerIdentity | null) { identity = value; } };
}
async function add(api: ReturnType<typeof fixture>["api"], definition: unknown) {
  const response = await api("sources", "POST", definition);
  expect(response.status).toBe(201);
  return (await response.json() as { source: GuideSource }).source;
}

test("M3U exact source-scoped mapping keeps channel IDs through URL/name/order changes and XMLTV decodes numeric entities", () => {
  const first = parseGuideChannels(playlist(), "source", "https://feed.example/list");
  const second = parseGuideChannels(playlist("https://new.example", "Renamed"), "source", "https://feed.example/list");
  expect(first[0]!.id).toBe(second[0]!.id);
  expect(parseGuideChannels(playlist(), "another-source", "https://feed.example/list")[0]!.id).not.toBe(first[0]!.id);
  expect(first[0]).toMatchObject({ tvgId: "first", group: "News, live", hasLogo: true });
  const programs = parseGuidePrograms(xml(), first);
  expect(programs[0]!.title).toBe("News & café é");
  expect(parseGuidePrograms(xml("Corrected title"), second)[0]!.id).toBe(programs[0]!.id);
  expect(() => parseGuidePrograms(xml("Wrong", "other"), first)).toThrow("match");
});

test("XMLTV mapping preserves decoded exact IDs and distinct whitespace in channel and program references", () => {
  const plain = parseGuideChannels(playlist(undefined, "News", "news"), "source", "https://example.com");
  expect(() => parseGuidePrograms(xml("Padded", " news "), plain)).toThrow("match");
  const channels = parseGuideChannels(playlist(undefined, "News", "news") + playlist(undefined, "Padded", " news ").split("\n").slice(1).join("\n"), "source", "https://example.com");
  expect(channels.map(channel => channel.tvgId)).toEqual(["news", " news "]);
  expect(channels[0]!.id).not.toBe(channels[1]!.id);
  const guide = xml("Plain", "news").replace("</tv>", xml("Padded", "&#32;news&#x20;").replace(/^<tv>|<\/tv>$/g, "") + "</tv>");
  const programs = parseGuidePrograms(guide, channels);
  expect(programs.map(program => program.channelId)).toEqual([channels[0]!.id, channels[0]!.id, channels[1]!.id, channels[1]!.id]);
  expect(new Set(programs.map(program => program.id)).size).toBe(4);
  expect(parseGuidePrograms(xml().replaceAll('channel="first"', 'channel=" first "'), parseGuideChannels(playlist(), "source", "https://example.com"))).toEqual([]);
  const unicode = parseGuideChannels(playlist(undefined, "Café", "café"), "source", "https://example.com");
  expect(parseGuidePrograms(xml("Unicode", "caf&#233;"), unicode)[0]!.channelId).toBe(unicode[0]!.id);
});

test("XMLTV offsets, midnight and DST repeated hours normalize to absolute UTC times", () => {
  expect(xmltvTime("20261025023000 +0200")).toBe(Date.parse("2026-10-25T00:30:00Z"));
  expect(xmltvTime("20261025023000 +0100")).toBe(Date.parse("2026-10-25T01:30:00Z"));
  expect(xmltvTime("202609060015 -0330")).toBe(Date.parse("2026-09-06T03:45:00Z"));
  expect(xmltvTime("20260906001500 +0530")).toBe(Date.parse("2026-09-05T18:45:00Z"));
  expect(xmltvTime("202609060015")).toBe(xmltvTime("20260906001500 UTC"));
  for (const value of ["202609", "20260230010000", "20260906240000", "20260906010000 CET", "20260906010000 +1460"]) expect(() => xmltvTime(value)).toThrow();
});

test("bounded parsers reject incomplete lists, ambiguous IDs, unsafe URLs, XML declarations, nesting, count and field overflows", () => {
  const channels = parseGuideChannels(playlist(), "source", "https://example.com");
  for (const value of ["#EXTM3U\n#EXT-X-TARGETDURATION:5", playlist().replace('tvg-id="first"', ""), playlist() + playlist().split("\n").slice(1).join("\n"), playlist().replace("https://stream.example/live", "file:///private/live"), playlist().replace("https://stream.example/live", "https://user:pass@stream.example/live"), playlist().replace("#EXTINF:", "#KODIPROP:secret=x\n#EXTINF:"), playlist().replace("First", "x".repeat(201)), "x".repeat(guideLimits.playlistBytes + 1)]) expect(() => parseGuideChannels(value, "source", "https://example.com")).toThrow();
  for (const value of ["<!DOCTYPE tv>" + xml(), '<!ENTITY x "private">' + xml(), "<tv><wrong></tv>", xml("x".repeat(301)), xml().replace("</tv>", "<x>".repeat(20) + "</x>".repeat(20) + "</tv>"), xml().replace("</tv>", '<channel id="first"/></tv>'), "x".repeat(guideLimits.xmlBytes + 1)]) expect(() => parseGuidePrograms(value, channels)).toThrow();
  const oversized = "#EXTM3U\n" + Array.from({ length: 5001 }, (_, i) => `#EXTINF:-1 tvg-id="${i}",Channel\nhttps://example.com/${i}\n`).join("");
  expect(() => parseGuideChannels(oversized, "source", "https://example.com")).toThrow("5000");
});

test("real HTTP import, guide/now-next, raster logo cache and offline restart expose no feed or stream URLs", async () => {
  const source = upstream();
  const dir = mkdtempSync(join(tmpdir(), "couch-iptv-")); cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "guide.sqlite");
  const first = fixture(path);
  const saved = await add(first.api, source.definition);
  const page = await (await first.api("guide")).json() as GuidePage;
  expect(page.channels[0]).toMatchObject({ now: { title: "News & café é" }, next: { title: "Next show" }, group: "News, live" });
  expect(saved).toMatchObject({ channelCount: 1, programCount: 2, error: null });
  const id = page.channels[0]!.id;
  expect(await (await first.api(`channels/${id}/logo`)).bytes()).toEqual(png);
  expect(await (await first.api(`channels/${id}/capabilities`)).json()).toEqual({ liveEdge: "reload", catchup: null });
  const encoded = JSON.stringify([saved, page, await (await first.api(`channels/${id}/programs`)).json()]);
  expect(encoded).not.toContain("secret="); expect(encoded).not.toContain(source.origin);
  first.guide.close(); source.fail = true;
  const reopened = fixture(path);
  expect((await (await reopened.api("guide")).json() as GuidePage).channels).toEqual(page.channels);
  expect((await reopened.api(`sources/${saved.id}/refresh`, "POST")).status).toBe(502);
  expect((await (await reopened.api("guide")).json() as GuidePage).channels).toEqual(page.channels);
  expect(await (await reopened.api(`channels/${id}/logo`)).bytes()).toEqual(png);
  expect(reopened.guide.getPlayable(id).source).toContain("secret=stream");
});

test.each([
  ["omitted media sequence", liveManifest.replace("#EXT-X-MEDIA-SEQUENCE:3\n", ""), "reload"],
  ["explicit sequence and discontinuity", liveManifest + "#EXT-X-DISCONTINUITY\n#EXTINF:1.5,Next\nnext.ts\n", "reload"],
  ["CRLF media playlist", liveManifest.replaceAll("\n", "\r\n"), "reload"],
  ["empty marker-only playlist", liveManifest.split("#EXTINF:")[0]!, null],
  ["missing segment URI", liveManifest.replace("segment.ts\n", ""), null],
  ["missing segment duration", liveManifest.replace("#EXTINF:2,\n", ""), null],
  ["invalid duration", liveManifest.replace("#EXTINF:2,", "#EXTINF:nope,"), null],
  ["duration above target", liveManifest.replace("#EXTINF:2,", "#EXTINF:3,"), null],
  ["invalid target duration", liveManifest.replace("TARGETDURATION:2", "TARGETDURATION:0"), null],
  ["duplicate target duration", liveManifest + "#EXT-X-TARGETDURATION:2\n", null],
  ["invalid media sequence", liveManifest.replace("MEDIA-SEQUENCE:3", "MEDIA-SEQUENCE:-1"), null],
  ["media sequence after segments", liveManifest.replace("#EXT-X-MEDIA-SEQUENCE:3\n", "") + "#EXT-X-MEDIA-SEQUENCE:3\n", null],
  ["finite playlist", liveManifest + "#EXT-X-ENDLIST\n", null],
  ["VOD without end marker", liveManifest + "#EXT-X-PLAYLIST-TYPE:VOD\n", null],
  ["master playlist", "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000\nvariant.m3u8\n", null],
  ["mixed master and media tags", liveManifest + '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Audio",URI="audio.m3u8"\n', null],
  ["provider start offset", liveManifest + "#EXT-X-START:TIME-OFFSET=0\n", null],
  ["unsafe segment URI", liveManifest.replace("segment.ts", "file:///private/segment.ts"), null],
] as const)("live-edge HTTP probe handles %s", async (_name, manifest, liveEdge) => {
  const source = upstream(), app = fixture(); source.manifest = manifest;
  await add(app.api, source.definition);
  const id = (await (await app.api("guide")).json() as GuidePage).channels[0]!.id;
  const response = await app.api(`channels/${id}/capabilities`);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ liveEdge, catchup: null });
});

test("refresh/replace commit channels and programs together before invalidation; failed replacement keeps current private definition", async () => {
  const source = upstream();
  const dir = mkdtempSync(join(tmpdir(), "couch-iptv-commit-")); cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "guide.sqlite"), observed: string[][] = [];
  const first = fixture(path, () => { const db = new Database(path, { readonly: true }); observed.push(db.query<{ title: string }, []>("SELECT title FROM iptv_programs ORDER BY start").all().map(row => row.title)); db.close(); });
  const saved = await add(first.api, source.definition);
  source.m3u = playlist(source.origin, "Renamed"); source.xml = xml("New program");
  expect((await first.api(`sources/${saved.id}/refresh`, "POST")).status).toBe(200);
  expect(observed).toEqual([["News & café é", "Next show"], ["New program", "Next show"]]);
  source.fail = true;
  expect((await first.api(`sources/${saved.id}`, "POST", { ...source.definition, playlistUrl: `${source.origin}/list.m3u?replacement=private` })).status).toBe(502);
  const db = new Database(path, { readonly: true }); cleanup.push(() => db.close());
  expect(db.query<{ playlist_url: string }, []>("SELECT playlist_url FROM iptv_sources").get()!.playlist_url).toBe(source.definition.playlistUrl);
});

test("committed replacement, refresh and removal still invalidate and succeed when native stop throws", async () => {
  const source = upstream();
  const dir = mkdtempSync(join(tmpdir(), "couch-iptv-stop-")); cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "guide.sqlite"), observed: string[][] = [], stopped: string[][] = [];
  const app = fixture(path, () => {
    const db = new Database(path, { readonly: true });
    observed.push(db.query<{ title: string }, []>("SELECT title FROM iptv_programs ORDER BY start").all().map(row => row.title));
    db.close();
  }, ids => { if (ids.length) { stopped.push(ids); throw new Error("Desktop disconnected"); } });
  const saved = await add(app.api, source.definition);
  const id = (await (await app.api("guide")).json() as GuidePage).channels[0]!.id;
  source.m3u = playlist(source.origin, "Replacement").replace("secret=stream", "secret=replaced");
  source.xml = xml("Replacement program");
  const replacement = await app.api(`sources/${saved.id}`, "POST", { ...source.definition, name: "Replacement source", playlistUrl: `${source.origin}/list.m3u?replacement=private` });
  expect(replacement.status).toBe(200);
  expect(await replacement.json()).toMatchObject({ source: { id: saved.id, name: "Replacement source", error: null } });
  expect(app.guide.getPlayable(id).source).toBe(`${source.origin}/live.m3u8?secret=replaced`);
  const db = new Database(path, { readonly: true }); cleanup.push(() => db.close());
  expect(db.query<{ playlist_url: string }, []>("SELECT playlist_url FROM iptv_sources").get()!.playlist_url).toBe(`${source.origin}/list.m3u?replacement=private`);
  source.m3u = playlist(source.origin, "Refreshed"); source.xml = xml("Refreshed program");
  const refresh = await app.api(`sources/${saved.id}/refresh`, "POST");
  expect(refresh.status).toBe(200);
  expect(await refresh.json()).toMatchObject({ source: { id: saved.id, error: null } });
  expect(app.guide.getPlayable(id).source).toBe(`${source.origin}/live.m3u8?secret=stream`);
  expect((await app.api(`sources/${saved.id}`, "DELETE")).status).toBe(204);
  expect((await (await app.api("guide")).json() as GuidePage).channels).toEqual([]);
  expect(stopped).toEqual([[id], [id], [id]]);
  expect(observed).toEqual([["News & café é", "Next show"], ["Replacement program", "Next show"], ["Refreshed program", "Next show"], []]);
});

test("source administration rechecks identity after feed awaits and rejects unpaired/ordinary callers", async () => {
  const source = upstream(), app = fixture();
  app.identity = guest;
  expect((await app.api("sources", "POST", source.definition)).status).toBe(403);
  app.identity = null;
  expect((await app.api("guide")).status).toBe(401);
  app.identity = host;
  const blocked = source.block();
  const creating = app.api("sources", "POST", source.definition);
  await blocked.ready; app.identity = guest; blocked.release();
  expect((await creating).status).toBe(403);
  expect((await (await app.api("sources")).json() as { sources: unknown[] }).sources).toEqual([]);
  app.identity = host; const saved = await add(app.api, source.definition);
  const pending = source.block(); const refreshing = app.api(`sources/${saved.id}/refresh`, "POST");
  await pending.ready; app.identity = null; pending.release();
  expect((await refreshing).status).toBe(401);
  app.identity = host;
  expect((await (await app.api("sources")).json() as { sources: GuideSource[] }).sources[0]).toEqual(saved);
});

test("removal and newer replacement cancel old streaming refresh before it can recreate cached rows", async () => {
  const source = upstream(), app = fixture(), saved = await add(app.api, source.definition);
  const blocked = source.block(); const refreshing = app.api(`sources/${saved.id}/refresh`, "POST");
  await blocked.ready;
  expect((await app.api(`sources/${saved.id}`, "DELETE")).status).toBe(204);
  blocked.release(); expect((await refreshing).status).toBe(409);
  expect((await (await app.api("guide")).json() as GuidePage).channels).toEqual([]);
  const second = await add(app.api, source.definition);
  const delayed = source.block(); const replacing = app.api(`sources/${second.id}`, "POST", source.definition);
  await delayed.ready;
  const newest = app.api(`sources/${second.id}`, "POST", { ...source.definition, name: "Newest" });
  delayed.release();
  expect((await replacing).status).toBe(409); expect((await newest).status).toBe(200);
  expect((await (await app.api("sources")).json() as { sources: GuideSource[] }).sources[0]!.name).toBe("Newest");
});

test("real HTTP rejects byte-limited feeds including streaming bodies and never publishes upstream error text", async () => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(new Uint8Array(guideLimits.playlistBytes + 1)) });
  cleanup.push(() => server.stop(true));
  const app = fixture();
  const response = await app.api("sources", "POST", { name: "Oversized", playlistUrl: `http://127.0.0.1:${server.port}`, guideUrl: "https://private.example?secret=guide" });
  expect(response.status).toBe(502); expect(await response.text()).not.toContain("secret");
});

test("two actual HTTP/WS controllers share opaque queue identity, rapid switch cancellation and stopped restart", async () => {
  const source = upstream(), commands: PlaybackCommand[] = [];
  const dir = mkdtempSync(join(tmpdir(), "couch-iptv-hub-")); cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const databasePath = join(dir, "state.sqlite");
  const start = () => { const hub = createHub({ databasePath, hostToken, hostname: "127.0.0.1", port: 0, pairingCode: "123456", sendPlayer: command => commands.push(command) }); cleanup.push(() => hub.close()); return hub; };
  let hub = start(); hub.session.observe(idle);
  const api = (path: string, method = "GET", body?: unknown, token = hostToken) => fetch(`${hub.origin}/api/${path}`, { method, headers: { Authorization: `Bearer ${token}`, Origin: hub.origin, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const pair = async () => (await (await api("pair", "POST", { code: "123456" })).json() as { token: string }).token;
  const token = await pair(), secondToken = await pair();
  const messages: ServerMessage[] = [];
  const peer = (token: string) => {
    const Constructor = WebSocket as typeof WebSocket & { new (url: string, options: Bun.WebSocketOptions): WebSocket };
    const ws = new Constructor(`${hub.origin.replace("http", "ws")}/api/ws?token=${token}`, { headers: { Origin: hub.origin } });
    ws.addEventListener("message", event => messages.push(JSON.parse(String(event.data)))); cleanup.push(() => ws.close());
    return ws;
  };
  const first = peer(token), second = peer(secondToken);
  const wait = async (condition: () => boolean) => { for (let i = 0; i < 200 && !condition(); i++) await Bun.sleep(5); expect(condition()).toBeTrue(); };
  await wait(() => messages.length >= 2);
  expect((await api("iptv/sources", "POST", source.definition, token)).status).toBe(403);
  const claim = await (await api("controllers/claim-code")).json() as { code: string };
  expect((await api("controllers/claim", "POST", { code: claim.code }, token)).status).toBe(200);
  const saved = await (await api("iptv/sources", "POST", source.definition, token)).json() as { source: GuideSource };
  const page = await (await api("iptv/guide", "GET", undefined, secondToken)).json() as GuidePage;
  const id = page.channels[0]!.id;
  expect((await api(`iptv/channels/${id}/play`, "POST", undefined, secondToken)).status).toBe(200);
  const old = commands.findLast(item => item.type === "load")!;
  expect(old).toMatchObject({ type: "load", source: `${source.origin}/live.m3u8?secret=stream` });
  expect(hub.session.state.player.status).toBe("loading");
  source.m3u = playlist(source.origin) + playlist(source.origin, "Second", "second").split("\n").slice(1).join("\n");
  source.xml = xml().replace("</tv>", xml("Second program", "second").replace(/^<tv>|<\/tv>$/g, "") + "</tv>");
  await api(`iptv/sources/${saved.source.id}/refresh`, "POST", undefined, token);
  const secondId = (await (await api("iptv/guide")).json() as GuidePage).channels[1]!.id;
  await api(`iptv/channels/${secondId}/play`, "POST", undefined, token);
  const newerId = hub.session.state.player.playbackId;
  hub.session.observe({ ...idle, playbackId: "playbackId" in old ? old.playbackId : "", status: "playing" });
  expect(hub.session.state.player.playbackId).toBe(newerId);
  hub.session.command({ type: "stop" });
  hub.session.observe({ ...idle, playbackId: newerId, status: "playing" });
  expect(hub.session.state.currentEntryId).toBeNull();
  await api(`iptv/channels/${id}/play`, "POST", undefined, secondToken);
  source.m3u = playlist(source.origin).replace("secret=stream", "secret=replaced");
  source.xml = xml();
  expect((await api(`iptv/sources/${saved.source.id}/refresh`, "POST", undefined, token)).status).toBe(200);
  expect(commands.at(-1)!.type).toBe("stop");
  hub.session.observe({ ...idle, playbackId: "playbackId" in old ? old.playbackId : "", status: "playing" });
  expect(hub.session.state.currentEntryId).toBeNull();
  await api(`iptv/channels/${id}/play`, "POST", undefined, secondToken);
  expect(commands.at(-1)).toMatchObject({ type: "load", source: `${source.origin}/live.m3u8?secret=replaced` });
  const loading = commands.at(-1)!;
  await api(`iptv/sources/${saved.source.id}`, "DELETE", undefined, token);
  hub.session.observe({ ...idle, playbackId: "playbackId" in loading ? loading.playbackId : "", status: "playing" });
  expect(hub.session.state.currentEntryId).toBeNull();
  const queue = hub.session.state.queue;
  const savedQueueResponse = await api("playlists", "POST", { name: "TV channels" }, secondToken);
  expect(savedQueueResponse.status).toBe(201);
  const savedQueue = await savedQueueResponse.json() as { playlist: { id: string; revision: number } };
  expect((await api(`playlists/${savedQueue.playlist.id}/load`, "POST", { revision: savedQueue.playlist.revision, mode: "replace" }, secondToken)).status).toBe(200);
  expect(hub.session.state.queue.map(item => item.source)).toEqual(queue.map(item => item.source));
  const restoredQueue = hub.session.state.queue;
  await wait(() => messages.filter(message => message.type === "state" && message.state.iptvVersion === 4).length >= 2);
  expect(JSON.stringify(messages)).not.toContain("secret=");
  first.close(); second.close(); await hub.close();
  commands.length = 0; hub = start();
  const before = messages.length; peer(secondToken); await wait(() => messages.length > before);
  expect(hub.session.state.queue).toEqual(restoredQueue); expect(hub.session.state.currentEntryId).toBeNull(); expect(commands).toEqual([]);
  expect((await api(`iptv/channels/${id}/play`, "POST", undefined, secondToken)).status).toBe(404);
});
