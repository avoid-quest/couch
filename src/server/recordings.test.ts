import { afterEach, expect, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ControllerIdentity } from "../shared/controllers";
import type { GuideChannel, GuideProgram } from "../shared/iptv";
import type { Recording, RecordingsPage } from "../shared/recordings";
import { createRecordings } from "./recordings";
import { connectionInput } from "./tvheadend";
import { GuideError } from "./iptv-feeds";
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
  let admitted = true;
  let blockJobs: Promise<void> | undefined, holdCreateResponse: Promise<void> | undefined;
  let blockCreate: Promise<void> | undefined;
  let blockChannels: Promise<void> | undefined;
  let backendTimeOffset = 0;
  let missingGuide = false;
  let changeAfterWriteCheck = false;
  let hideViewer = false, hideFailedRecorder = false, hideFailedViewer = false, keepCancel = false, loseProbeCreate = false, missingProbeCreate = false, probeCount = 0;
  let rows: Record<string, unknown>[] = [];
  const calls: { path: string; account: string; body: URLSearchParams }[] = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    const account = Buffer.from(req.headers.get("Authorization")?.slice(6) ?? "", "base64").toString().split(":")[0]!;
    const path = new URL(req.url).pathname, body = new URLSearchParams(await req.text()); calls.push({ path, account, body });
    if (fail) return new Response("private backend path /recordings/secret", { status: 503 });
    if (path === "/api/access/whoami") return Response.json({ username: account, admin: false, dvr: true, time: Math.floor(Date.now() / 1000) + backendTimeOffset });
    if (path === "/api/dvr/entry/class") return Response.json({});
    if (path === "/api/dvr/config/grid") return Response.json({ entries: [{ uuid: profileId }], total: 1 });
    if (path === "/api/channel/grid") { await blockChannels; return Response.json({ entries: missingChannel ? [] : [{ uuid: backendChannel, name: "Backend channel", enabled: true, services: ["service"] }], total: missingChannel ? 0 : 1 }); }
    if (path === "/api/dvr/entry/grid" || path === "/api/dvr/entry/grid_failed") {
      await blockJobs;
      const filter = JSON.parse(body.get("filter") ?? "[]")[0];
      const matching = rows.filter(row => (!filter || new RegExp(filter.value, "i").test(String(row.owner))) && (path.endsWith("grid") || row.sched_status === "completedError"));
      const entries = matching.filter(row => !(account === "viewer" && hideViewer) && !(row.sched_status === "completedError" && (account === "viewer" ? hideFailedViewer : hideFailedRecorder)));
      return Response.json({ entries, total: matching.length + Number(incomplete) });
    }
    if (path === "/api/dvr/entry/create") {
      const conf = JSON.parse(body.get("conf")!);
      if (conf.enabled === false) probeCount++; else createCount++;
      if (conf.enabled === false && missingProbeCreate) return new Response("lost", { status: 502 });
      rows.push({ uuid: (createCount + probeCount).toString(16).padStart(32, "0"), enabled: conf.enabled, channel: conf.channel, owner: account, comment: conf.comment, start: conf.start, stop: conf.stop, start_extra: conf.start_extra, stop_extra: conf.stop_extra, sched_status: conf.enabled === false ? "completedError" : "scheduled", status: "Scheduled", filesize: 0, errorcode: 0 });
      await blockCreate;
      return loseCreate || conf.enabled === false && loseProbeCreate ? new Response("lost", { status: 502 }) : Response.json({ uuid: rows.at(-1)!.uuid });
    }
    if (path === "/api/dvr/entry/cancel" || path === "/api/idnode/delete") { if (!keepCancel) rows = rows.filter(row => row.uuid !== body.get("uuid")); return loseCancel ? new Response("lost", { status: 502 }) : Response.json({}); }
    if (path === "/api/idnode/save") { if (changeAfterWriteCheck) rows[0]!.filename = "/changed-after-permission-check.ts"; return new Response("", { status: writeAllowed ? 200 : 403 }); }
    return new Response("", { status: 404 });
  } });
  cleanup.push(() => server.stop(true));
  const endpoint = `http://127.0.0.1:${server.port}`;
  const input = { endpoint, username: "recorder", password: "private-recorder", playbackUsername: "viewer", playbackPassword: "private-viewer", profileId };
  let broadcasts = 0, createResponseHeld = false;
  const request = Object.assign(async (...args: Parameters<typeof fetch>) => {
    const response = await fetch(...args);
    if (String(args[0]).endsWith("/api/dvr/entry/create") && holdCreateResponse) {
      createResponseHeld = true;
      await holdCreateResponse;
    }
    return response;
  }, { preconnect: fetch.preconnect });
  const make = () => createRecordings({ databasePath, selection: id => { if (missingGuide || id !== selected.program.id) throw new GuideError("This programme is no longer in the guide. Refresh the guide.", 404); return selected; }, channel: id => { if (missingGuide || id !== selected.channel.id) throw new GuideError("This channel is no longer in the guide. Refresh the guide.", 404); return selected.channel; }, admitted: () => admitted, pollMs: 0, fetch: request, onChange: () => { broadcasts++; } });
  let recordings = make(); cleanup.push(() => recordings.close());
  const api = (path = "", method = "GET", body?: unknown, signal?: AbortSignal) => recordings.handle(new Request(`http://localhost/api/recordings${path}`, { method, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal }), () => identity);
  const setup = async () => {
    expect((await api("/setup", "POST", { ...input, revision: 0 })).status).toBe(200);
    expect((await api("/mappings", "POST", { channelId: channel.id, sourceId: channel.sourceId, tvgId: channel.tvgId, backendChannel, revision: 1 })).status).toBe(200);
  };
  const schedule = () => api("/schedule", "POST", { programId: selected.program.id, start: selected.program.start, end: selected.program.end, title: selected.program.title, revision: 2 });
  return { api, setup, schedule, input, databasePath, calls, get recordings() { return recordings; }, get rows() { return rows; }, get createCount() { return createCount; }, get broadcasts() { return broadcasts; },
    set admitted(value: boolean) { admitted = value; },
    set blockJobs(value: Promise<void> | undefined) { blockJobs = value; },
    get createResponseHeld() { return createResponseHeld; },
    set holdCreateResponse(value: Promise<void> | undefined) { holdCreateResponse = value; createResponseHeld = false; },
    set backendTimeOffset(value: number) { backendTimeOffset = value; },
    set missingGuide(value: boolean) { missingGuide = value; },
    set changeAfterWriteCheck(value: boolean) { changeAfterWriteCheck = value; },
    get probeCount() { return probeCount; }, set blockChannels(value: Promise<void> | undefined) { blockChannels = value; }, set hideViewer(value: boolean) { hideViewer = value; }, set hideFailedRecorder(value: boolean) { hideFailedRecorder = value; }, set hideFailedViewer(value: boolean) { hideFailedViewer = value; }, set keepCancel(value: boolean) { keepCancel = value; }, set loseProbeCreate(value: boolean) { loseProbeCreate = value; }, set missingProbeCreate(value: boolean) { missingProbeCreate = value; },
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
  expect(media.source).toContain("/dvrfile/"); expect(Buffer.from(media.headers!.Authorization.slice(6), "base64").toString()).toBe("viewer:private-viewer");
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


test("empty-library setup rejects playback without view-all or with manage-all rights and removes its disabled check", async () => {
  for (const writable of [false, true]) {
    const app = fixture(); app.hideViewer = !writable; app.writeAllowed = writable;
    const response = await app.api("/setup", "POST", { ...app.input, revision: 0 });
    expect(response.status).toBe(409); expect((await response.json()).error).toContain(writable ? "read-only" : "View all");
    expect(app.recordings.snapshot().configured).toBe(false); expect(app.rows).toHaveLength(0); expect(app.probeCount).toBe(1);
    const conf = JSON.parse(app.calls.find(call => call.path === "/api/dvr/entry/create")!.body.get("conf")!);
    expect(conf.enabled).toBe(false); expect(conf.stop + conf.stop_extra * 60).toBeLessThan(Date.now() / 1000); expect(conf.start_extra).toBe(1); expect(conf.stop_extra).toBe(1); expect(conf.stop - conf.start).toBe(60);
    expect((await app.schedule()).status).toBe(409); expect(app.createCount).toBe(0);
  }
});

test("setup reconciles a lost disabled-create response and does not add permission jobs per programme", async () => {
  const app = fixture(); app.loseProbeCreate = true; await app.setup();
  expect(app.probeCount).toBe(1); expect(app.rows).toHaveLength(0);
  await app.schedule(); await app.schedule();
  expect(app.probeCount).toBe(1); expect(app.createCount).toBe(1);
});

test("a never-confirmed disabled permission check survives restart without another create", async () => {
  const app = fixture(); app.missingProbeCreate = true;
  expect((await app.api("/setup", "POST", { ...app.input, revision: 0 })).status).toBe(409);
  await app.reopen(); app.missingProbeCreate = false;
  const retry = await app.api("/setup", "POST", { ...app.input, revision: 0 });
  expect(retry.status).toBe(409); expect((await retry.json()).error).toContain("not confirmed");
  expect(app.probeCount).toBe(1); expect(app.recordings.snapshot().configured).toBe(false); expect(app.rows).toHaveLength(0);
});

test("setup remains blocked until disabled-entry cleanup is confirmed after restart", async () => {
  const app = fixture(); app.keepCancel = true;
  expect((await app.api("/setup", "POST", { ...app.input, revision: 0 })).status).toBe(409);
  expect(app.recordings.snapshot().configured).toBe(false); expect(app.rows).toHaveLength(1); expect(app.rows[0]!.enabled).toBe(false);
  const id = String(app.rows[0]!.uuid);
  await app.reopen(); app.keepCancel = false; app.loseCancel = true;
  expect((await app.api("/setup", "POST", { ...app.input, revision: 0 })).status).toBe(200);
  expect(app.probeCount).toBe(1); expect(app.rows).toHaveLength(0); expect(app.recordings.snapshot().configured).toBe(true);
  expect(app.calls.filter(call => call.path === "/api/idnode/delete").map(call => call.body.get("uuid"))).toEqual([id, id]);
});


test("a setup saved before permission qualification cannot schedule until verified again", async () => {
  const app = fixture(); await app.setup();
  const database = new Database(app.databasePath);
  const row = database.query<{ data: string }, []>("SELECT data FROM recording_setup WHERE id = 1").get()!;
  const legacy = JSON.parse(row.data); delete legacy.qualificationVersion; legacy.qualified = true;
  database.query("UPDATE recording_setup SET data = ? WHERE id = 1").run(JSON.stringify(legacy)); database.close();
  await app.reopen();
  expect(app.recordings.snapshot().configured).toBe(false);
  expect((await app.schedule()).status).toBe(409); expect(app.createCount).toBe(0);
  expect((await app.api("/setup", "POST", { ...app.input, revision: 2 })).status).toBe(200);
  expect(app.recordings.snapshot().configured).toBe(true);
});

test("incomplete cleanup keeps the disabled verification intent and cannot commit setup", async () => {
  const app = fixture(); app.keepCancel = true;
  expect((await app.api("/setup", "POST", { ...app.input, revision: 0 })).status).toBe(409);
  app.incomplete = true;
  expect((await app.api("/setup", "POST", { ...app.input, revision: 0 })).status).toBe(502);
  expect(app.recordings.snapshot().configured).toBe(false); expect(app.rows[0]!.enabled).toBe(false); expect(app.probeCount).toBe(1);
  app.incomplete = false; app.keepCancel = false;
  expect((await app.api("/setup", "POST", { ...app.input, revision: 0 })).status).toBe(200); expect(app.probeCount).toBe(1);
});


test("revocation at the last setup prerequisite prevents creating a permission-check intent", async () => {
  for (const revoked of [guest, null]) {
    const app = fixture(), gate = Promise.withResolvers<void>(); app.blockChannels = gate.promise;
    const pending = app.api("/setup", "POST", { ...app.input, revision: 0 });
    try {
      for (let i = 0; i < 100 && !app.calls.some(call => call.path === "/api/channel/grid"); i++) await Bun.sleep(1);
      expect(app.calls.some(call => call.path === "/api/channel/grid")).toBe(true);
      app.identity = revoked;
    } finally { gate.resolve(); }
    expect((await pending).status).toBe(revoked ? 403 : 401);
    expect(app.probeCount).toBe(0); expect(app.recordings.snapshot().configured).toBe(false);
    const database = new Database(app.databasePath);
    expect(database.query("SELECT * FROM recording_qualification").all()).toHaveLength(0); database.close();
  }
});


test("a programme that starts during backend verification is rejected before durable submission", async () => {
  const app = fixture(); await app.setup();
  const gate = Promise.withResolvers<void>(); app.blockChannels = gate.promise;
  const before = app.calls.length, pending = app.schedule();
  for (let i = 0; i < 100 && !app.calls.slice(before).some(call => call.path === "/api/channel/grid"); i++) await Bun.sleep(1);
  expect(app.calls.slice(before).some(call => call.path === "/api/channel/grid")).toBe(true);
  const clock = spyOn(Date, "now").mockReturnValue(program.start + 1);
  try {
    gate.resolve(); const response = await pending;
    expect(response.status).toBe(409); expect((await response.json()).error).toContain("started while checking");
    expect(app.createCount).toBe(0); expect(app.recordings.snapshot().jobs).toHaveLength(0);
  } finally { gate.resolve(); clock.mockRestore(); }
});

test("failed-view is qualified independently for both accounts, with durable cleanup after permission repair", async () => {
  for (const recorder of [false, true]) {
    const app = fixture(); app.hideFailedRecorder = recorder; app.hideFailedViewer = !recorder;
    const response = await app.api("/setup", "POST", { ...app.input, revision: 0 });
    expect(response.status).toBe(recorder ? 502 : 409); expect((await response.json()).error).toContain("Failed view");
    expect(app.recordings.snapshot().configured).toBe(false); expect(app.recordings.snapshot().jobs).toHaveLength(0); expect(app.createCount).toBe(0);
    expect(app.probeCount).toBe(1);
    if (recorder) {
      expect(app.rows).toHaveLength(1); expect(app.rows[0]).toMatchObject({ enabled: false, sched_status: "completedError", filesize: 0 });
      const uuid = String(app.rows[0]!.uuid);
      expect(app.calls.some(call => call.path === "/api/idnode/delete")).toBe(false);
      await app.reopen();
      expect((await app.api("/setup", "POST", { ...app.input, revision: 0 })).status).toBe(502); expect(app.probeCount).toBe(1);
      app.hideFailedRecorder = false;
      expect((await app.api("/setup", "POST", { ...app.input, revision: 0 })).status).toBe(200);
      expect(app.calls.filter(call => call.path === "/api/idnode/delete").map(call => call.body.get("uuid"))).toEqual([uuid]);
      expect(app.probeCount).toBe(1);
    }
    expect(app.rows).toHaveLength(0);
  }
});

test("owner-scoped totals exclude unrelated recordings and treat regex characters in usernames literally", async () => {
  const app = fixture(); app.input.username = "recorder.[a]+(b)?^$|{2}\\end";
  const foreign = { uuid: "9".repeat(32), owner: "other", channel: backendChannel, start: now / 1000, stop: now / 1000 + 60, sched_status: "scheduled" };
  app.rows.push(foreign, { ...foreign, uuid: "8".repeat(32), sched_status: "completedError" });
  await app.setup(); const pending = await job(await app.schedule());
  expect(app.recordings.snapshot().jobs).toHaveLength(1); expect(pending.status).toBe("pending");
  expect(app.rows.filter(row => row.owner === "other")).toHaveLength(2);
  const filters = app.calls.filter(call => call.path.startsWith("/api/dvr/entry/grid")).map(call => JSON.parse(call.body.get("filter")!)[0]);
  expect(filters.length).toBeGreaterThan(0);
  for (const filter of filters) {
    expect(filter.field).toBe("owner"); expect(new RegExp(filter.value, "i").test(app.input.username)).toBe(true);
    expect(new RegExp(filter.value, "i").test(`prefix${app.input.username}`)).toBe(false);
    expect(new RegExp(filter.value, "i").test(`${app.input.username}suffix`)).toBe(false);
    expect(new RegExp(filter.value, "i").test("other")).toBe(false);
  }
  const cancelled = await job(await app.api(`/${pending.id}/cancel`, "POST", { revision: pending.revision }));
  expect(cancelled.status).toBe("cancelled"); expect(app.rows).toHaveLength(2);
});

test("case-colliding owners fail closed before setup creates a permission entry", async () => {
  const app = fixture(); app.rows.push({ uuid: "9".repeat(32), owner: "RECORDER", sched_status: "scheduled" });
  const response = await app.api("/setup", "POST", { ...app.input, revision: 0 });
  expect(response.status).toBe(502); expect((await response.json()).error).toContain("letter case");
  expect(app.probeCount).toBe(0); expect(app.recordings.snapshot().configured).toBe(false); expect(app.rows).toHaveLength(1);
});

test("legacy future intents finish exact cleanup before a newly admitted failed check can qualify setup", async () => {
  for (const phase of ["submitted", "cleanup"]) {
    const app = fixture(), uuid = "9".repeat(32), id = crypto.randomUUID(), start = Math.floor(Date.now() / 1000) + 86400;
    const connection = JSON.stringify([app.input.endpoint, app.input.username, app.input.playbackUsername, profileId]);
    const database = new Database(app.databasePath);
    database.query("INSERT INTO recording_qualification VALUES (1, ?)").run(JSON.stringify({ connection, id, channel: backendChannel, start, stop: start + 60, phase, failure: null })); database.close();
    app.rows.push({ uuid, owner: app.input.username, channel: backendChannel, comment: `Couch:permission:${id}`, start, stop: start + 60, enabled: false, filesize: 0, sched_status: "scheduled" });
    const response = await app.api("/setup", "POST", { ...app.input, revision: 0 });
    expect(response.status).toBe(200); expect(app.probeCount).toBe(1); expect(app.rows).toHaveLength(0);
    const deletes = app.calls.filter(call => call.path === "/api/idnode/delete");
    expect(deletes).toHaveLength(2); expect(deletes[0]!.body.get("uuid")).toBe(uuid); expect(deletes[1]!.body.get("uuid")).not.toBe(uuid);
    expect(app.calls.filter(call => call.path === "/api/dvr/entry/grid_failed")).toHaveLength(2);
    expect(app.recordings.snapshot().configured).toBe(true);
  }
});

test("invalid backend clock and a changed disabled probe cannot qualify setup or delete an unverified entry", async () => {
  const app = fixture(); app.backendTimeOffset = 120;
  expect((await app.api("/setup", "POST", { ...app.input, revision: 0 })).status).toBe(409); expect(app.probeCount).toBe(0);
  app.backendTimeOffset = 0;
  const gate = Promise.withResolvers<void>(); app.blockCreate = gate.promise;
  const pending = app.api("/setup", "POST", { ...app.input, revision: 0 });
  try {
    for (let i = 0; i < 100 && !app.probeCount; i++) await Bun.sleep(1);
    expect(app.rows).toHaveLength(1); expect(app.rows[0]!.enabled).toBe(false);
    app.rows[0]!.filename = "/unexpected/media.ts";
  } finally { gate.resolve(); }
  expect((await pending).status).toBe(409); expect(app.calls.some(call => call.path === "/api/idnode/delete")).toBe(false);
  expect(app.recordings.snapshot().configured).toBe(false); expect(app.createCount).toBe(0);
});

test("permission-check deletion revalidates the entry after asynchronous rights checks", async () => {
  const app = fixture(); app.changeAfterWriteCheck = true;
  expect((await app.api("/setup", "POST", { ...app.input, revision: 0 })).status).toBe(409);
  expect(app.calls.some(call => call.path === "/api/idnode/save")).toBe(true);
  expect(app.calls.some(call => call.path === "/api/idnode/delete")).toBe(false);
  expect(app.rows).toHaveLength(1); expect(app.rows[0]!.filename).toBe("/changed-after-permission-check.ts");
  expect(app.recordings.snapshot().configured).toBe(false); expect(app.createCount).toBe(0);
});

test("removed guide selections preserve their safe 404 for scheduling and mapping", async () => {
  const app = fixture(); await app.setup(); app.missingGuide = true;
  const before = app.calls.length;
  for (const response of [await app.schedule(), await app.api("/mappings", "POST", { channelId: channel.id, sourceId: channel.sourceId, tvgId: channel.tvgId, backendChannel, revision: 2 })]) {
    expect(response.status).toBe(404); expect((await response.json()).error).toContain("Refresh the guide");
  }
  expect(app.calls).toHaveLength(before); expect(app.createCount).toBe(0);
});

test("duplicate reconciliation warnings clear after recovery while the original backend failure survives", async () => {
  const app = fixture(); await app.setup();
  const gate = Promise.withResolvers<void>(); app.blockCreate = gate.promise;
  const pending = app.schedule();
  try {
    for (let i = 0; i < 100 && !app.createCount; i++) await Bun.sleep(1);
    expect(app.rows).toHaveLength(1);
    app.rows.push({ ...app.rows[0], uuid: "9".repeat(32) });
  } finally { gate.resolve(); }
  const uncertain = await job(await pending);
  expect(uncertain.status).toBe("checking"); expect(uncertain.cause).toContain("duplicate");
  app.rows.pop(); await app.recordings.refresh();
  expect(app.recordings.snapshot().jobs[0]).toMatchObject({ status: "pending", cause: null });
  Object.assign(app.rows[0]!, { sched_status: "recordingError", status: "No free adapter", errorcode: 200 });
  await app.recordings.refresh();
  app.rows.push({ ...app.rows[0] }); await app.recordings.refresh();
  expect(app.recordings.snapshot().jobs[0]!.cause).toContain("duplicate");
  app.rows.pop(); Object.assign(app.rows[0]!, { sched_status: "completedError", status: "File missing", errorcode: 0 });
  await app.recordings.refresh();
  expect(app.recordings.snapshot().jobs[0]!.cause).toBe("No free recording input.");
});

test("a restored cancelled entry clears its review warning after normal reconciliation", async () => {
  const app = fixture(); await app.setup(); const pending = await job(await app.schedule());
  const row = { ...app.rows[0]! };
  await job(await app.api(`/${pending.id}/cancel`, "POST", { revision: pending.revision }));
  app.rows.push(row); await app.recordings.refresh();
  expect(app.recordings.snapshot().jobs[0]!.cause).toContain("restored");
  await app.recordings.refresh();
  expect(app.recordings.snapshot().jobs[0]).toMatchObject({ status: "pending", cause: null });
});

test.each([
  [200, "Waiting for stream", "No free recording input."],
  [200, "Adaptateur indisponible", "No free recording input."],
  [402, "No input detected", "No recording input was detected."],
])("backend error code %s preserves its cause independently of display status %s", async (errorcode, status, cause) => {
  const app = fixture(); await app.setup(); const pending = await job(await app.schedule());
  Object.assign(app.rows[0]!, { sched_status: "recordingError", status, errorcode }); await app.recordings.refresh();
  expect(app.recordings.snapshot().jobs[0]).toMatchObject({ id: pending.id, status: "failed", cause });
  Object.assign(app.rows[0]!, { sched_status: "completedError", status: "File missing", errorcode: 0 }); await app.reopen(); await app.recordings.refresh();
  expect(app.recordings.snapshot().jobs[0]).toMatchObject({ id: pending.id, status: "failed", cause });
});


async function until(check: () => boolean) {
  const deadline = Date.now() + 1000;
  while (!check()) { expect(Date.now()).toBeLessThan(deadline); await Bun.sleep(1); }
}

test.each(["setup", "schedule"])("maintenance fences the last %s prerequisite before durable intent", async operation => {
  const app = fixture();
  if (operation === "schedule") await app.setup();
  const gate = Promise.withResolvers<void>(), before = app.calls.length;
  app.blockChannels = gate.promise;
  const pending = operation === "setup" ? app.api("/setup", "POST", { ...app.input, revision: 0 }) : app.schedule();
  try {
    await until(() => app.calls.slice(before).some(call => call.path === "/api/channel/grid"));
    app.admitted = false;
  } finally { gate.resolve(); }
  const response = await pending;
  expect(response.status).toBe(503);
  expect((await response.json()).error).toContain("preparing an update");
  expect(app.createCount).toBe(0);
  expect(app.recordings.snapshot().jobs).toEqual([]);
  const database = new Database(app.databasePath);
  try { expect(database.query("SELECT * FROM recording_qualification").all()).toEqual([]); }
  finally { database.close(); }
});

test("closed maintenance admission skips polling and rejects explicit refresh before backend work", async () => {
  const app = fixture(); await app.setup(); await app.schedule();
  app.admitted = false;
  await app.reopen();
  const calls = app.calls.length, broadcasts = app.broadcasts, snapshot = app.recordings.snapshot();
  let open = false, changes = 0;
  const polling = createRecordings({ databasePath: app.databasePath, selection: () => ({ channel, program }), channel: () => channel, admitted: () => open, pollMs: 5, onChange: () => changes++ });
  try {
    await Bun.sleep(25);
    expect(app.calls.length).toBe(calls);
    expect(changes).toBe(0);
    expect((await app.api("/refresh", "POST")).status).toBe(503);
    await expect(app.recordings.refresh()).rejects.toThrow("preparing an update");
    expect(app.calls.length).toBe(calls);
    expect(app.recordings.snapshot()).toEqual(snapshot);
    expect(app.broadcasts).toBe(broadcasts);
    open = true;
    await until(() => changes > 0);
    expect(app.calls.length).toBeGreaterThan(calls);
  } finally { await polling.close(); }
});

test("reconciliation released after admission closes cannot revise jobs or publish", async () => {
  const app = fixture(); await app.setup(); await app.schedule();
  Object.assign(app.rows[0]!, { sched_status: "completed", filesize: 188_000 });
  const snapshot = app.recordings.snapshot(), broadcasts = app.broadcasts, calls = app.calls.length;
  const gate = Promise.withResolvers<void>(); app.blockJobs = gate.promise;
  const pending = app.api("/refresh", "POST");
  try {
    await until(() => app.calls.slice(calls).some(call => call.path === "/api/dvr/entry/grid"));
    app.admitted = false;
  } finally { gate.resolve(); }
  expect((await pending).status).toBe(503);
  expect(app.recordings.snapshot()).toEqual(snapshot);
  expect(app.broadcasts).toBe(broadcasts);
  const database = new Database(app.databasePath);
  try { expect(JSON.parse(database.query<{ data: string }, []>("SELECT data FROM recording_jobs").get()!.data)).toMatchObject(snapshot.jobs[0]!); }
  finally { database.close(); }
});

test("shutdown drains an admitted create and restart reconciles its UUID without another create", async () => {
  const app = fixture(); await app.setup();
  const gate = Promise.withResolvers<void>(); app.holdCreateResponse = gate.promise;
  const pending = app.schedule();
  await until(() => app.createResponseHeld);
  expect(app.createCount).toBe(1);
  const snapshot = app.recordings.snapshot(), broadcasts = app.broadcasts;
  app.admitted = false;
  let finished = false;
  const closing = app.recordings.close().then(() => { finished = true; });
  try {
    await Bun.sleep(0);
    expect(finished).toBe(false);
  } finally { gate.resolve(); }
  expect((await pending).status).toBe(503);
  await closing;
  expect(app.broadcasts).toBe(broadcasts);
  app.admitted = true; await app.reopen();
  expect(app.recordings.snapshot().jobs).toEqual(snapshot.jobs);
  await app.recordings.refresh();
  expect(app.recordings.snapshot().jobs[0]).toMatchObject({ id: snapshot.jobs[0]!.id, status: "pending" });
  expect(app.createCount).toBe(1);
});
