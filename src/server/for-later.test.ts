import { afterEach, expect, mock, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createForLater } from "./for-later";
import { ControllerError } from "./controllers";
import { createSession } from "./session";
import { openStore } from "./store";
import type { ForLaterItem } from "../shared/for-later";
import type { QueueEntry } from "../shared/protocol";

const close: Array<() => void> = [];
afterEach(() => { for (const cleanup of close.splice(0).reverse()) cleanup(); });
const entry: QueueEntry = { id: "movie", source: "library:movie", title: "Evening movie", artworkId: "poster" };
const reference = { kind: "library", id: "movie" };
function fixture(options: Partial<Parameters<typeof createForLater>[0]> = {}) {
  const changed = mock(() => {}), enqueue = mock(() => {});
  const service = createForLater({ databasePath: ":memory:", onChange: changed, lookup: async () => entry, prepare: async () => {}, reservePlay: () => 7, enqueue, ...options });
  close.push(() => service.close());
  return { service, changed, enqueue };
}
function request(service: ReturnType<typeof createForLater>, method = "GET", path = "", body?: unknown, authorize?: () => void) {
  return service.handle(new Request(`http://localhost/api/for-later${path}`, { method, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) }), authorize);
}
async function save(service: ReturnType<typeof createForLater>) {
  const response = await request(service, "POST", "", { reference });
  expect(response.status).toBe(201);
  return (await response.json() as { item: ForLaterItem }).item;
}
const list = async (service: ReturnType<typeof createForLater>) => (await (await request(service)).json() as { items: ForLaterItem[] }).items;

test("drag reordering persists across restarts and rejects malformed or stale orders", async () => {
  const directory = mkdtempSync(join(tmpdir(), "couch-for-later-"));
  close.push(() => rmSync(directory, { recursive: true, force: true }));
  const databasePath = join(directory, "state.sqlite");
  const f = fixture({ databasePath, lookup: async reference => ({ ...entry, id: "id" in reference ? reference.id : "web", source: `library:${"id" in reference ? reference.id : "web"}` }) });
  const ids: string[] = [];
  for (const label of ["first", "second", "third"]) ids.push(((await (await request(f.service, "POST", "", { reference: { kind: "library", id: label } })).json()) as { item: ForLaterItem }).item.id);
  // New saves lead the list, so the saved order is third, second, first.
  expect((await list(f.service)).map(item => item.id)).toEqual([...ids].reverse());
  expect((await request(f.service, "POST", "/reorder", { order: ids })).status).toBe(200);
  expect(f.changed).toHaveBeenCalled();
  expect((await list(f.service)).map(item => item.id)).toEqual(ids);
  f.service.close(); close.pop();
  const restarted = fixture({ databasePath });
  expect((await list(restarted.service)).map(item => item.id)).toEqual(ids);
  expect((await request(restarted.service, "POST", "/reorder", { order: [ids[0], ids[0]] })).status).toBe(400);
  expect((await request(restarted.service, "POST", "/reorder", { order: [ids[0], "gone"] })).status).toBe(400);
  expect((await request(restarted.service, "POST", "/reorder", { order: "first" })).status).toBe(400);
  expect((await request(restarted.service, "GET", "/reorder")).status).toBe(405);
  expect((await list(restarted.service)).map(item => item.id)).toEqual(ids);
});

test("shared saved items survive restart and deduplicate source identity without copying playback credentials", async () => {
  const directory = mkdtempSync(join(tmpdir(), "couch-for-later-"));
  close.push(() => rmSync(directory, { recursive: true, force: true }));
  const databasePath = join(directory, "state.sqlite");
  const first = fixture({ databasePath, lookup: async () => ({ ...entry, source: "web:https://chosen.example/movie", headers: { Authorization: "secret" }, audioSource: "https://resolved.example/secret" } as QueueEntry) });
  const saved = await save(first.service);
  expect(saved).toEqual({ id: expect.any(String), title: entry.title, artworkId: "poster" });
  const duplicate = await request(first.service, "POST", "", { reference: { kind: "queue", id: "another-occurrence" } });
  expect(duplicate.status).toBe(200);
  expect(first.changed).toHaveBeenCalledTimes(1);
  first.service.close(); close.pop();
  const second = fixture({ databasePath });
  expect(await list(second.service)).toEqual([saved]);
  const db = new Database(databasePath);
  const stored = db.query<{ entry: string }, []>("SELECT entry FROM for_later").get()!.entry;
  expect(stored).toContain("web:https://chosen.example/movie");
  expect(stored).not.toMatch(/headers|Authorization|secret|resolved.example/);
  expect(db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'for_later'").get()!.count).toBe(1);
  db.close();
  expect(second.enqueue).not.toHaveBeenCalled();
});

test("concurrent saves remain one item and removal never changes the queue", async () => {
  const f = fixture();
  const responses = await Promise.all(Array.from({ length: 4 }, () => request(f.service, "POST", "", { reference })));
  expect(responses.map(response => response.status).sort()).toEqual([200, 200, 200, 201]);
  const [saved] = await list(f.service);
  expect((await request(f.service, "DELETE", `/${saved!.id}`)).status).toBe(200);
  expect((await request(f.service, "DELETE", `/${saved!.id}`)).status).toBe(200);
  expect(await list(f.service)).toEqual([]);
  expect(f.changed).toHaveBeenCalledTimes(2);
  expect(f.enqueue).not.toHaveBeenCalled();
});

test("append and play load fresh identities and keep the saved item", async () => {
  const calls: Array<{ entry: QueueEntry; intent?: number }> = [];
  const f = fixture({ enqueue: (entry, intent) => { calls.push({ entry, intent }); } });
  const saved = await save(f.service);
  for (const mode of ["append", "play"]) expect((await request(f.service, "POST", `/${saved.id}/load`, { mode })).status).toBe(200);
  expect(calls.map(call => call.intent)).toEqual([undefined, 7]);
  expect(new Set([saved.id, ...calls.map(call => call.entry.id)]).size).toBe(3);
  expect(calls.every(call => call.entry.source === entry.source)).toBe(true);
  expect(await list(f.service)).toEqual([saved]);
});

test("missing media stays removable and does not append or interrupt playback", async () => {
  const f = fixture({ prepare: async () => { throw new Error("/private/media/missing.mkv secret"); } });
  const saved = await save(f.service);
  const response = await request(f.service, "POST", `/${saved.id}/load`, { mode: "play" });
  expect(response.status).toBe(409);
  expect(await response.text()).not.toMatch(/private|secret/);
  expect(await list(f.service)).toEqual([saved]);
  expect(f.enqueue).not.toHaveBeenCalled();
  expect((await request(f.service, "DELETE", `/${saved.id}`)).status).toBe(200);
});

test("revocation during lookup, source checks or body reading prevents late writes and loads", async () => {
  const deny = () => { throw new ControllerError("Pair again.", 401); };
  let authorize = () => {};
  const lookup = Promise.withResolvers<QueueEntry>(), prepared = Promise.withResolvers<void>();
  const f = fixture({ lookup: () => lookup.promise, prepare: () => prepared.promise });
  const saving = request(f.service, "POST", "", { reference }, () => authorize());
  await Bun.sleep(0); authorize = deny; lookup.resolve(entry);
  expect((await saving).status).toBe(401); expect(await list(f.service)).toEqual([]);
  authorize = () => {};
  const saved = await save(f.service);
  const loading = request(f.service, "POST", `/${saved.id}/load`, { mode: "play" }, () => authorize());
  await Bun.sleep(0); authorize = deny; prepared.resolve();
  expect((await loading).status).toBe(401); expect(f.enqueue).not.toHaveBeenCalled();
  let finish!: () => void;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(JSON.stringify({ reference }))); finish = () => controller.close(); } });
  authorize = () => {};
  const reading = f.service.handle(new Request("http://localhost/api/for-later", { method: "POST", headers: { "Content-Type": "application/json" }, body: stream }), () => authorize());
  authorize = deny; finish(); expect((await reading).status).toBe(401);
  expect(f.changed).toHaveBeenCalledTimes(1);
  for (const method of ["GET", "DELETE"]) expect((await request(f.service, method, method === "DELETE" ? `/${saved.id}` : "", undefined, deny)).status).toBe(401);
});

test("removal on another controller during source lookup prevents the late load", async () => {
  const prepared = Promise.withResolvers<void>();
  const f = fixture({ prepare: () => prepared.promise });
  const saved = await save(f.service);
  const pending = request(f.service, "POST", `/${saved.id}/load`, { mode: "append" });
  await Bun.sleep(0); await request(f.service, "DELETE", `/${saved.id}`); prepared.resolve();
  expect((await pending).status).toBe(404); expect(f.enqueue).not.toHaveBeenCalled();
});

test("forbids arbitrary client sources, unsupported identities and extra command fields", async () => {
  const f = fixture();
  for (const reference of [null, [], {}, { kind: "file", id: "private" }, { kind: "library", id: "../private" }, { kind: "queue", id: "movie", source: "file:///secret" }]) expect((await request(f.service, "POST", "", { reference })).status).toBe(400);
  expect((await request(f.service, "POST", "", { reference, source: "https://injected.example" })).status).toBe(400);
  expect(await list(f.service)).toEqual([]); expect(f.changed).not.toHaveBeenCalled();
});

test("watching profile changes preserve For later, queue and playback, then explicit play resumes under the new profile", async () => {
  const store = openStore(":memory:");
  const sent: unknown[] = [];
  const session = createSession(store, command => sent.push(command), () => {});
  close.push(() => { session.close(); store.close(); });
  session.observe({ playbackId: null, status: "idle", position: 0, duration: null, volume: 80, seekable: false, error: null });
  session.command({ type: "enqueue", entry: { id: "current", title: "Current", source: "https://media.example/current" }, playNow: true });
  const f = fixture({ lookup: async () => ({ ...entry, source: "https://media.example/saved" }), reservePlay: () => session.reservePlay(), enqueue: (entry, intent, authorize) => { session.command({ type: "enqueue", entry }, authorize); if (intent !== undefined) session.playIfCurrent(intent, entry.id, false, authorize); } });
  const before = session.state;
  const saved = await save(f.service);
  const profile = store.createProfile("Guest");
  expect(() => session.selectProfile(profile.id)).toThrow("Stop playback");
  expect(session.state.queue).toEqual(before.queue);
  expect(session.state.currentEntryId).toBe(before.currentEntryId);
  expect(await list(f.service)).toEqual([saved]);
  session.command({ type: "stop" });
  session.observe({ playbackId: null, status: "idle", position: 0, duration: null, volume: 80, seekable: false, error: null });
  session.selectProfile(profile.id);
  expect(session.state.queue).toEqual(before.queue);
  expect(await list(f.service)).toEqual([saved]);
  const count = sent.length;
  expect((await request(f.service, "POST", `/${saved.id}/load`, { mode: "append" })).status).toBe(200);
  expect(session.state.currentEntryId).toBeNull(); expect(sent.length).toBe(count);
  expect((await request(f.service, "POST", `/${saved.id}/load`, { mode: "play" })).status).toBe(200);
  expect(session.state.queue).toHaveLength(3); expect(session.state.queue[0]!.id).toBe("current");
  expect(session.state.currentEntryId).toBe(session.state.queue[1]!.id);
  expect(await list(f.service)).toEqual([saved]);
});

test("a newer Stop cancels delayed saved-item Play and reports the successful append without inviting a retry", async () => {
  const store = openStore(":memory:");
  const sent: unknown[] = [];
  const session = createSession(store, command => sent.push(command), () => {});
  close.push(() => { session.close(); store.close(); });
  session.observe({ playbackId: null, status: "idle", position: 0, duration: null, volume: 80, seekable: false, error: null });
  session.command({ type: "enqueue", entry: { id: "current", title: "Current", source: "https://media.example/current" } });
  const preparing = Promise.withResolvers<void>(), prepared = Promise.withResolvers<void>();
  const f = fixture({
    prepare: async () => { preparing.resolve(); await prepared.promise; },
    reservePlay: () => session.reservePlay(),
    enqueue: (entry, intent, authorize) => { session.command({ type: "enqueue", entry }, authorize); if (intent !== undefined) session.playIfCurrent(intent, entry.id, false, authorize); },
  });
  const saved = await save(f.service);
  const playing = request(f.service, "POST", `/${saved.id}/load`, { mode: "play" });
  await preparing.promise;
  session.command({ type: "stop" });
  const afterStop = [...sent];
  prepared.resolve();
  const response = await playing;
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, notice: "Added to Up next. Playback was canceled by a newer control." });
  expect(session.state.queue.map(item => item.title)).toEqual(["Current", "Evening movie"]);
  expect(session.state.currentEntryId).toBeNull();
  expect(sent).toEqual(afterStop);
  expect(await list(f.service)).toEqual([saved]);
});
