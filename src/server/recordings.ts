import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ControllerIdentity } from "../shared/controllers";
import type { GuideChannel, GuideProgram } from "../shared/iptv";
import type { Recording, RecordingMapping, RecordingsPage } from "../shared/recordings";
import { boundedBytes, record } from "./iptv-feeds";
import { backendUuid, connectionInput, createTvheadend, RecordingError, type BackendJob, type RecordingConnection, type RecordingVerification } from "./tvheadend";

type Selection = { channel: GuideChannel; program: GuideProgram };
type Job = Recording & { sourceId: string; tvgId: string; backendChannel: string; backendId: string | null; eventId: null; backendCause: string | null };
type Setup = { qualified?: boolean; revision: number; connection: RecordingConnection; mappings: RecordingMapping[] };
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const publicJob = ({ sourceId: _source, tvgId: _tvg, backendChannel: _channel, backendId: _backend, eventId: _event, backendCause: _cause, ...job }: Job): Recording => job;
const knownCauses = new Map([["No free adapter", "No free recording input."], ["No assigned adapters", "No input is assigned to this channel."], ["File missing", "The recording file is missing."], ["Invalid", "The backend rejected this recording."], ["Not enough disk space", "The backend ran out of recording space."]]);
const method = (allow: string) => new Response(null, { status: 405, headers: { Allow: allow, "Cache-Control": "no-store" } });

export function createRecordings({ databasePath, selection, channel, onChange = () => {}, onConnectionChanged = () => {}, enqueue = () => {}, fetch: request = globalThis.fetch, pollMs = 10_000 }: {
  databasePath: string;
  selection: (programId: string) => Selection;
  channel: (channelId: string) => GuideChannel;
  onChange?: () => void;
  onConnectionChanged?: () => void;
  enqueue?: (job: Recording, authorize: () => void) => void;
  fetch?: typeof fetch;
  pollMs?: number;
}) {
  if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
  const db = new Database(databasePath, { create: true, strict: true });
  db.run("PRAGMA busy_timeout = 2000; PRAGMA journal_mode = WAL;");
  db.run(`CREATE TABLE IF NOT EXISTS recording_setup (id INTEGER PRIMARY KEY CHECK(id = 1), data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS recording_jobs (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS recording_qualification (id INTEGER PRIMARY KEY CHECK(id = 1), data TEXT NOT NULL);`);
  const shutdown = new AbortController();
  let connectionGeneration = new AbortController();
  let closed = false, checkedAt: number | null = null, error: string | null = null;
  let tail: Promise<unknown> = Promise.resolve();
  const assertOpen = () => { if (closed) throw new RecordingError("Recordings are closing.", 503); };
  const setup = (): Setup | null => { const row = db.query<{ data: string }, []>("SELECT data FROM recording_setup WHERE id = 1").get(); return row ? JSON.parse(row.data) : null; };
  const jobs = (): Job[] => db.query<{ data: string }, []>("SELECT data FROM recording_jobs ORDER BY rowid DESC").all().map(row => JSON.parse(row.data));
  const get = (id: string): Job => { const row = jobs().find(job => job.id === id); if (!row) throw new RecordingError("Recording not found.", 404); return row; };
  const save = (job: Job) => db.query("INSERT OR REPLACE INTO recording_jobs VALUES (?, ?)").run(job.id, JSON.stringify(job));
  const configured = () => { const value = setup(); if (!value?.qualified) throw new RecordingError("An administrator must verify recording backend setup first.", 409); return value; };
  const backend = (value = configured()) => createTvheadend(value.connection, shutdown.signal, request);
  const snapshot = (): RecordingsPage => ({ configured: !!setup()?.qualified, revision: setup()?.revision ?? 0, checkedAt, error, jobs: jobs().map(publicJob) });
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = tail.then(() => { assertOpen(); return work(); });
    tail = next.catch(() => {});
    return next;
  };
  function publish() { assertOpen(); onChange(); }
  function update(job: Job, changes: Partial<Job>) {
    const next = { ...job, ...changes };
    if (JSON.stringify(next) === JSON.stringify(job)) return;
    save({ ...next, revision: job.revision + 1 });
  }
  async function reconcile() {
    if (!setup()) return;
    try {
      const rows = await backend().jobs();
      assertOpen();
      db.transaction(() => {
        for (const job of jobs()) {
          const matches = rows.filter(row => job.backendId ? row.uuid === job.backendId : row.comment === `Couch:${job.id}`);
          if (matches.length > 1) { update(job, { status: "checking", cause: "The backend has duplicate job identities. Ask its administrator to reconcile them." }); continue; }
          const row = matches[0];
          if (!row) {
            if (job.cancelRequested) update(job, { status: "cancelled", cause: null });
            else if (job.backendId && job.status !== "cancelled") update(job, { status: "failed", cause: job.cause ?? "This recording is no longer on the backend." });
            continue;
          }
          if (job.status === "cancelled") { update(job, { status: "checking", cause: "The backend restored a cancelled recording. Refresh and review it." }); continue; }
          if (row.channel !== job.backendChannel || row.owner !== configured().connection.username || row.start * 1000 !== job.start || row.stop * 1000 !== job.end) {
            update(job, { backendId: row.uuid, status: "failed", cause: "The backend recording does not match the saved channel, owner, or times." }); continue;
          }
          const failed = /Error$/i.test(row.sched_status) || row.sched_status === "unknown" || row.errorcode > 0;
          const status = failed ? "failed" : row.sched_status === "scheduled" ? "pending" : row.sched_status === "recording" ? "running" : row.sched_status === "completed" && row.filesize > 0 ? "completed" : "failed";
          const rawCause = failed ? `${row.status ?? ""}`.slice(0, 1000) : null;
          update(job, { backendId: row.uuid, status, backendCause: job.backendCause ?? rawCause, cause: job.cause ?? (failed ? knownCauses.get(row.status) ?? "The backend could not record this programme." : status === "failed" ? "The backend did not produce a completed recording." : null) });
        }
      })();
      checkedAt = Date.now(); error = null; publish();
    } catch (reason) {
      assertOpen();
      error = reason instanceof RecordingError ? reason.message : "The recording backend is unavailable. Showing the last confirmed state.";
      publish();
      throw new RecordingError(error, 502);
    }
  }
  let polling = false;
  const timer = pollMs > 0 ? setInterval(() => { if (!polling && setup()) { polling = true; void serial(reconcile).catch(() => {}).finally(() => { polling = false; }); } }, pollMs) : undefined;
  timer?.unref();
  async function body(req: Request) {
    if (req.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") throw new RecordingError("Send a JSON object.", 415);
    const bytes = await boundedBytes(new Response(req.body, { headers: req.headers }), 16_384, AbortSignal.any([req.signal, shutdown.signal, AbortSignal.timeout(8_000)]));
    let value: unknown;
    try { value = JSON.parse(Buffer.from(bytes).toString()); } catch { throw new RecordingError("Send a JSON object."); }
    if (!record(value)) throw new RecordingError("Send a JSON object.");
    return value;
  }
  return {
    snapshot,
    refresh: () => serial(reconcile),
    async resolve(id: string, signal: AbortSignal) {
      assertOpen();
      const combined = AbortSignal.any([signal, shutdown.signal, connectionGeneration.signal]);
      const job = get(id);
      if (job.status !== "completed" || !job.backendId) throw new RecordingError("Wait for this recording to complete.", 409);
      try {
        const playable = await backend().playable(job.backendId, combined);
        combined.throwIfAborted(); assertOpen();
        if (get(id).status !== "completed" || get(id).backendId !== job.backendId) throw new RecordingError("The recording changed. Play it again.", 409);
        return playable;
      } catch (reason) {
        if (reason instanceof RecordingError) throw reason;
        throw new RecordingError("Could not open the completed recording.", 502);
      }
    },
    async handle(req: Request, identity: () => ControllerIdentity | null): Promise<Response> {
      const caller = () => { assertOpen(); const value = identity(); if (!value) throw new RecordingError("Pair this device before connecting.", 401); return value; };
      const administrator = () => { if (caller().authority === "controller") throw new RecordingError("An administrator is required to configure recordings.", 403); };
      const guard = () => { caller(); req.signal.throwIfAborted(); };
      try {
        caller();
        const path = new URL(req.url).pathname;
        if (path === "/api/recordings" && req.method === "GET") return json(snapshot());
        if (path === "/api/recordings/refresh") {
          if (req.method !== "POST") return method("POST");
          await serial(async () => { guard(); await reconcile(); }); caller(); return json(snapshot());
        }
        if (path === "/api/recordings/setup") {
          administrator();
          if (req.method === "GET") return json({ revision: setup()?.revision ?? 0, configured: !!setup()?.qualified, mappings: setup()?.mappings ?? [] });
          if (req.method !== "POST") return method("GET, POST");
          const value = await body(req);
          return await serial(async () => {
            administrator(); guard();
            const previous = setup();
            if (value.revision !== (previous?.revision ?? 0)) throw new RecordingError("Recording setup changed on another remote. Reload it and try again.", 409);
            const connection = connectionInput(value);
            if (previous && jobs().length && ["endpoint", "username", "playbackUsername", "profileId"].some(key => connection[key as keyof RecordingConnection] !== previous.connection[key as keyof RecordingConnection])) throw new RecordingError("Existing jobs belong to this backend and accounts. Keep their identity when replacing credentials.", 409);
            const channels = await backend({ revision: 0, connection, mappings: [] }).verify(req.signal, {
              authorize: () => { administrator(); guard(); },
              load: () => { const row = db.query<{ data: string }, []>("SELECT data FROM recording_qualification WHERE id = 1").get(); return row ? JSON.parse(row.data) as RecordingVerification : null; },
              save: intent => { if (intent) db.query("INSERT OR REPLACE INTO recording_qualification VALUES (1, ?)").run(JSON.stringify(intent)); else db.run("DELETE FROM recording_qualification WHERE id = 1"); },
            });
            administrator(); guard();
            const next = { qualified: true, revision: (previous?.revision ?? 0) + 1, connection, mappings: previous?.mappings ?? [] };
            db.query("INSERT OR REPLACE INTO recording_setup VALUES (1, ?)").run(JSON.stringify(next));
            connectionGeneration.abort(); connectionGeneration = new AbortController(); onConnectionChanged();
            error = null; publish(); return json({ revision: next.revision, channels });
          });
        }
        if (path === "/api/recordings/channels") {
          if (req.method !== "GET") return method("GET");
          administrator(); const channels = await backend().channels(req.signal); administrator(); return json({ channels });
        }
        if (path === "/api/recordings/mappings") {
          if (req.method !== "POST") return method("POST");
          administrator(); const value = await body(req);
          return await serial(async () => {
            administrator(); guard(); const config = configured();
            if (value.revision !== config.revision) throw new RecordingError("Recording mappings changed on another remote. Reload them and try again.", 409);
            if (typeof value.channelId !== "string" || !backendUuid(value.backendChannel)) throw new RecordingError("Select an exact guide and backend channel.");
            const item = channel(value.channelId);
            if (item.sourceId !== value.sourceId || item.tvgId !== value.tvgId) throw new RecordingError("The guide channel identity changed. Select it again.", 409);
            if (!(await backend().channels(req.signal)).some(row => row.uuid === value.backendChannel)) throw new RecordingError("The backend channel is missing, disabled, or has no assigned input.", 409);
            administrator(); guard();
            const current = channel(item.id);
            if (current.sourceId !== item.sourceId || current.tvgId !== item.tvgId) throw new RecordingError("The guide channel changed.", 409);
            const mappings = config.mappings.filter(row => row.channelId !== item.id);
            if (mappings.length >= 256) throw new RecordingError("Keep at most 256 recording channel mappings.", 409);
            mappings.push({ channelId: item.id, sourceId: item.sourceId, tvgId: item.tvgId, backendChannel: value.backendChannel as string });
            db.query("UPDATE recording_setup SET data = ? WHERE id = 1").run(JSON.stringify({ ...config, revision: config.revision + 1, mappings }));
            publish(); return json({ revision: config.revision + 1, mappings });
          });
        }
        if (path === "/api/recordings/schedule") {
          if (req.method !== "POST") return method("POST");
          const value = await body(req);
          return await serial(async () => {
            guard();
            if (typeof value.programId !== "string") throw new RecordingError("Select a programme from the guide.");
            const { program, channel: item } = selection(value.programId);
            if (value.start !== program.start || value.end !== program.end || value.title !== program.title || program.start <= Date.now()) throw new RecordingError("This programme changed or has started. Reload the guide before recording.", 409);
            const previous = jobs().find(job => job.channelId === item.id && job.status !== "cancelled" && (job.programId === program.id || job.start < program.end && job.end > program.start));
            if (previous) return json({ job: publicJob(previous), existing: true });
            const config = configured();
            if (value.revision !== config.revision) throw new RecordingError("Recording setup changed. Reload the guide and retry.", 409);
            const mapping = config.mappings.find(row => row.channelId === item.id && row.sourceId === item.sourceId && row.tvgId === item.tvgId);
            if (!mapping) throw new RecordingError("An administrator must map this exact guide channel before recording.", 409);
            if (!(await backend().verify(req.signal)).some(row => row.uuid === mapping.backendChannel)) throw new RecordingError("The mapped backend channel is unavailable.", 409);
            guard();
            const current = selection(program.id);
            if (JSON.stringify(current) !== JSON.stringify({ channel: item, program })) throw new RecordingError("The guide changed. Select this programme again.", 409);
            if (jobs().length >= 500) throw new RecordingError("This installation has reached its 500 recording job limit.", 409);
            const job: Job = { id: crypto.randomUUID(), programId: program.id, sourceId: item.sourceId, channelId: item.id, tvgId: item.tvgId, channelName: item.name, title: program.title, start: program.start, end: program.end, backendChannel: mapping.backendChannel, backendId: null, eventId: null, backendCause: null, status: "checking", cause: null, revision: 1, cancelRequested: false };
            save(job); publish();
            // The committed marker allows reconciliation; it is not a backend
            // idempotency key. Never replay an ambiguous create automatically.
            try { await backend().schedule(job); } catch { /* Reconcile even if the response was lost. */ }
            await reconcile(); caller(); return json({ job: publicJob(get(job.id)) }, 201);
          });
        }
        const jobPath = /^\/api\/recordings\/([a-f0-9-]{36})\/(cancel|play)$/.exec(path);
        if (jobPath) {
          if (req.method !== "POST") return method("POST");
          if (jobPath[2] === "play") { guard(); const job = get(jobPath[1]!); if (job.status !== "completed") throw new RecordingError("Wait for this recording to complete.", 409); enqueue(publicJob(job), () => { caller(); }); return json({ ok: true }); }
          const value = await body(req);
          return await serial(async () => {
            guard(); await reconcile(); guard(); const job = get(jobPath[1]!);
            if (job.status === "cancelled") return json({ job: publicJob(job) });
            if (value.revision !== job.revision) throw new RecordingError("The recording changed. Review its current state before cancelling.", 409);
            if (job.status !== "pending" || !job.backendId) throw new RecordingError("Only a confirmed pending recording can be cancelled.", 409);
            update(job, { cancelRequested: true }); publish();
            try { await backend().cancel(job.backendId); } catch { /* Absence in a healthy complete listing decides the result. */ }
            await reconcile(); caller(); return json({ job: publicJob(get(job.id)) });
          });
        }
        return json({ error: "Not found." }, 404);
      } catch (reason) {
        return json({ error: reason instanceof RecordingError ? reason.message : "Could not complete the recording request." }, reason instanceof RecordingError ? reason.status : 502);
      }
    },
    async close() {
      if (closed) return;
      closed = true; clearInterval(timer); shutdown.abort(); connectionGeneration.abort();
      await tail; db.close();
    },
  };
}
