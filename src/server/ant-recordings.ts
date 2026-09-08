import type { Database } from "bun:sqlite";
import type { Recording } from "../shared/recordings";
import { boundedBytes, guideText, liveHlsPlaylist, record } from "./iptv-feeds";
import { RecordingError } from "./tvheadend";
import type { MediaSource } from "./session";

type Setup = { revision: number; endpoint: string; username: string; password: string; captureHours: number; retentionDays: number; storageGiB: number };
type Job = { public: Recording; streamId: string; date: number; startTime: number; expiresAt: number };
type Broadcast = { streamId: string; date: number; startTime: number; plannedEndDate: number; status: string; name?: string; subFolder?: string };
const identifier = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value);
function fail(message: string, status = 409): never { throw new RecordingError(message, status); }

// Ant owns capture and storage. Couch only attaches and reads existing broadcasts.
export function createAntRecordings(db: Database, { request, shutdown, assertOpen, publish, connectionChanged, mediaUrl }: {
  request: typeof fetch; shutdown: AbortSignal; assertOpen: () => void; publish: () => void; connectionChanged: () => void; mediaUrl: (path: string) => string;
}) {
  db.run("CREATE TABLE IF NOT EXISTS ant_recording_setup (id INTEGER PRIMARY KEY CHECK(id = 1), data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS ant_recording_jobs (id TEXT PRIMARY KEY, data TEXT NOT NULL);");
  const setup = (): Setup | null => { const row = db.query<{ data: string }, []>("SELECT data FROM ant_recording_setup WHERE id = 1").get(); return row ? JSON.parse(row.data) : null; };
  const jobs = (): Job[] => db.query<{ data: string }, []>("SELECT data FROM ant_recording_jobs ORDER BY rowid DESC").all().map(row => JSON.parse(row.data));
  const get = (id: string) => jobs().find(job => job.public.id === id);
  let generation = new AbortController();
  let refreshCursor = 0;
  const leases = new Map<string, { job: Job; signal: AbortSignal; files: Set<string>; complete: boolean; pending: number }>();
  const guard = (signal: AbortSignal) => { signal.throwIfAborted(); assertOpen(); };
  const combined = (signal: AbortSignal) => AbortSignal.any([signal, shutdown, generation.signal]);
  const configured = () => setup() ?? fail("Connect Ant Media before attaching a recording.");
  const headers = (config: Setup) => ({ Authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}` });
  async function response(config: Setup, path: string, signal: AbortSignal, extra: Record<string, string> = {}, authenticated = true) {
    guard(signal);
    const result = await request(`${config.endpoint}/${path}`, { headers: { ...(authenticated ? headers(config) : {}), ...extra }, redirect: "error", signal });
    guard(signal);
    if (!result.ok) { await result.body?.cancel(); fail([401, 403].includes(result.status) ? "Ant access expired or was denied. An administrator must check the private proxy account." : [404, 410].includes(result.status) ? "This Ant recording is unavailable or its retained files have expired." : "The Ant backend could not read this recording.", 502); }
    return result;
  }
  async function readBroadcast(config: Setup, streamId: string, signal: AbortSignal): Promise<Broadcast> {
    const bytes = await boundedBytes(await response(config, `rest/v2/broadcasts/${streamId}`, signal), 64 * 1024, signal);
    let row: unknown; try { row = JSON.parse(Buffer.from(bytes).toString()); } catch { fail("Ant returned an invalid broadcast.", 502); }
    if (!record(row) || row.streamId !== streamId || !Number.isSafeInteger(row.date) || Number(row.date) <= 0 || !Number.isSafeInteger(row.startTime) || Number(row.startTime) <= 0 || !Number.isSafeInteger(row.plannedEndDate) || typeof row.status !== "string" || row.subFolder) fail("Use an existing started Ant broadcast with a stable ID, start time and no subfolder.");
    return row as Broadcast;
  }
  async function identity(job: Job, config: Setup, signal: AbortSignal) {
    if (Date.now() >= job.expiresAt) fail("This recording's declared backend retention window has expired.", 410);
    const row = await readBroadcast(config, job.streamId, signal);
    if (row.date !== job.date || row.startTime !== job.startTime || row.plannedEndDate * 1000 !== job.public.end) fail("The Ant broadcast was replaced or restarted. Attach the new capture as a separate recording.");
    return row;
  }
  function save(job: Job, status: Recording["status"], cause: string | null) {
    assertOpen();
    if (status === "failed") for (const lease of leases.values()) if (lease.job.public.id === job.public.id) lease.complete = false;
    const current = get(job.public.id);
    if (!current || current.public.status === status && current.public.cause === cause) return;
    db.query("UPDATE ant_recording_jobs SET data = ? WHERE id = ?").run(JSON.stringify({ ...current, public: { ...current.public, status, cause, revision: current.public.revision + 1 } }), job.public.id);
    publish();
  }
  async function playlist(job: Job, config: Setup, signal: AbortSignal) {
    const row = await identity(job, config, signal);
    if (!["broadcasting", "finished"].includes(row.status)) fail("This Ant broadcast is not currently available for playback.");
    if (row.status === "broadcasting" && Date.now() > job.public.end) fail("Ant exceeded this recording's declared capture deadline. Its administrator must stop capture.");
    const base = `${config.endpoint}/streams/${job.streamId}.m3u8`;
    const bytes = await boundedBytes(await response(config, `streams/${job.streamId}.m3u8`, signal), 512 * 1024, signal);
    const text = Buffer.from(bytes).toString("utf8").replaceAll("\r\n", "\n");
    const end = text.split("\n").filter(line => line === "#EXT-X-ENDLIST").length;
    if (end > 1 || end === 1 && !text.trimEnd().endsWith("#EXT-X-ENDLIST") || !text.includes("#EXT-X-PLAYLIST-TYPE:EVENT\n") || !liveHlsPlaylist(text.replace(/^#EXT-X-ENDLIST\n?/m, ""), base)) fail("Ant must retain a direct EVENT playlist from the start of this capture.");
    // Only ordinary TS EVENT playlists are admitted. No nested manifests, keys,
    // arbitrary URI attributes or absolute child credentials reach native HTTP.
    const files = new Set<string>();
    const lines = text.split("\n").map(line => {
      if (!line || line.startsWith("#")) {
        if (line && !/^#(?:EXTM3U|EXTINF:|EXT-X-(?:VERSION:|TARGETDURATION:|MEDIA-SEQUENCE:0$|PLAYLIST-TYPE:EVENT$|ENDLIST$|DISCONTINUITY$|PROGRAM-DATE-TIME:|INDEPENDENT-SEGMENTS$))/.test(line)) fail("This Ant playlist uses unsupported media directives.");
        return line;
      }
      const url = new URL(line, base), name = url.pathname.split("/").at(-1)!;
      if (url.origin !== new URL(config.endpoint).origin || url.pathname !== `${new URL(config.endpoint).pathname}/streams/${name}` || url.search || url.hash || url.username || url.password || !new RegExp(`^${job.streamId}[0-9]+\\.ts$`).test(name)) fail("The Ant playlist points outside this recording's private media path.");
      files.add(name); return name;
    });
    guard(signal);
    const current = await identity(job, config, signal);
    const complete = current.status === "finished" && end === 1;
    if (current.status === "broadcasting" && end) fail("Ant ended the playlist while its broadcast is still running. Refresh its backend status.");
    save(job, complete ? "completed" : "running", null);
    return { text: lines.join("\n"), files, complete };
  }
  async function refresh(job: Job, signal: AbortSignal) {
    try { await playlist(job, configured(), signal); }
    catch (error) { guard(shutdown); save(job, "failed", error instanceof RecordingError ? error.message : "The Ant recording is temporarily unavailable. Refresh to retry."); }
  }
  return {
    has: (id: string) => !!get(id),
    snapshot: () => ({ configured: !!setup(), jobs: jobs().map(job => job.public) }),
    settings: () => { const config = setup(); return { configured: !!config, revision: config?.revision ?? 0, captureHours: config?.captureHours ?? 24, retentionDays: config?.retentionDays ?? 7, storageGiB: config?.storageGiB ?? 100 }; },
    async configure(value: Record<string, unknown>, authorize: () => void, signal: AbortSignal) {
      const previous = setup();
      if (value.revision !== (previous?.revision ?? 0)) fail("Ant setup changed. Reload it before saving.");
      const endpoint = guideText(value.endpoint, 2048), username = guideText(value.username, 200);
      if (typeof value.password !== "string" || !value.password || value.password.length > 4096 || /[\u0000-\u001f\u007f]/.test(value.password)) fail("Enter a valid private proxy password.");
      const password = value.password;
      let url: URL; try { url = new URL(endpoint); } catch { return fail("Enter an Ant application HTTPS URL, or HTTP on loopback."); }
      if (url.username || url.password || url.search || url.hash || !/^\/[A-Za-z0-9_-]+$/.test(url.pathname) || /[\s\\]/.test(endpoint) || username.includes(":") || !(url.protocol === "https:" || url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))) fail("Use an Ant application HTTPS URL, or HTTP on loopback, without embedded credentials.");
      for (const [key, max] of [["captureHours", 168], ["retentionDays", 3650], ["storageGiB", 1_048_576]] as const) if (!Number.isInteger(value[key]) || Number(value[key]) < 1 || Number(value[key]) > max) fail("Enter finite backend capture, retention and storage limits.");
      if (value.storageConfigured !== true) fail("Confirm that the backend administrator enforces the declared capture and storage limits.");
      if (previous && jobs().length && (previous.endpoint !== url.href || previous.username !== username)) fail("Existing recordings belong to this Ant endpoint and account. Keep their identity when replacing credentials.");
      guard(signal); authorize();
      const config: Setup = { endpoint: url.href, username, password, revision: (previous?.revision ?? 0) + 1, captureHours: Number(value.captureHours), retentionDays: Number(value.retentionDays), storageGiB: Number(value.storageGiB) };
      db.query("INSERT OR REPLACE INTO ant_recording_setup VALUES (1, ?)").run(JSON.stringify(config));
      generation.abort(); generation = new AbortController(); leases.clear(); connectionChanged(); publish();
      return this.settings();
    },
    async attach(value: Record<string, unknown>, authorize: () => void, signal: AbortSignal) {
      const config = configured();
      if (value.revision !== config.revision) fail("Ant setup changed. Reload it before attaching.");
      if (!identifier(value.streamId)) fail("Enter the exact Ant broadcast ID.");
      const cancellation = combined(signal), timeout = AbortSignal.any([cancellation, AbortSignal.timeout(8_000)]);
      const row = await readBroadcast(config, value.streamId, timeout);
      const previous = jobs().find(job => job.streamId === row.streamId && job.date === row.date && job.startTime === row.startTime);
      if (previous) { guard(cancellation); authorize(); return previous.public; }
      if (jobs().length >= 500) fail("This installation has reached its 500 Ant recording limit.");
      if (row.plannedEndDate * 1000 <= row.startTime || row.plannedEndDate * 1000 - row.startTime > config.captureHours * 3_600_000) fail("Set this broadcast's finite planned end on Ant within the declared capture limit.");
      // Management authentication alone does not protect HLS. Verify the actual
      // API and manifest paths reject anonymous reads before saving the job.
      for (const path of [`rest/v2/broadcasts/${row.streamId}`, `streams/${row.streamId}.m3u8`]) {
        const anonymous = await request(`${config.endpoint}/${path}`, { redirect: "error", signal: timeout });
        await anonymous.body?.cancel();
        if (![401, 403].includes(anonymous.status)) fail("The private reverse proxy must deny anonymous broadcast and HLS reads. Ant Community tokens do not enforce this.");
      }
      const id = crypto.randomUUID();
      const job: Job = { streamId: row.streamId, date: row.date, startTime: row.startTime, expiresAt: row.plannedEndDate * 1000 + config.retentionDays * 86_400_000,
        public: { id, backend: "ant", programId: id, channelId: id, channelName: "Ant recording", title: guideText(value.title || row.name || row.streamId, 200), start: row.startTime, end: row.plannedEndDate * 1000, status: "running", cause: null, revision: 1, cancelRequested: false } };
      const media = await playlist(job, config, timeout);
      for (const file of new Set([media.files.values().next().value!, [...media.files].at(-1)!])) {
        const anonymous = await request(`${config.endpoint}/streams/${file}`, { headers: { Range: "bytes=0-0" }, redirect: "error", signal: timeout });
        await anonymous.body?.cancel();
        if (![401, 403].includes(anonymous.status)) fail("The private proxy must protect HLS segments as well as the playlist.");
      }
      job.public.status = media.complete ? "completed" : "running";
      guard(cancellation); authorize();
      db.query("INSERT INTO ant_recording_jobs VALUES (?, ?)").run(id, JSON.stringify(job)); publish();
      return job.public;
    },
    async refresh(signal: AbortSignal) {
      const all = jobs(), timeout = AbortSignal.any([combined(signal), AbortSignal.timeout(8_000)]);
      for (let checked = 0; checked < all.length && !timeout.aborted; checked++) {
        const job = all[refreshCursor++ % all.length]!;
        await refresh(job, timeout);
      }
    },
    async resolve(id: string, signal: AbortSignal): Promise<MediaSource> {
      try {
      const job = get(id) ?? fail("Recording not found.", 404), config = configured(), cancellation = combined(signal);
      const media = await playlist(job, config, AbortSignal.any([cancellation, AbortSignal.timeout(8_000)]));
      guard(cancellation);
      const token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
      const lease = { job, signal: cancellation, files: media.files, complete: media.complete, pending: 0 };
      leases.set(token, lease);
      cancellation.addEventListener("abort", () => { lease.complete = false; leases.delete(token); }, { once: true });
      return { source: mediaUrl(`/api/recording-media/${token}/${job.streamId}.m3u8`), eventStart: true, canComplete: ended => ended && !cancellation.aborted && lease.complete };
      } catch (error) {
        if (error instanceof RecordingError) throw error;
        throw new RecordingError("Could not open the Ant recording. Refresh its status and try again.", 502);
      }
    },
    async media(req: Request): Promise<Response> {
      const match = /^\/api\/recording-media\/([a-f0-9]{64})\/([A-Za-z0-9_-]+\.(?:m3u8|ts))$/.exec(new URL(req.url).pathname);
      const lease = match && leases.get(match[1]!);
      if (!lease || !match || req.method !== "GET" || lease.signal.aborted) return new Response(null, { status: 404 });
      if (lease.pending >= 4) return new Response(null, { status: 429 });
      lease.pending++;
      let streaming = false;
      const done = () => { lease.pending--; };
      const cancellation = AbortSignal.any([lease.signal, req.signal, AbortSignal.timeout(8_000)]);
      try {
        const config = configured(), file = match[2]!;
        if (file === `${lease.job.streamId}.m3u8`) {
          const media = await playlist(lease.job, config, cancellation);
          lease.files = media.files; lease.complete = media.complete;
          return new Response(media.text, { headers: { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store" } });
        }
        if (!lease.files.has(file)) return new Response(null, { status: 404 });
        await identity(lease.job, config, cancellation);
        const range = req.headers.get("range");
        if (range && !/^bytes=\d+-\d*$/.test(range)) return new Response(null, { status: 416 });
        const upstream = await response(config, `streams/${file}`, cancellation, range ? { Range: range } : {});
        const length = Number(upstream.headers.get("content-length"));
        if (length > 16 * 1024 * 1024 || !upstream.body) { await upstream.body?.cancel(); fail("Ant returned an oversized or empty media segment.", 502); }
        const reader = upstream.body.getReader(); let bytes = 0, closed = false;
        const finish = () => { if (!closed) { closed = true; done(); cancellation.removeEventListener("abort", abort); reader.releaseLock(); } };
        const abort = () => { void reader.cancel().finally(finish); };
        cancellation.addEventListener("abort", abort, { once: true });
        streaming = true;
        return new Response(new ReadableStream<Uint8Array>({
          async pull(controller) {
            try {
              guard(cancellation); const part = await reader.read(); guard(cancellation);
              if (part.done) { controller.close(); finish(); return; }
              bytes += part.value.length;
              if (bytes > 16 * 1024 * 1024) throw new Error("Ant segment exceeds its byte limit.");
              controller.enqueue(part.value);
            } catch (error) {
              lease.complete = false;
              if (!lease.signal.aborted && !shutdown.aborted && !req.signal.aborted) {
                try { save(lease.job, "failed", "The Ant media segment was interrupted or exceeded its byte limit. Refresh to retry."); } catch { /* Shutdown must still release the HTTP reader. */ }
              }
              controller.error(error); await reader.cancel().catch(() => {}); finish();
            }
          },
          async cancel() { await reader.cancel().catch(() => {}); finish(); },
        }, { highWaterMark: 1 }), { status: upstream.status, headers: { "Content-Type": "video/mp2t", "Cache-Control": "no-store", ...(upstream.headers.has("content-length") ? { "Content-Length": upstream.headers.get("content-length")! } : {}), ...(upstream.headers.has("content-range") ? { "Content-Range": upstream.headers.get("content-range")! } : {}) } });
      } catch (error) {
        lease.complete = false;
        if (!lease.signal.aborted && !shutdown.aborted) save(lease.job, "failed", error instanceof RecordingError ? error.message : "The Ant media request failed. Refresh to retry.");
        return new Response(null, { status: 502 });
      } finally { if (!streaming) done(); }
    },
  };
}
