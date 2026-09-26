import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MediaStream } from "@jellyfin/sdk/lib/generated-client";
import type { PlayerState } from "../shared/protocol";
import { createJellyfin } from "./jellyfin";

const itemId = "a".repeat(32);
const userId = "b".repeat(32);
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

function fixture({ directPlay = true, mediaStreams = [], playbackWait, authWait, logoutWait, reportWait, failReports = false }: { directPlay?: boolean; mediaStreams?: MediaStream[]; playbackWait?: () => Promise<void>; authWait?: () => Promise<void>; logoutWait?: () => Promise<void>; reportWait?: (path: string) => Promise<void>; failReports?: boolean } = {}) {
  const requests: { path: string; url: URL; authorization: string | null; body: Record<string, unknown> | null }[] = [];
  const item = { Id: itemId, Name: "Local test movie", Type: "Movie", RunTimeTicks: 900_000_000, ProductionYear: 2026, UserData: { PlaybackPositionTicks: 110_000_000, Played: false }, Path: "/private/server/path", ImageTags: { Primary: "private-image-tag" } };
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/(?:jellyfin|alias)/, "");
    const body = request.method === "POST" && request.headers.get("content-type")?.includes("application/json") ? await request.json().catch(() => null) as Record<string, unknown> | null : null;
    requests.push({ path, url, authorization: request.headers.get("Authorization"), body });
    if (path === "/System/Info/Public") return Response.json({ ServerName: "Test library", Id: "test-server", Version: "10.11.0" });
    if (path === "/Users/AuthenticateByName") {
      await authWait?.();
      return body?.Pw === "fixture-password" ? Response.json({ AccessToken: "fixture-private-token", User: { Id: body.Username === "alternate-user" ? "c".repeat(32) : userId, Name: body.Username } }) : new Response(null, { status: 401 });
    }
    if (!request.headers.get("Authorization")?.includes('Token="fixture-private-token"')) return new Response(null, { status: 401 });
    if (path === "/Items") return Response.json({ Items: [item], TotalRecordCount: 74 });
    if (path === "/UserItems/Resume") return Response.json({ Items: item.UserData.PlaybackPositionTicks > 0 ? [item] : [], TotalRecordCount: item.UserData.PlaybackPositionTicks > 0 ? 1 : 0 });
    if (path === `/Items/${itemId}`) return Response.json(item);
    if (path === `/Items/${itemId}/PlaybackInfo`) {
      await playbackWait?.();
      return Response.json({ PlaySessionId: "fixture-play-session", MediaSources: [{ Id: "fixture-media", SupportsDirectPlay: directPlay, SupportsTranscoding: !directPlay, RequiresOpening: false, Protocol: "File", Path: "/private/server/movie.mkv", Container: "mkv", MediaStreams: mediaStreams }] });
    }
    if (path.startsWith(`/Videos/${itemId}/fixture-media/Subtitles/`)) return new Response("1\n00:00:11,000 --> 00:00:15,000\nJellyfin external subtitle sample\n", { headers: { "Content-Type": "application/x-subrip" } });
    if (path === "/Sessions/Logout") await logoutWait?.();
    if (path.startsWith("/Sessions/Playing")) {
      await reportWait?.(path);
      if (failReports) return new Response(null, { status: 503 });
      if (typeof body?.PositionTicks === "number") item.UserData.PlaybackPositionTicks = body.PositionTicks;
      if (path.endsWith("/Stopped") && item.UserData.PlaybackPositionTicks >= item.RunTimeTicks) item.UserData = { PlaybackPositionTicks: 0, Played: true };
    }
    if (path.startsWith("/Sessions/")) return new Response(null, { status: 204 });
    return new Response(null, { status: 404 });
  } });
  cleanup.push(() => server.stop(true));
  return { url: `http://127.0.0.1:${server.port}/jellyfin`, requests, item };
}

function source(path = ":memory:", now?: () => number, options: { onProgress?: () => void; onWarning?: (message: string) => void } = {}) {
  const result = createJellyfin(path, { now, ...options });
  cleanup.push(() => result.close());
  return result;
}

const credentials = (url: string) => ({ url, username: "fixture-user", password: "fixture-password" });
const player = (overrides: Partial<PlayerState> = {}): PlayerState => ({
  playbackId: "playback-1", status: "playing", position: 0, duration: 90, volume: 80, seekable: true, error: null, ...overrides,
});

describe("Jellyfin source", () => {
  test("preparing an album successor retains the current reporter until native adoption", async () => {
    const upstream = fixture();
    upstream.item.Type = "Audio";
    const jellyfin = source();
    await jellyfin.connect(credentials(upstream.url));
    const reference = (await jellyfin.entry(itemId, "queue-1")).source.slice(9);
    await jellyfin.resolve(reference, "playback-1", undefined, true);
    await jellyfin.observe(player({ position: 12 }));
    const pending = new AbortController();
    const media = await jellyfin.resolve(reference, "playback-2", pending.signal, true, true);
    expect(media.audioOnly).toBe(true);
    expect(media.headers.Authorization).toContain("fixture-private-token");
    await jellyfin.observe(player({ position: 19, status: "paused" }));
    expect(upstream.requests.filter(request => request.path === "/Sessions/Playing")).toHaveLength(1);
    expect(upstream.requests.filter(request => request.path.endsWith("/Stopped"))).toHaveLength(0);
    jellyfin.activatePrepared("playback-2");
    await jellyfin.observe(player({ playbackId: "playback-2", position: 1 }));
    jellyfin.activatePrepared("playback-2");
    await jellyfin.observe(player({ playbackId: "playback-2", position: 1 }));
    const reports = upstream.requests.filter(request => request.path.startsWith("/Sessions/Playing"));
    expect(reports.map(request => request.path)).toEqual(["/Sessions/Playing", "/Sessions/Playing/Progress", "/Sessions/Playing/Stopped", "/Sessions/Playing"]);
    expect(reports[2]!.body!.PositionTicks).toBe(190_000_000);
  });

  test("canceling a prepared source never starts or stops the current reporter", async () => {
    const upstream = fixture();
    const jellyfin = source();
    await jellyfin.connect(credentials(upstream.url));
    const reference = (await jellyfin.entry(itemId, "queue-1")).source.slice(9);
    await jellyfin.resolve(reference, "playback-1");
    await jellyfin.observe(player());
    const pending = new AbortController();
    await jellyfin.resolve(reference, "playback-2", pending.signal, true, true);
    pending.abort();
    jellyfin.activatePrepared("playback-2");
    await jellyfin.observe(player({ playbackId: "playback-2" }));
    await jellyfin.observe(player({ status: "paused", position: 8 }));
    const reports = upstream.requests.filter(request => request.path.startsWith("/Sessions/Playing"));
    expect(reports.map(request => request.path)).toEqual(["/Sessions/Playing", "/Sessions/Playing/Progress"]);
    expect(reports[1]!.body!.PositionTicks).toBe(80_000_000);
  });

  test("stores only host credentials and returns a bounded public catalog without server paths or tokens", async () => {
    const upstream = fixture();
    const directory = mkdtempSync(join(tmpdir(), "couch-jellyfin-"));
    cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
    const path = join(directory, "host.sqlite");
    const jellyfin = source(path);
    expect(jellyfin.status()).toEqual({ connected: false, serverName: null, username: null });
    expect(await jellyfin.connect(credentials(upstream.url))).toEqual({ connected: true, serverName: "Test library", username: "fixture-user" });
    const page = await jellyfin.items({ query: "Local", startIndex: 50 });
    expect(page.total).toBe(74);
    expect(page.items[0]).toEqual({ id: itemId, title: "Local test movie", kind: "Movie", detail: "2026", duration: 90, played: false, resumePosition: 11 });
    const query = upstream.requests.find(request => request.path === "/Items")!.url.searchParams;
    expect(query.get("limit")).toBe("50");
    expect(query.get("startIndex")).toBe("50");
    expect(query.get("searchTerm")).toBe("Local");
    expect(query.getAll("includeItemTypes")).toEqual(["Movie", "Episode", "Audio"]);
    const entry = await jellyfin.entry(itemId, "queue-1");
    expect(entry).toMatchObject({ id: "queue-1", title: "Local test movie" });
    expect(entry.source).toMatch(new RegExp(`^jellyfin:[a-f0-9]{24}:${itemId}$`));
    expect(JSON.stringify({ entry, page, status: jellyfin.status() })).not.toMatch(/fixture-private-token|private\/server|127\.0\.0\.1/);
    const db = new Database(path, { readonly: true });
    const stored = db.query<{ configuration: string }, []>("SELECT configuration FROM jellyfin").get()!.configuration;
    db.close();
    expect(stored).toContain("fixture-private-token");
    expect(stored).not.toContain("fixture-password");
    const reopened = source(path);
    expect(reopened.status().connected).toBe(true);
    expect(reopened.status().username).toBe("fixture-user");
    expect((await reopened.items()).items[0]!.id).toBe(itemId);
  });

  test("negotiates static direct play with private headers and reports a single host playback lifecycle", async () => {
    const upstream = fixture();
    let now = 1_000;
    const jellyfin = source(":memory:", () => now);
    await jellyfin.connect(credentials(upstream.url));
    const descriptor = await jellyfin.resolve((await jellyfin.entry(itemId, "queue-1")).source.slice(9), "playback-1");
    expect(descriptor.source).toContain(`/jellyfin/Videos/${itemId}/stream`);
    expect(descriptor.source).not.toContain("fixture-private-token");
    expect(descriptor.headers.Authorization).toContain('Token="fixture-private-token"');
    expect(descriptor.startPosition).toBe(11);
    const info = upstream.requests.find(request => request.path.endsWith("/PlaybackInfo"))!.body!;
    expect(info.EnableDirectPlay).toBe(true);
    expect(info.EnableTranscoding).toBe(false);
    expect(info.EnableDirectStream).toBe(false);
    expect(info.StartTimeTicks).toBe(110_000_000);
    await jellyfin.observe(player({ status: "loading" }));
    await jellyfin.observe(player({ playbackId: "outdated" }));
    expect(upstream.requests.filter(request => request.path === "/Sessions/Playing")).toHaveLength(0);
    await jellyfin.observe(player());
    now += 1_000;
    await jellyfin.observe(player({ position: 1 }));
    await jellyfin.observe(player({ status: "paused", position: 1 }));
    await jellyfin.observe(player({ status: "paused", position: 1 }));
    now += 16_000;
    await jellyfin.observe(player({ status: "paused", position: 1 }));
    await jellyfin.observe(player({ status: "paused", position: 60 }));
    await jellyfin.deactivate();
    await jellyfin.deactivate();
    await jellyfin.observe(player({ position: 75 }));
    const reports = upstream.requests.filter(request => request.path.startsWith("/Sessions/Playing"));
    expect(reports.map(request => request.path)).toEqual(["/Sessions/Playing", "/Sessions/Playing/Progress", "/Sessions/Playing/Progress", "/Sessions/Playing/Progress", "/Sessions/Playing/Stopped"]);
    expect(reports[0]!.body?.PlayMethod).toBe("DirectPlay");
    expect(reports[1]!.body?.IsPaused).toBe(true);
    expect(reports.at(-1)!.body).toMatchObject({ ItemId: itemId, MediaSourceId: "fixture-media", PlaySessionId: "fixture-play-session", PositionTicks: 600_000_000 });
  });

  test("loads external text subtitles through the server API with header authentication and original timestamps", async () => {
    const mediaStreams: MediaStream[] = ["subrip", "ass", "ssa", "webvtt"].map((Codec, index) => ({
      Type: "Subtitle", Index: index + 2, Codec, IsExternal: true, IsTextSubtitleStream: true,
      DeliveryMethod: "External", DeliveryUrl: `/Videos/${itemId}/fixture-media/Subtitles/${index + 2}/0/Stream.${Codec}?ApiKey=fixture-private-token`,
      DisplayTitle: `English ${Codec}`, Language: "eng", Path: `/private/server/movie.eng.${Codec}`,
    }));
    mediaStreams.push({ Type: "Subtitle", Index: 1, Codec: "subrip", IsExternal: false, DeliveryMethod: "Embed" });
    const upstream = fixture({ mediaStreams });
    mediaStreams[1]!.DeliveryUrl = `${upstream.url}/Videos/${itemId}/fixture-media/Subtitles/3/0/Stream.ass?ApiKey=fixture-private-token`;
    const jellyfin = source();
    await jellyfin.connect(credentials(upstream.url));
    const entry = await jellyfin.entry(itemId, "queue-1");
    const descriptor = await jellyfin.resolve(entry.source.slice(9), "playback-1");
    expect(descriptor.subtitles).toHaveLength(4);
    expect(descriptor.subtitles?.map(subtitle => subtitle.title)).toEqual(["English subrip", "English ass", "English ssa", "English webvtt"]);
    expect(descriptor.subtitles?.map(subtitle => new URL(subtitle.source).pathname.split(".").at(-1))).toEqual(["srt", "ass", "ssa", "vtt"]);
    expect(JSON.stringify(descriptor.subtitles)).not.toMatch(/fixture-private-token|private\/server|ApiKey/);
    for (const subtitle of descriptor.subtitles!) {
      expect(subtitle.language).toBe("eng");
      expect(subtitle.source).toStartWith(`${upstream.url}/Videos/`);
      expect(new URL(subtitle.source).searchParams.get("copyTimestamps")).toBe("true");
    }
    const response = await fetch(descriptor.subtitles![0]!.source, { headers: descriptor.headers });
    expect(response.ok).toBe(true);
    expect(await response.text()).toContain("00:00:11,000 --> 00:00:15,000");
    expect(upstream.requests.at(-1)?.authorization).toContain('Token="fixture-private-token"');
    const profile = upstream.requests.find(request => request.path.endsWith("/PlaybackInfo"))!.body!.DeviceProfile as { SubtitleProfiles: { Format: string; Method: string }[] };
    expect(profile.SubtitleProfiles).toContainEqual({ Format: "subrip", Method: "External" });
    expect(profile.SubtitleProfiles).toContainEqual({ Format: "pgssub", Method: "Embed" });
    expect(JSON.stringify({ entry, items: await jellyfin.items() })).not.toMatch(/fixture-private-token|private\/server|DeliveryUrl/);
    await jellyfin.deactivate();
    mediaStreams.splice(0);
    expect((await jellyfin.resolve(entry.source.slice(9), "playback-2")).subtitles).toBeUndefined();
  });

  test("omits external-domain subtitle delivery without forwarding credentials or publishing its address", async () => {
    const remoteRequests: Request[] = [];
    const remote = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: request => { remoteRequests.push(request); return new Response("subtitle"); } });
    cleanup.push(() => remote.stop(true));
    const warnings: string[] = [];
    const upstream = fixture({ mediaStreams: [
      { Type: "Subtitle", Index: 2, Codec: "subrip", IsExternal: true, DeliveryUrl: `http://127.0.0.1:${remote.port}/private.srt?ApiKey=private-token`, DisplayTitle: "Unsafe" },
      { Type: "Subtitle", Index: 3, Codec: "subrip", IsExternal: true, DeliveryUrl: "//third-party.test/subtitle.srt", DisplayTitle: "Unsafe" },
      { Type: "Subtitle", Index: 4, Codec: "subrip", IsExternal: true, DeliveryUrl: "file:///private/server/movie.srt", DisplayTitle: "Unsafe" },
      { Type: "Subtitle", Index: 5, Codec: "subrip", IsExternal: true, IsExternalUrl: true, DisplayTitle: "Unsafe" },
    ] });
    const jellyfin = source(":memory:", undefined, { onWarning: warning => warnings.push(warning) });
    await jellyfin.connect(credentials(upstream.url));
    const descriptor = await jellyfin.resolve((await jellyfin.entry(itemId, "queue-1")).source.slice(9), "playback-1");
    expect(descriptor.subtitles).toBeUndefined();
    expect(remoteRequests).toHaveLength(0);
    expect(warnings).toEqual(["Some Jellyfin external subtitles cannot be loaded safely from this server."]);
    expect(JSON.stringify(warnings)).not.toMatch(/private|127\.0\.0\.1|third-party/);
    await jellyfin.observe(player());
    expect(upstream.requests.filter(request => request.path === "/Sessions/Playing")).toHaveLength(1);
  });

  test("uses the canonical subtitle API for missing delivery URLs and keeps private paths out of labels", async () => {
    const upstream = fixture({ mediaStreams: [{ Type: "Subtitle", Index: 2, Codec: "srt", IsExternal: true, DisplayTitle: "/private/server/movie.srt", Path: "/private/server/movie.srt", Language: "eng" }] });
    const jellyfin = source();
    await jellyfin.connect(credentials(upstream.url));
    const descriptor = await jellyfin.resolve((await jellyfin.entry(itemId, "queue-1")).source.slice(9), "playback-1");
    expect(descriptor.subtitles).toEqual([{ source: `${upstream.url}/Videos/${itemId}/fixture-media/Subtitles/2/Stream.srt?copyTimestamps=true`, title: "eng subtitles 2", language: "eng" }]);
  });

  test("reports unsupported direct SUP and unidentified image sidecars while preserving direct video playback", async () => {
    const warnings: string[] = [];
    const upstream = fixture({ mediaStreams: [
      { Type: "Subtitle", Index: 2, Codec: "pgssub", IsExternal: true, IsTextSubtitleStream: false, Path: "/private/server/movie.sup" },
      { Type: "Subtitle", Index: 3, Codec: "pgssub", IsExternal: true, IsTextSubtitleStream: false },
      { Type: "Subtitle", Index: 4, Codec: "dvdsub", IsExternal: true, IsTextSubtitleStream: false, Path: "/private/server/movie.mks" },
    ] });
    const jellyfin = source(":memory:", undefined, { onWarning: warning => warnings.push(warning) });
    await jellyfin.connect(credentials(upstream.url));
    const descriptor = await jellyfin.resolve((await jellyfin.entry(itemId, "queue-1")).source.slice(9), "playback-1");
    expect(descriptor.source).toContain(`/Videos/${itemId}/stream`);
    expect(descriptor.subtitles).toBeUndefined();
    expect(warnings[0]).toContain("sidecars are unavailable");
    expect(JSON.stringify(warnings)).not.toContain("private/server");
  });

  test("delivers only identified PGS Matroska sidecars through the supported API and discloses its timing limit", async () => {
    const upstream = fixture({ mediaStreams: [{ Type: "Subtitle", Index: 2, Codec: "PGSSUB", IsExternal: true, IsTextSubtitleStream: false, Path: "/private/server/movie.eng.mks", Language: "eng", DisplayTitle: "English PGS", DeliveryMethod: "External" }] });
    const jellyfin = source();
    await jellyfin.connect(credentials(upstream.url));
    const descriptor = await jellyfin.resolve((await jellyfin.entry(itemId, "queue-1")).source.slice(9), "playback-1");
    expect(descriptor.subtitles).toEqual([{ source: `${upstream.url}/Videos/${itemId}/fixture-media/Subtitles/2/Stream.pgssub?copyTimestamps=true`, title: "English PGS", language: "eng" }]);
    expect(descriptor.subtitleWarning).toContain("start after zero");
    expect(descriptor.subtitleWarning).toContain("subtitle timing");
    expect(JSON.stringify(descriptor.subtitles)).not.toMatch(/private\/server|fixture-private-token/);
    const profile = upstream.requests.find(request => request.path.endsWith("/PlaybackInfo"))!.body!.DeviceProfile as { SubtitleProfiles: { Format: string; Method: string }[] };
    expect(profile.SubtitleProfiles).toContainEqual({ Format: "pgssub", Method: "External" });
    expect(profile.SubtitleProfiles).not.toContainEqual({ Format: "dvdsub", Method: "External" });
  });

  test("invalidates a pending resolution before it can start a replaced playback session", async () => {
    const gate = Promise.withResolvers<void>();
    const entered = Promise.withResolvers<void>();
    const upstream = fixture({ mediaStreams: [{ Type: "Subtitle", Index: 2, Codec: "subrip", IsExternal: true }], playbackWait: () => { entered.resolve(); return gate.promise; } });
    const jellyfin = source();
    await jellyfin.connect(credentials(upstream.url));
    const reference = (await jellyfin.entry(itemId, "queue-1")).source.slice(9);
    const pending = jellyfin.resolve(reference, "playback-1");
    await entered.promise;
    await jellyfin.deactivate();
    gate.resolve();
    await expect(pending).rejects.toThrow("The playing item changed.");
    await jellyfin.observe(player());
    expect(upstream.requests.some(request => request.path.startsWith("/Sessions/Playing"))).toBe(false);
  });

  test("queries the account's continue-watching list with bounded pagination and user data", async () => {
    const upstream = fixture();
    const jellyfin = source();
    await jellyfin.connect(credentials(upstream.url));
    const page = await jellyfin.items({ query: "Local", startIndex: 50, resume: true });
    expect(page.items[0]?.resumePosition).toBe(11);
    const query = upstream.requests.find(request => request.path === "/UserItems/Resume")!.url.searchParams;
    expect(query.get("userId")).toBe(userId);
    expect(query.get("startIndex")).toBe("50");
    expect(query.get("limit")).toBe("50");
    expect(query.get("searchTerm")).toBe("Local");
    expect(query.get("enableUserData")).toBe("true");
    expect(query.get("excludeActiveSessions")).toBe("false");
    expect(query.getAll("includeItemTypes")).toEqual(["Movie", "Episode", "Audio"]);
    expect(JSON.stringify(page)).not.toMatch(/fixture-private-token|private\/server|127\.0\.0\.1/);
  });

  test("play from start overrides upstream resume and reports only the observed native position", async () => {
    const upstream = fixture();
    let invalidations = 0;
    const jellyfin = source(":memory:", undefined, { onProgress: () => invalidations++ });
    await jellyfin.connect(credentials(upstream.url));
    const reference = (await jellyfin.entry(itemId, "queue-1")).source.slice(9);
    const descriptor = await jellyfin.resolve(reference, "playback-1", undefined, true);
    expect(descriptor.startPosition).toBeUndefined();
    expect(upstream.requests.find(request => request.path.endsWith("/PlaybackInfo"))!.body?.StartTimeTicks).toBe(0);
    await jellyfin.observe(player({ status: "loading", position: 0 }));
    expect(invalidations).toBe(0);
    await jellyfin.observe(player({ position: 0.4 }));
    expect(upstream.requests.find(request => request.path === "/Sessions/Playing")!.body?.PositionTicks).toBe(4_000_000);
    expect(invalidations).toBe(1);
    await jellyfin.observe(player({ status: "paused", position: 2 }));
    expect(invalidations).toBe(2);
  });

  test("immediate replay waits for the preceding stop report and resumes its latest rewind", async () => {
    const gate = Promise.withResolvers<void>();
    const entered = Promise.withResolvers<void>();
    const upstream = fixture({ reportWait: async path => { if (path.endsWith("/Stopped")) { entered.resolve(); await gate.promise; } } });
    const jellyfin = source();
    await jellyfin.connect(credentials(upstream.url));
    const reference = (await jellyfin.entry(itemId, "queue-1")).source.slice(9);
    await jellyfin.resolve(reference, "playback-1");
    await jellyfin.observe(player({ position: 40 }));
    await jellyfin.observe(player({ status: "paused", position: 6 }));
    const stopping = jellyfin.deactivate();
    await entered.promise;
    const itemReads = upstream.requests.filter(request => request.path === `/Items/${itemId}`).length;
    const replaying = jellyfin.resolve(reference, "playback-2");
    await Bun.sleep(10);
    expect(upstream.requests.filter(request => request.path === `/Items/${itemId}`)).toHaveLength(itemReads);
    gate.resolve();
    await stopping;
    expect((await replaying).startPosition).toBe(6);
    await jellyfin.observe(player({ playbackId: "playback-1", position: 55 }));
    await jellyfin.observe(player({ playbackId: "playback-2", position: 6.2 }));
    const reports = upstream.requests.filter(request => request.path.startsWith("/Sessions/Playing"));
    expect(reports.map(request => request.path)).toEqual(["/Sessions/Playing", "/Sessions/Playing/Progress", "/Sessions/Playing/Stopped", "/Sessions/Playing"]);
    expect(reports.at(-1)?.body?.PositionTicks).toBe(62_000_000);
  });

  test("EOF sends one final report and reads back upstream watched state", async () => {
    const upstream = fixture();
    let invalidations = 0;
    const jellyfin = source(":memory:", undefined, { onProgress: () => invalidations++ });
    await jellyfin.connect(credentials(upstream.url));
    const reference = (await jellyfin.entry(itemId, "queue-1")).source.slice(9);
    await jellyfin.resolve(reference, "playback-1");
    await jellyfin.observe(player({ position: 11 }));
    await jellyfin.observe(player({ status: "ended", position: 90 }));
    await jellyfin.observe(player({ status: "ended", position: 90 }));
    const stopped = upstream.requests.filter(request => request.path === "/Sessions/Playing/Stopped");
    expect(stopped).toHaveLength(1);
    expect(stopped[0]?.body?.PositionTicks).toBe(900_000_000);
    expect((await jellyfin.items()).items[0]).toMatchObject({ played: true, resumePosition: 0 });
    expect((await jellyfin.items({ resume: true })).items).toHaveLength(0);
    expect(invalidations).toBe(2);
  });

  test("reopening the host connection reads fresh upstream resume without starting playback", async () => {
    const upstream = fixture();
    const directory = mkdtempSync(join(tmpdir(), "couch-jellyfin-resume-"));
    cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
    const path = join(directory, "host.sqlite");
    const jellyfin = source(path);
    await jellyfin.connect(credentials(upstream.url));
    const reference = (await jellyfin.entry(itemId, "queue-1")).source.slice(9);
    await jellyfin.resolve(reference, "playback-1");
    await jellyfin.observe(player({ position: 23 }));
    await jellyfin.close();
    const reopened = source(path);
    expect((await reopened.items({ resume: true })).items[0]?.resumePosition).toBe(23);
    expect(upstream.requests.filter(request => request.path === "/Sessions/Playing")).toHaveLength(1);
    expect((await reopened.resolve(reference, "playback-2")).startPosition).toBe(23);
  });

  test("aborting playback negotiation cannot activate a reporter", async () => {
    const gate = Promise.withResolvers<void>();
    const entered = Promise.withResolvers<void>();
    const upstream = fixture({ mediaStreams: [{ Type: "Subtitle", Index: 2, Codec: "subrip", IsExternal: true }], playbackWait: () => { entered.resolve(); return gate.promise; } });
    const jellyfin = source();
    await jellyfin.connect(credentials(upstream.url));
    const controller = new AbortController();
    const pending = jellyfin.resolve((await jellyfin.entry(itemId, "queue-1")).source.slice(9), "playback-1", controller.signal);
    await entered.promise;
    controller.abort();
    await expect(pending).rejects.toThrow("aborted");
    gate.resolve();
    await jellyfin.observe(player({ position: 11 }));
    expect(upstream.requests.some(request => request.path.startsWith("/Sessions/Playing"))).toBe(false);
  });

  test("failed progress writes warn without broadcasting a committed catalog change", async () => {
    const upstream = fixture({ failReports: true });
    let invalidations = 0;
    const warnings: string[] = [];
    const jellyfin = source(":memory:", undefined, { onProgress: () => invalidations++, onWarning: warning => warnings.push(warning) });
    await jellyfin.connect(credentials(upstream.url));
    await jellyfin.resolve((await jellyfin.entry(itemId, "queue-1")).source.slice(9), "playback-1");
    await jellyfin.observe(player({ position: 11 }));
    expect(invalidations).toBe(0);
    expect(warnings).toEqual(["Jellyfin couldn't save your progress. Check the server connection."]);
  });

  test("invalid or completed upstream positions do not produce a native resume seek", async () => {
    const upstream = fixture();
    const jellyfin = source();
    await jellyfin.connect(credentials(upstream.url));
    const reference = (await jellyfin.entry(itemId, "queue-1")).source.slice(9);
    for (const ticks of [-10_000_000, 900_000_000, 1_000_000_000]) {
      upstream.item.UserData.PlaybackPositionTicks = ticks;
      expect((await jellyfin.resolve(reference, "playback-1")).startPosition).toBeUndefined();
      await jellyfin.deactivate();
    }
  });

  test("does not claim direct-play support when Jellyfin requires conversion", async () => {
    const upstream = fixture({ directPlay: false });
    const jellyfin = source();
    await jellyfin.connect(credentials(upstream.url));
    await expect(jellyfin.resolve((await jellyfin.entry(itemId, "queue-1")).source.slice(9), "playback-1")).rejects.toThrow("can't play this format");
    await jellyfin.observe(player());
    expect(upstream.requests.some(request => request.path.startsWith("/Sessions/Playing"))).toBe(false);
  });

  test("rejects malformed source IDs and URLs, and hides upstream authentication details", async () => {
    const upstream = fixture();
    const jellyfin = source();
    await expect(jellyfin.connect(credentials("file:///secret"))).rejects.toThrow("Use a Jellyfin server URL");
    await expect(jellyfin.connect(credentials("http://user:password@example.test"))).rejects.toThrow("Use a Jellyfin server URL");
    await expect(jellyfin.connect({ ...credentials(upstream.url), password: "bad" })).rejects.toThrow("Couldn't connect to Jellyfin");
    expect(jellyfin.status().connected).toBe(false);
    await jellyfin.connect(credentials(upstream.url));
    const count = upstream.requests.length;
    await expect(jellyfin.resolve("../private", "playback-1")).rejects.toThrow("Invalid Jellyfin item");
    expect(upstream.requests).toHaveLength(count);
  });

  test("disconnect removes saved credentials and wins over an in-flight connection", async () => {
    const gate = Promise.withResolvers<void>();
    const entered = Promise.withResolvers<void>();
    const upstream = fixture({ authWait: () => { entered.resolve(); return gate.promise; } });
    const jellyfin = source();
    const pending = jellyfin.connect(credentials(upstream.url));
    await entered.promise;
    const disconnecting = jellyfin.disconnect();
    gate.resolve();
    const failure = await pending.then(() => "", reason => reason.message);
    expect(failure).toContain("The Jellyfin connection changed");
    await disconnecting;
    expect(upstream.requests.filter(request => request.path === "/Sessions/Logout")).toHaveLength(1);
    expect(jellyfin.status().connected).toBe(false);
    await expect(jellyfin.items()).rejects.toThrow("Connect Jellyfin in Settings → Sources first");
  });

  test("closing while authentication is pending cannot write or reopen a closed source", async () => {
    const gate = Promise.withResolvers<void>();
    const entered = Promise.withResolvers<void>();
    const upstream = fixture({ authWait: () => { entered.resolve(); return gate.promise; } });
    const jellyfin = source();
    const pending = jellyfin.connect(credentials(upstream.url));
    await entered.promise;
    const closing = jellyfin.close();
    gate.resolve();
    const failure = await pending.then(() => "", reason => reason.message);
    expect(failure).toContain("The Jellyfin connection changed");
    await closing;
    expect(upstream.requests.filter(request => request.path === "/Sessions/Logout")).toHaveLength(1);
    await expect(jellyfin.connect(credentials(upstream.url))).rejects.toThrow("The Jellyfin connection is closed");
  });

  test("saved queue entries are scoped to the Jellyfin server and account", async () => {
    const upstream = fixture();
    const jellyfin = source();
    await jellyfin.connect(credentials(upstream.url));
    const previous = await jellyfin.entry(itemId, "original-entry");
    await jellyfin.connect({ ...credentials(upstream.url), username: "alternate-user" });
    const requestCount = upstream.requests.length;
    await expect(jellyfin.resolve(previous.source.slice(9), "playback-1")).rejects.toThrow("different Jellyfin server or account");
    expect(upstream.requests).toHaveLength(requestCount);
    const current = await jellyfin.entry(itemId, "new-entry");
    expect(current.source).not.toBe(previous.source);
    await jellyfin.disconnect();
    expect(jellyfin.status().connected).toBe(false);
    await jellyfin.connect({ ...credentials(upstream.url), username: "alternate-user" });
    const descriptor = await jellyfin.resolve(current.source.slice(9), "playback-1");
    expect(descriptor.source).toContain(`/Videos/${itemId}/stream`);
  });

  test("finishes logout before authenticating again and preserves an active reused token", async () => {
    const gate = Promise.withResolvers<void>();
    const entered = Promise.withResolvers<void>();
    const events: string[] = [];
    const upstream = fixture({
      authWait: async () => { events.push("authenticate"); },
      logoutWait: async () => { events.push("logout-start"); entered.resolve(); await gate.promise; events.push("logout-end"); },
    });
    const jellyfin = source();
    await jellyfin.connect(credentials(upstream.url));
    await jellyfin.connect(credentials(upstream.url));
    expect(upstream.requests.filter(request => request.path === "/Sessions/Logout")).toHaveLength(0);
    const disconnecting = jellyfin.disconnect();
    await entered.promise;
    const connecting = jellyfin.connect(credentials(upstream.url));
    gate.resolve();
    await Promise.all([disconnecting, connecting]);
    expect(events).toEqual(["authenticate", "authenticate", "logout-start", "logout-end", "authenticate"]);
    expect((await jellyfin.items()).items[0]!.id).toBe(itemId);
  });

  test("replacing the server URL with an alias keeps its reused device token active", async () => {
    const upstream = fixture();
    const jellyfin = source();
    await jellyfin.connect(credentials(upstream.url));
    const alias = upstream.url.replace(/\/jellyfin$/, "/alias");
    await jellyfin.connect(credentials(alias));
    expect(jellyfin.connection().url).toBe(alias);
    expect(upstream.requests.filter(request => request.path === "/Sessions/Logout")).toHaveLength(0);
    expect((await jellyfin.items()).items[0]!.id).toBe(itemId);
    await jellyfin.disconnect();
    expect(upstream.requests.filter(request => request.path === "/Sessions/Logout")).toHaveLength(1);
  });

  test("native player loss stops reporting at the last observed position even without a playback ID", async () => {
    const upstream = fixture();
    const jellyfin = source();
    await jellyfin.connect(credentials(upstream.url));
    const entry = await jellyfin.entry(itemId, "queue-1");
    await jellyfin.resolve(entry.source.slice(9), "playback-1");
    await jellyfin.observe(player({ position: 12 }));
    await jellyfin.observe(player({ status: "unavailable", playbackId: null, position: 0 }));
    const stop = upstream.requests.find(request => request.path === "/Sessions/Playing/Stopped");
    expect(stop?.body?.PositionTicks).toBe(120_000_000);
    await jellyfin.observe(player({ position: 13 }));
    expect(upstream.requests.filter(request => request.path === "/Sessions/Playing")).toHaveLength(1);
  });

  test.each(["error", "idle", "ended"] as const)("a terminal %s position reset preserves the last observed position", async status => {
    const upstream = fixture();
    const jellyfin = source();
    await jellyfin.connect(credentials(upstream.url));
    const reference = (await jellyfin.entry(itemId, "queue-1")).source.slice(9);
    await jellyfin.resolve(reference, "playback-1");
    await jellyfin.observe(player({ position: 17.5 }));
    await jellyfin.observe(player({ status, position: 0, duration: null, seekable: false }));
    await jellyfin.observe(player({ position: 30 }));
    await jellyfin.observe(player({ status, position: 0 }));
    const stopped = upstream.requests.filter(request => request.path === "/Sessions/Playing/Stopped");
    expect(stopped).toHaveLength(1);
    expect(stopped[0]?.body).toMatchObject({ PositionTicks: 175_000_000, Failed: status === "error" });
    expect((await jellyfin.items({ resume: true })).items[0]?.resumePosition).toBe(17.5);
    expect((await jellyfin.resolve(reference, "playback-2")).startPosition).toBe(17.5);
    await jellyfin.observe(player({ status, position: 0 }));
    expect(upstream.requests.filter(request => request.path === "/Sessions/Playing/Stopped")).toHaveLength(1);
  });
});
