import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ControllerIdentity } from "../shared/controllers";
import type { GuideChannel, GuideProgram } from "../shared/iptv";
import type { Recording, RecordingsPage } from "../shared/recordings";
import { createRecordings } from "./recordings";
import { connectionInput } from "./tvheadend";
import { openStore } from "./store";
import { createSession } from "./session";
import type { PlaybackCommand, PlayerState } from "../shared/protocol";

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const host: ControllerIdentity = { authority: "host", controller: null, claimAvailable: false };
const guest: ControllerIdentity = { ...host, authority: "controller" };
const backendChannel = "a".repeat(32), profileId = "b".repeat(32);
const now = Math.ceil(Date.now() / 1000) * 1000;
const channel: GuideChannel = { id: "c".repeat(64), sourceId: "source", tvgId: "exact tvg id", name: "Generated TV", group: "", hasLogo: false };
const program: GuideProgram = { id: "d".repeat(64), channelId: channel.id, title: "Generated programme", description: "", start: now + 120_000, end: now + 180_000 };

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "couch-recordings-")); cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const databasePath = join(directory, "state.sqlite");
  let selected = { channel, program }, identity: ControllerIdentity | null = host;
  let fail = false, loseCreate = false, loseCancel = false, writeAllowed = false, missingChannel = false, incomplete = false, createCount = 0;
  let blockCreate: Promise<void> | undefined;
  let rows: Record<string, unknown>[] = [];
  const calls: { path: string; account: string; body: URLSearchParams }[] = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    const account = Buffer.from(req.headers.get("Authorization")?.slice(6) ?? "", "base64").toString().split(":")[0]!;
    const path = new URL(req.url).pathname, body = new URLSearchParams(await req.text()); calls.push({ path, account, body });
    if (fail) return new Response("private backend path /recordings/secret", { status: 503 });
    if (path === "/api/access/whoami") return Response.json({ username: account, admin: false, dvr: true });
    if (path === "/api/dvr/entry/class") return Response.json({});
    if (path === "/api/dvr/config/grid") return Response.json({ entries: [{ uuid: profileId }], total: 1 });
    if (path === "/api/channel/grid") return Response.json({ entries: missingChannel ? [] : [{ uuid: backendChannel, name: "Backend channel", enabled: true, services: ["service"] }], total: missingChannel ? 0 : 1 });
    if (path === "/api/dvr/entry/grid") return Response.json({ entries: rows, total: rows.length + Number(incomplete) });
    if (path === "/api/dvr/entry/create") {
      createCount++;
      const conf = JSON.parse(body.get("conf")!);
      rows.push({ uuid: createCount.toString(16).padStart(32, "0"), channel: conf.channel, owner: "recorder", comment: conf.comment, start: conf.start, stop: conf.stop, sched_status: "scheduled", status: "Scheduled", filesize: 0, errorcode: 0 });
      await blockCreate;
      return loseCreate ? new Response("lost", { status: 502 }) : Response.json({ uuid: rows.at(-1)!.uuid });
    }
    if (path === "/api/dvr/entry/cancel") { rows = rows.filter(row => row.uuid !== body.get("uuid")); return loseCancel ? new Response("lost", { status: 502 }) : Response.json({}); }
    if (path === "/api/idnode/save") return new Response("", { status: writeAllowed ? 200 : 403 });
    return new Response("", { status: 404 });
  } });
  cleanup.push(() => server.stop(true));
  const endpoint = `http://127.0.0.1:${server.port}`;
  const input = { endpoint, username: "recorder", password: "private-recorder", playbackUsername: "viewer", playbackPassword: "private-viewer", profileId };
  let broadcasts = 0;
  const make = () => createRecordings({ databasePath, selection: id => { if (id !== selected.program.id) throw new Error("Missing programme"); return selected; }, channel: id => { if (id !== selected.channel.id) throw new Error("Missing channel"); return selected.channel; }, pollMs: 0, onChange: () => { broadcasts++; } });
  let recordings = make(); cleanup.push(() => recordings.close());
  const api = (path = "", method = "GET", body?: unknown, signal?: AbortSignal) => recordings.handle(new Request(`http://localhost/api/recordings${path}`, { method, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal }), () => identity);
  const setup = async () => {
    expect((await api("/setup", "POST", { ...input, revision: 0 })).status).toBe(200);
    expect((await api("/mappings", "POST", { channelId: channel.id, sourceId: channel.sourceId, tvgId: channel.tvgId, backendChannel, revision: 1 })).status).toBe(200);
  };
  const schedule = () => api("/schedule", "POST", { programId: selected.program.id, start: selected.program.start, end: selected.program.end, title: selected.program.title, revision: 2 });
  return { api, setup, schedule, input, databasePath, calls, get recordings() { return recordings; }, get rows() { return rows; }, get createCount() { return createCount; }, get broadcasts() { return broadcasts; },
    set fail(value: boolean) { fail = value; }, set loseCreate(value: boolean) { loseCreate = value; }, set loseCancel(value: boolean) { loseCancel = value; }, set writeAllowed(value: boolean) { writeAllowed = value; }, set missingChannel(value: boolean) { missingChannel = value; }, set incomplete(value: boolean) { incomplete = value; }, set identity(value: ControllerIdentity | null) { identity = value; }, set selected(value: typeof selected) { selected = value; }, set blockCreate(value: Promise<void> | undefined) { blockCreate = value; },
    async reopen() { await recordings.close(); recordings = make(); },
  };
}
const job = async (response: Response) => { expect(response.ok).toBe(true); return (await response.json() as { job: Recording }).job; };

test("administrator setup validates transport, rights and exact source/channel/tvg identity without publishing credentials", async () => {
  const app = fixture(); app.identity = guest;
  expect((await app.api("/setup", "POST", { ...app.input, revision: 0 })).status).toBe(403);
  app.identity = host; await app.setup();
  expect((await app.api("/mappings", "POST", { channelId: channel.id, sourceId: "other", tvgId: channel.tvgId, backendChannel, revision: 2 })).status).toBe(409);
  expect((await app.api("/setup", "POST", { ...app.input, revision: 1 })).status).toBe(409);
  const publicText = await (await app.api()).text();
  for (const secret of [app.input.endpoint, "recorder", "viewer", profileId, backendChannel]) expect(publicText).not.toContain(secret);
  for (const endpoint of ["http://lan.example", "https://user:secret@example.com", "https://example.com/path", "file:///recordings"]) expect(() => connectionInput({ ...app.input, endpoint })).toThrow();
  expect(() => connectionInput({ ...app.input, playbackUsername: "recorder" })).toThrow();
});

test("two controllers and a lost create response reconcile one durable job through title, end and start changes", async () => {
  const app = fixture(); await app.setup(); app.loseCreate = true;
  const [first, duplicate] = await Promise.all([app.schedule().then(job), app.schedule().then(job)]);
  expect(first.id).toBe(duplicate.id); expect(first.status).toBe("pending"); expect(app.createCount).toBe(1);
  app.selected = { channel, program: { ...program, id: "e".repeat(64), title: "Corrected", start: program.start + 1000, end: program.end + 10_000 } };
  expect((await job(await app.schedule())).id).toBe(first.id);
  await app.reopen();
  expect(app.recordings.snapshot().jobs).toEqual([first]);
  await app.recordings.refresh(); expect(app.createCount).toBe(1);
  expect(JSON.stringify(app.recordings.snapshot())).not.toContain(backendChannel);
});

test("invalid mapping is rejected before submission and incomplete listings never confirm cancellation", async () => {
  const app = fixture(); await app.setup(); app.missingChannel = true;
  expect((await app.schedule()).status).toBe(409); expect(app.createCount).toBe(0);
  app.missingChannel = false;
  const pending = await job(await app.schedule()); app.incomplete = true;
  expect((await app.api(`/${pending.id}/cancel`, "POST", { revision: pending.revision })).status).toBe(502);
  expect(app.rows).toHaveLength(1); expect(app.recordings.snapshot().jobs[0]!.status).toBe("pending");
});

test("pending cancel needs verified healthy absence, survives lost response and never replays scheduling", async () => {
  const app = fixture(); await app.setup(); const pending = await job(await app.schedule()); app.loseCancel = true;
  const cancelled = await job(await app.api(`/${pending.id}/cancel`, "POST", { revision: pending.revision }));
  expect(cancelled.status).toBe("cancelled"); expect(app.rows).toHaveLength(0);
  await app.reopen(); await app.recordings.refresh(); expect(app.recordings.snapshot().jobs[0]!.status).toBe("cancelled"); expect(app.createCount).toBe(1);
});

test("reconciliation keeps the first conflict cause when the backend later reports only a missing file", async () => {
  const app = fixture(); await app.setup(); const pending = await job(await app.schedule());
  Object.assign(app.rows[0]!, { sched_status: "recordingError", status: "No free adapter", errorcode: 200 }); await app.recordings.refresh();
  expect(app.recordings.snapshot().jobs[0]).toMatchObject({ id: pending.id, status: "failed", cause: "No free recording input." });
  Object.assign(app.rows[0]!, { sched_status: "completedError", status: "File missing", errorcode: 0 }); await app.recordings.refresh();
  expect(app.recordings.snapshot().jobs[0]!.cause).toBe("No free recording input.");
  app.fail = true; expect((await app.api("/refresh", "POST")).status).toBe(502);
  expect(await (await app.api()).text()).not.toContain("/recordings/secret");
});

test("completed playback uses only the read-only account and refuses writable or stale transports", async () => {
  const app = fixture(); await app.setup(); const pending = await job(await app.schedule());
  Object.assign(app.rows[0]!, { sched_status: "completed", filesize: 188_000, status: "Completed OK" }); await app.recordings.refresh();
  const media = await app.recordings.resolve(pending.id, new AbortController().signal);
  expect(media.source).toContain("/dvrfile/"); expect(Buffer.from(media.headers.Authorization.slice(6), "base64").toString()).toBe("viewer:private-viewer");
  const probe = app.calls.findLast(call => call.path === "/api/idnode/save")!;
  expect(probe.account).toBe("viewer"); expect(JSON.parse(probe.body.get("node")!)).toEqual({ uuid: app.rows[0]!.uuid });
  app.writeAllowed = true;
  await expect(app.recordings.resolve(pending.id, new AbortController().signal)).rejects.toThrow("read-only");
  app.writeAllowed = false; const cancel = new AbortController(); cancel.abort();
  await expect(app.recordings.resolve(pending.id, cancel.signal)).rejects.toThrow();
});

test("durable intent commits before broadcast and an aborted controller response does not resubmit its job", async () => {
  const app = fixture(); await app.setup();
  const gate = Promise.withResolvers<void>(); app.blockCreate = gate.promise;
  const response = new AbortController();
  const pending = app.api("/schedule", "POST", { programId: program.id, start: program.start, end: program.end, title: program.title, revision: 2 }, response.signal);
  while (!app.createCount) await Bun.sleep(1);
  const observer = createRecordings({ databasePath: app.databasePath, selection: () => ({ channel, program }), channel: () => channel, pollMs: 0 });
  expect(observer.snapshot().jobs).toHaveLength(1); expect(observer.snapshot().jobs[0]!.status).toBe("checking");
  expect(app.broadcasts).toBeGreaterThanOrEqual(3);
  await observer.close(); response.abort(); gate.resolve(); await pending;
  expect(app.createCount).toBe(1);
});

test("recording queue restart stays stopped and native progress belongs to the active Couch profile", () => {
  const directory = mkdtempSync(join(tmpdir(), "couch-recording-progress-")); cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "state.sqlite");
  const store = openStore(path);
  const commands: PlaybackCommand[] = [];
  const session = createSession(store, command => commands.push(command), () => {});
  const idle: PlayerState = { playbackId: null, status: "idle", position: 0, duration: null, volume: 80, seekable: false, error: null };
  session.observe(idle);
  const entry = { id: "entry", title: "Recording", source: `recording:${crypto.randomUUID()}` };
  session.command({ type: "enqueue", entry, playNow: true });
  const playbackId = session.state.player.playbackId!;
  session.observe({ ...idle, playbackId, status: "playing", position: 20, duration: 120, seekable: true });
  session.command({ type: "stop" });
  expect(store.progress("household", entry.source)?.position).toBe(20);
  const other = store.createProfile("Other"); expect(store.progress(other.id, entry.source)).toBeNull();
  session.close(); store.close();
  const reopened = openStore(path); cleanup.push(() => reopened.close());
  const restarted = createSession(reopened, () => {}, () => {});
  expect(restarted.state.queue).toEqual([entry]);
  expect(reopened.progress("household", entry.source)?.position).toBe(20);
  expect(restarted.state.currentEntryId).toBeNull(); expect(restarted.state.player.playbackId).toBeNull();
  restarted.close();
});
