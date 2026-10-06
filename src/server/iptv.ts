import type { PlaybackActor } from "../shared/protocol";
import { Database } from "./sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DeviceIdentity } from "../shared/devices";
import type { GuideChannel, GuidePage, GuideProgram, GuideSource } from "../shared/iptv";
import { boundedBytes, GuideError, guideFetch, guideLimits, guideText, guideUrl, liveHlsPlaylist, parseGuideChannels, parseGuidePrograms, record, type PrivateChannel } from "./iptv-feeds";
import { ADMIN_ONLY } from "./messages";
import { execFile } from "node:child_process";
import { helper } from "./helpers";

// Raw MPEG-TS plays through mpegts.js. Chromium has no MPEG-1/2 video, AC-3/E-AC-3 or
// MP2 decoder, so those channels play in Core's own mpv (#644 ticket 1). ffmpeg reads the
// channel's real codecs; mpegts.js would report MP2 as MP3. Keep the conservative HEVC
// fallback when a Linux host is requested; remote-only outputs try their own browser.
// Actual HEVC decoding depends on the browser build and device.
const linux = process.platform === "linux";
async function transport(url: string, signal: AbortSignal, hevc: boolean): Promise<{ mpegts?: true; mpv?: true }> {
  const ffmpeg = await helper("ffmpeg");
  const probe = await new Promise<string>(resolve => execFile(ffmpeg, ["-hide_banner", "-nostdin", "-protocol_whitelist", "http,https,tcp,tls", "-probesize", "1000000", "-analyzeduration", "3000000", "-i", url],
    { timeout: 10_000, signal }, (_error, _stdout, stderr) => resolve(String(stderr))));
  signal.throwIfAborted();
  if (!/^Input #0, mpegts\b/m.test(probe)) return {};
  return /Stream #.*: (?:Video: mpeg[12]video|Audio: (?:ac3|eac3|mp2)\b)/.test(probe) || hevc && /Stream #.*: Video: hevc\b/.test(probe) ? { mpegts: true, mpv: true } : { mpegts: true };
}

// An HLS channel says its codecs in the playlist (RFC 8216 CODECS). hls.js picks a variant
// Chromium decodes, so it plays in mpv only when every variant needs MPEG-2 video, AC-3 or
// E-AC-3 without AAC beside it, or HEVC when the Linux host is requested.
export function mpvPlaylist(text: string, hevc = linux) {
  const variants = [...text.matchAll(/^#EXT-X-STREAM-INF:(.*)$/gm)].map(match => /(?:^|,)CODECS="([^"]*)"/.exec(match[1]!)?.[1]?.toLowerCase());
  return variants.length > 0 && variants.every(codecs => codecs !== undefined && (/\bmp4v\.6[0-5a]\b/.test(codecs) || /\b[ae]c-3\b/.test(codecs) && !/\bmp4a\./.test(codecs) || hevc && /\b(?:hvc1|hev1)\./.test(codecs)));
}

type Definition = { id: string; name: string; playlistUrl: string; guideUrl: string };
type Identity = () => DeviceIdentity | null;
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const methods = (allow: string) => new Response(null, { status: 405, headers: { Allow: allow } });
const publicChannel = ({ streamUrl: _stream, logoUrl: _logo, ...channel }: PrivateChannel): GuideChannel => channel;

export function createGuide({ databasePath, fetch: request = globalThis.fetch, onChange = () => {}, onSourcesChanged = () => {}, enqueue = () => {} }: {
  databasePath: string;
  fetch?: typeof fetch;
  onChange?: () => void;
  onSourcesChanged?: (channelIds: string[]) => void;
  enqueue?: (channel: GuideChannel, playNow: boolean, authorize: () => void, playedBy?: PlaybackActor) => void;
}) {
  if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
  const db = new Database(databasePath);
  db.exec("PRAGMA busy_timeout = 2000; PRAGMA journal_mode = WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS iptv_sources (id TEXT PRIMARY KEY, name TEXT NOT NULL, playlist_url TEXT NOT NULL, guide_url TEXT NOT NULL, updated_at INTEGER, error TEXT);
    CREATE TABLE IF NOT EXISTS iptv_channels (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, position INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS iptv_channel_order ON iptv_channels(source_id, position);
    CREATE TABLE IF NOT EXISTS iptv_programs (id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS iptv_program_order ON iptv_programs(channel_id, start);
    CREATE TABLE IF NOT EXISTS iptv_logos (id TEXT PRIMARY KEY, url TEXT NOT NULL, type TEXT NOT NULL, data BLOB NOT NULL, updated_at INTEGER NOT NULL);
  `);
  const shutdown = new AbortController();
  const refreshes = new Map<string, AbortController>();
  const logos = new Map<string, Promise<{ type: string; data: Uint8Array }>>();
  let closed = false;
  const assertOpen = () => { if (closed) throw new GuideError("The guide is closing.", 503); };
  // Clients learn only whether a source has a guide, never its URL.
  const sources = () => db.query<Omit<GuideSource, "hasGuide"> & { hasGuide: number }, []>(`SELECT s.id, s.name, s.updated_at AS updatedAt, s.error, s.guide_url <> '' AS hasGuide,
    (SELECT COUNT(*) FROM iptv_channels c WHERE c.source_id = s.id) AS channelCount,
    (SELECT COUNT(*) FROM iptv_programs p JOIN iptv_channels c ON p.channel_id = c.id WHERE c.source_id = s.id) AS programCount
    FROM iptv_sources s ORDER BY s.name COLLATE NOCASE, s.id`).all().map(source => ({ ...source, hasGuide: !!source.hasGuide }));
  const definition = (id: string) => {
    const source = db.query<Definition, [string]>("SELECT id, name, playlist_url AS playlistUrl, guide_url AS guideUrl FROM iptv_sources WHERE id = ?").get(id);
    if (!source) throw new GuideError("Guide source not found.", 404);
    return source;
  };
  const channel = (id: string): PrivateChannel => {
    assertOpen();
    const row = db.query<{ data: string }, [string]>("SELECT data FROM iptv_channels WHERE id = ?").get(id);
    if (!row) throw new GuideError("This channel is no longer in the guide.", 404);
    return JSON.parse(row.data);
  };
  const programSelect = "SELECT id, channel_id AS channelId, start, end, title, description FROM iptv_programs";
  function publishSourcesChanged(ids: string[]) {
    // A disconnected player cannot undo a committed guide mutation or
    // prevent controllers from receiving its invalidation.
    try { onSourcesChanged(ids); } catch { /* The session owns player availability. */ }
    onChange();
  }

  async function refresh(source: Definition, guard: () => void, signal: AbortSignal, replacing = false) {
    assertOpen();
    guard();
    refreshes.get(source.id)?.abort();
    const controller = new AbortController();
    refreshes.set(source.id, controller);
    const combined = AbortSignal.any([controller.signal, shutdown.signal, signal, AbortSignal.timeout(20_000)]);
    let changed: string[], skipped: { headers: number; duplicates: number };
    try {
      const playlist = await guideFetch(source.playlistUrl, guideLimits.playlistBytes, request, combined);
      const parsed = parseGuideChannels(Buffer.from(playlist.bytes).toString("utf8"), source.id, playlist.url), channels = parsed.channels;
      skipped = parsed.skipped;
      // The XMLTV guide is optional: without one, channels have no programmes.
      const guide = source.guideUrl ? await guideFetch(source.guideUrl, guideLimits.xmlBytes, request, combined) : null;
      const programs = guide ? parseGuidePrograms(Buffer.from(guide.bytes).toString("utf8"), channels) : [];
      assertOpen();
      combined.throwIfAborted();
      guard();
      const previous = db.query<{ data: string }, [string]>("SELECT data FROM iptv_channels WHERE source_id = ?").all(source.id).map(row => JSON.parse(row.data) as PrivateChannel);
      const currentUrls = new Map(channels.map(item => [item.id, item.streamUrl]));
      changed = previous.filter(item => currentUrls.get(item.id) !== item.streamUrl).map(item => item.id);
      db.transaction(() => {
        guard();
        if (!db.query("SELECT id FROM iptv_sources WHERE id = ?").get(source.id) && sources().length >= guideLimits.sources) throw new GuideError("Keep at most eight guide sources.", 409);
        db.query("INSERT INTO iptv_sources VALUES (?, ?, ?, ?, ?, NULL) ON CONFLICT(id) DO UPDATE SET name=excluded.name, playlist_url=excluded.playlist_url, guide_url=excluded.guide_url, updated_at=excluded.updated_at, error=NULL").run(source.id, source.name, source.playlistUrl, source.guideUrl, Date.now());
        db.query("DELETE FROM iptv_programs WHERE channel_id IN (SELECT id FROM iptv_channels WHERE source_id = ?)").run(source.id);
        db.query("DELETE FROM iptv_channels WHERE source_id = ?").run(source.id);
        const insertChannel = db.query("INSERT INTO iptv_channels VALUES (?, ?, ?, ?)");
        channels.forEach((item, index) => insertChannel.run(item.id, source.id, index, JSON.stringify(item)));
        const insertProgram = db.query("INSERT INTO iptv_programs VALUES (?, ?, ?, ?, ?, ?)");
        for (const item of programs) insertProgram.run(item.id, item.channelId, item.start, item.end, item.title, item.description);
        db.exec("DELETE FROM iptv_logos WHERE NOT EXISTS (SELECT 1 FROM iptv_channels c WHERE c.id = iptv_logos.id AND json_extract(c.data, '$.logoUrl') = iptv_logos.url)");
      })();
    } catch (error) {
      assertOpen();
      guard();
      if (controller.signal.aborted || signal.aborted) throw new GuideError("This refresh was canceled by a newer request.", 409);
      const kept = db.query("SELECT 1 FROM iptv_channels WHERE source_id = ? LIMIT 1").get(source.id) ? " Saved channels and guide data were kept." : "";
      const message = `${error instanceof GuideError ? error.message : "Couldn't read the source."}${kept}`;
      // Never copy parser, fetch, or upstream response text into public errors.
      if (!replacing) { db.query("UPDATE iptv_sources SET error = ? WHERE id = ?").run(message, source.id); onChange(); }
      if (error instanceof GuideError && error.status === 409) throw error;
      throw new GuideError(message, 502);
    } finally { if (refreshes.get(source.id) === controller) refreshes.delete(source.id); }
    // Keep post-commit effects outside the refresh failure path.
    publishSourcesChanged(changed);
    return { source: sources().find(item => item.id === source.id)!, skipped };
  }

  async function body(req: Request): Promise<Record<string, unknown>> {
    if (req.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") throw new GuideError("Send a JSON object.", 415);
    const bytes = await boundedBytes(new Response(req.body, { headers: req.headers }), 12_000, AbortSignal.any([req.signal, shutdown.signal, AbortSignal.timeout(10_000)]));
    let value: unknown;
    try { value = JSON.parse(Buffer.from(bytes).toString()); } catch { throw new GuideError("Send a JSON object."); }
    if (!record(value)) throw new GuideError("Send a JSON object.");
    return value;
  }

  async function logo(item: PrivateChannel) {
    const cached = db.query<{ type: string; data: Uint8Array }, [string, string]>("SELECT type, data FROM iptv_logos WHERE id = ? AND url = ?").get(item.id, item.logoUrl!);
    if (cached) return cached;
    let pending = logos.get(item.id);
    if (!pending) {
      if (logos.size >= 8) throw new GuideError("Artwork is busy. Try again shortly.", 503);
      pending = (async () => {
        const { bytes } = await guideFetch(item.logoUrl!, 256 * 1024, request, AbortSignal.any([shutdown.signal, AbortSignal.timeout(5_000)]));
        const data = Buffer.from(bytes);
        const type = data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "image/png" : data[0] === 255 && data[1] === 216 && data[2] === 255 ? "image/jpeg" : data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP" ? "image/webp" : null;
        if (!type) throw new GuideError("This logo is not a supported raster image.", 415);
        assertOpen();
        if (channel(item.id).logoUrl !== item.logoUrl) throw new GuideError("The channel changed.", 409);
        db.query("INSERT OR REPLACE INTO iptv_logos VALUES (?, ?, ?, ?, ?)").run(item.id, item.logoUrl!, type, data, Date.now());
        while (db.query<{ size: number }, []>("SELECT COALESCE(SUM(length(data)), 0) AS size FROM iptv_logos").get()!.size > 16 * 1024 * 1024) db.exec("DELETE FROM iptv_logos WHERE id = (SELECT id FROM iptv_logos ORDER BY updated_at LIMIT 1)");
        return { type, data };
      })().finally(() => { logos.delete(item.id); });
      logos.set(item.id, pending);
    }
    return pending;
  }

  return {
    sources,
    async getPlayable(id: string, signal: AbortSignal, hostOutput: boolean) {
      const item = channel(id);
      signal.throwIfAborted();
      // Only identified HLS URLs enter this EVENT increment. Other live media
      // must not wait for a body that may never finish before playback.
      if (!new URL(item.streamUrl).pathname.toLowerCase().endsWith(".m3u8")) return { source: item.streamUrl, ...await transport(item.streamUrl, AbortSignal.any([signal, shutdown.signal]), linux && hostOutput) };
      let eventStart = false, mpv = false;
      try {
        const media = await guideFetch(item.streamUrl, 512 * 1024, request, AbortSignal.any([signal, shutdown.signal, AbortSignal.timeout(5_000)]));
        const text = Buffer.from(media.bytes).toString("utf8");
        eventStart = liveHlsPlaylist(text, media.url) && /^#EXT-X-PLAYLIST-TYPE:EVENT\r?$/m.test(text);
        mpv = mpvPlaylist(text, linux && hostOutput);
      } catch { /* Unknown transports and failed probes keep ordinary Play. */ }
      signal.throwIfAborted();
      shutdown.signal.throwIfAborted();
      if (channel(id).streamUrl !== item.streamUrl) throw new GuideError("The channel changed. Play it again.", 409);
      return { source: item.streamUrl, ...(eventStart ? { eventStart: true } : {}), ...(mpv ? { mpv: true } : {}) };
    },
    async handle(req: Request, identity: Identity, playedBy?: PlaybackActor): Promise<Response> {
      const caller = () => { assertOpen(); const value = identity(); if (!value) throw new GuideError("Pair this device first.", 401); return value; };
      const administrator = () => { if (caller().authority === "controller") throw new GuideError(ADMIN_ONLY, 403); };
      try {
        caller();
        const { pathname: path, searchParams: query } = new URL(req.url);
        if (path === "/api/iptv/sources") {
          if (req.method === "GET") return json({ sources: sources() });
          if (req.method !== "POST") return methods("GET, POST");
          administrator();
          const value = await body(req);
          administrator();
          if (sources().length >= guideLimits.sources) throw new GuideError("Keep at most eight guide sources.", 409);
          const source = { id: crypto.randomUUID(), name: guideText(value.name, 100), playlistUrl: guideUrl(value.playlistUrl), guideUrl: value.guideUrl === undefined || value.guideUrl === "" ? "" : guideUrl(value.guideUrl) };
          return json(await refresh(source, administrator, req.signal, true), 201);
        }
        const sourcePath = /^\/api\/iptv\/sources\/([\w-]{1,80})(\/refresh)?$/.exec(path);
        if (sourcePath) {
          if (!["POST", "DELETE"].includes(req.method) || sourcePath[2] && req.method !== "POST") return methods(sourcePath[2] ? "POST" : "POST, DELETE");
          administrator();
          const source = definition(sourcePath[1]!);
          if (req.method === "DELETE") {
            refreshes.get(source.id)?.abort();
            const removed = db.query<{ id: string }, [string]>("SELECT id FROM iptv_channels WHERE source_id = ?").all(source.id).map(item => item.id);
            db.transaction(() => {
              administrator();
              db.query("DELETE FROM iptv_programs WHERE channel_id IN (SELECT id FROM iptv_channels WHERE source_id = ?)").run(source.id);
              db.query("DELETE FROM iptv_logos WHERE id IN (SELECT id FROM iptv_channels WHERE source_id = ?)").run(source.id);
              db.query("DELETE FROM iptv_channels WHERE source_id = ?").run(source.id);
              db.query("DELETE FROM iptv_sources WHERE id = ?").run(source.id);
            })();
            publishSourcesChanged(removed);
            return new Response(null, { status: 204 });
          }
          if (sourcePath[2]) return json(await refresh(source, administrator, req.signal));
          const value = await body(req);
          administrator();
          definition(source.id);
          // A blank URL keeps the saved one; Couch never sends saved URLs back to clients.
          // A null guide URL removes the guide, and the refresh drops its programmes.
          return json(await refresh({ id: source.id, name: guideText(value.name, 100), playlistUrl: value.playlistUrl === undefined || value.playlistUrl === "" ? source.playlistUrl : guideUrl(value.playlistUrl), guideUrl: value.guideUrl === null ? "" : value.guideUrl === undefined || value.guideUrl === "" ? source.guideUrl : guideUrl(value.guideUrl) }, administrator, req.signal, true));
        }
        if (path === "/api/iptv/guide") {
          if (req.method !== "GET") return methods("GET");
          const q = guideText(query.get("q") ?? "", 100, true).toLocaleLowerCase();
          const group = guideText(query.get("group") ?? "", 200, true);
          const offset = Number(query.get("offset") ?? 0);
          if (!Number.isInteger(offset) || offset < 0 || offset > guideLimits.channels * guideLimits.sources) throw new GuideError("Invalid guide offset.");
          const at = Date.now();
          const all = db.query<{ data: string }, []>("SELECT c.data FROM iptv_channels c JOIN iptv_sources s ON c.source_id = s.id ORDER BY s.name COLLATE NOCASE, s.id, c.position").all().map(row => publicChannel(JSON.parse(row.data)));
          const filtered = all.filter(item => (!group || item.group === group) && (!q || `${item.name} ${item.group}`.toLocaleLowerCase().includes(q)));
          const channels = filtered.slice(offset, offset + 50).map(item => ({ ...item,
            now: db.query<GuideProgram, [string, number, number]>(`${programSelect} WHERE channel_id = ? AND start <= ? AND end > ? ORDER BY start DESC LIMIT 1`).get(item.id, at, at),
            next: db.query<GuideProgram, [string, number]>(`${programSelect} WHERE channel_id = ? AND start > ? ORDER BY start LIMIT 1`).get(item.id, at),
          }));
          return json({ channels, total: filtered.length, groups: [...new Set(all.map(item => item.group).filter(Boolean))].sort(), sources: sources(), at } satisfies GuidePage);
        }
        const channelPath = /^\/api\/iptv\/channels\/([a-f0-9]{64})\/(programs|play|queue|logo|capabilities)$/.exec(path);
        if (channelPath) {
          const item = channel(channelPath[1]!);
          if (channelPath[2] === "play" || channelPath[2] === "queue") {
            if (req.method !== "POST") return methods("POST");
            caller();
            const current = channel(item.id);
            enqueue(publicChannel(current), channelPath[2] === "play", caller, playedBy);
            return json({ ok: true });
          }
          if (req.method !== "GET") return methods("GET");
          if (channelPath[2] === "capabilities") {
            let liveEdge: "reload" | null = null;
            try {
              const media = await guideFetch(item.streamUrl, 512 * 1024, request, AbortSignal.any([req.signal, shutdown.signal, AbortSignal.timeout(5_000)]));
              const text = Buffer.from(media.bytes).toString("utf8");
              // Only a directly supplied live HLS media playlist qualifies here.
              // Master playlists, VOD, and unknown transports keep ordinary Play.
              if (liveHlsPlaylist(text, media.url) && channel(item.id).streamUrl === item.streamUrl) liveEdge = "reload";
            } catch { /* A failed capability probe must not prevent playback. */ }
            caller();
            return json({ liveEdge, catchup: null });
          }
          if (channelPath[2] === "programs") {
            const start = Number(query.get("start") ?? Date.now());
            const end = Number(query.get("end") ?? start + 24 * 60 * 60_000);
            if (![start, end].every(Number.isSafeInteger) || start < 0 || end <= start || end - start > 7 * 24 * 60 * 60_000) throw new GuideError("Choose a guide range of at most seven days.");
            const programs = db.query<GuideProgram, [string, number, number]>(`${programSelect} WHERE channel_id = ? AND start < ? AND end > ? ORDER BY start LIMIT 501`).all(item.id, end, start);
            return json({ channel: publicChannel(item), programs: programs.slice(0, 500), truncated: programs.length > 500 });
          }
          if (!item.logoUrl) throw new GuideError("This channel has no logo.", 404);
          const image = await logo(item);
          caller();
          return new Response(Buffer.from(image.data), { headers: { "Content-Type": image.type, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=300" } });
        }
        return json({ error: "Not found." }, 404);
      } catch (error) {
        return json({ error: error instanceof GuideError ? error.message : "Couldn't complete the guide request." }, error instanceof GuideError ? error.status : 500);
      }
    },
    close() {
      if (closed) return;
      closed = true;
      shutdown.abort();
      db.close();
    },
  };
}
