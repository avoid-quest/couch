import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { createHub } from "../src/server/hub";
import { openStore } from "../src/server/store";
import type { Action, PlaybackCommand, PlayerState, ServerMessage, SessionState } from "../src/shared/protocol";

async function until(predicate: () => boolean) {
  const deadline = Date.now() + 5_000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error("Expected playback state was not published."); await new Promise(resolve => setTimeout(resolve, 10)); }
}

async function fixture(t: TestContext, refusedFfmpeg = false, name = "Test TV") {
  const directory = mkdtempSync(join(tmpdir(), "couch-playback-logging-")), databasePath = join(directory, "couch.sqlite");
  const lines: string[] = [];
  t.mock.method(console, "log", (line: string) => lines.push(line));
  // Keep unrelated startup origin discovery at the external network boundary.
  const fetch = globalThis.fetch;
  t.mock.method(globalThis, "fetch", (input: RequestInfo | URL, init?: RequestInit) => new URL(input instanceof Request ? input.url : String(input)).hostname === "127.0.0.1"
    ? fetch(input, init) : Promise.resolve(new Response(null, { status: 503 })));
  if (refusedFfmpeg) {
    // A real executable at the helper boundary: version discovery succeeds,
    // then the exact FFmpeg input argument is refused without producing audio.
    writeFileSync(join(directory, "ffmpeg"), `#!${process.execPath}\nif (process.argv.includes('-version')) console.log('ffmpeg version 9.0.0');\nelse { console.error('Error opening input ' + process.argv[process.argv.indexOf('-i') + 1] + ' (Connection refused)\\u0085\\u009b\\u2028\\u2029'); process.exitCode = 1; }\n`, { mode: 0o755 });
    const path = process.env.PATH;
    process.env.PATH = `${directory}:${path}`;
    t.after(() => { process.env.PATH = path; });
  }
  const store = openStore(databasePath, true), deviceId = "t".repeat(43);
  const token = store.pair(deviceId, name);
  store.close();
  const hub = await createHub({ databasePath, hostToken: "h".repeat(64), hostname: "127.0.0.1", port: 42700 });
  const sockets: WebSocket[] = [];
  const connect = async (deviceId: string, token: string, sharing = "") => {
    const socket = new WebSocket(`${hub.origin.replace("http:", "ws:")}/api/ws?token=${token}&device=${deviceId}${sharing}`, { headers: { Origin: hub.origin } });
    sockets.push(socket);
    const commands: PlaybackCommand[] = [], pending = new Map<string, (message: Extract<ServerMessage, { type: "result" }>) => void>();
    let state: SessionState | undefined, sequence = 0;
    await new Promise<void>((resolve, reject) => {
      socket.once("error", reject);
      socket.onmessage = event => {
        const message = JSON.parse(String(event.data)) as ServerMessage;
        if (message.type === "state") { state = message.state; resolve(); }
        if (message.type === "player") commands.push(message.command);
        if (message.type === "result") { pending.get(message.requestId)?.(message); pending.delete(message.requestId); }
      };
    });
    const command = (action: Action) => new Promise<Extract<ServerMessage, { type: "result" }>>(resolve => {
      const requestId = String(++sequence); pending.set(requestId, resolve); socket.send(JSON.stringify({ type: "command", requestId, action }));
    });
    return { commands, command, get state() { return state!; },
      report: (player: Partial<PlayerState>) => socket.send(JSON.stringify({ type: "player", state: { ...state!.player, buffering: false, duration: 100, seekable: true, speed: 1, ...player } })),
      // A command acknowledged after a report proves Core handled the report first.
      barrier: () => command({ type: "volume", volume: 100 }),
    };
  };
  t.after(async () => { for (const socket of sockets) socket.terminate(); await hub.close(); rmSync(directory, { recursive: true, force: true }); });
  const tv = await connect(deviceId, token);
  return { hub, lines, ...tv,
    get state() { return tv.state; },
    speaker: async () => {
      const store = openStore(databasePath, true), deviceId = "s".repeat(43), token = store.pair(deviceId, "Other speaker");
      store.close();
      await connect(deviceId, token, "&audio=1");
      return deviceId;
    },
    start: async (path = "/api/health") => {
      assert.equal((await tv.command({ type: "enqueue", entry: { id: "film", title: "Film", source: `${hub.origin}${path}?token=synthetic-direct-secret` }, playNow: true, deviceId })).ok, true);
      await until(() => tv.commands.some(command => command.type === "load"));
      return tv.commands.find(command => command.type === "load")!.playbackId;
    },
    errors: () => lines.filter(line => line.includes("player error ")),
  };
}

test("Core logs bounded single-line errors without signed, direct or authenticated URLs", { timeout: 15_000 }, async t => {
  const f = await fixture(t), playbackId = await f.start();
  f.report({ playbackId, status: "error", error: "Input refused\u0085for\u009bdevice\u2028line\u2029paragraph\nhttps://media.example/path?sig=synthetic-signed-secret https://synthetic-user:synthetic-password@auth.example/private http://direct.example/file?key=synthetic-direct-secret " + "x".repeat(400) });
  assert.equal((await f.barrier()).ok, true);
  const errors = f.errors();
  assert.equal(errors.length, 1);
  const line = errors[0]!;
  assert.match(line, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z player error [\da-f-]{8} on Test TV host=127\.0\.0\.1: /);
  assert.deepEqual([...line].filter(char => /[\p{Cc}\u2028\u2029]/u.test(char)).map(char => char.codePointAt(0)), [], "No control or line separator can reach the log");
  assert.match(line, /Input refused for device line paragraph media\.example auth\.example direct\.example/);
  assert.ok(line.length < 420, "Error evidence stays bounded");
  for (const secret of ["https://", "http://", "synthetic-", "sig=", "key=", "/private", "/path", "/file"]) assert.equal(line.includes(secret), false, `Log must omit ${secret}`);
});

test("Core removes complete signed URL tokens including apostrophes and quoted variants", { timeout: 15_000 }, async t => {
  const f = await fixture(t), playbackId = await f.start();
  const urls = ["'", "\t", "\u2028", "\u2029"].map(separator => `https://media.example/movie${separator}/private.m3u8?sig=synthetic-secret`);
  for (const [index, url] of urls.entries()) for (const quoted of [url, `'${url}'`, `"${url}"`]) {
    f.report({ playbackId, status: "error", error: `Input refused case ${index} ${quoted}` });
    await f.barrier();
  }
  assert.equal(f.errors().length, 12);
  for (const line of f.errors()) {
    assert.match(line, /media\.example/);
    for (const secret of ["movie", "private", "sig=", "synthetic-secret", "https://"]) assert.equal(line.includes(secret), false, `Log must omit ${secret}`);
  }
});

test("an accepted device name cannot inject separators into a player error line", { timeout: 15_000 }, async t => {
  const f = await fixture(t, false, "Test\u2028TV\u2029label"), playbackId = await f.start();
  f.report({ playbackId, status: "error", error: "Picture input refused" });
  await f.barrier();
  assert.equal(f.errors().length, 1);
  const line = f.errors()[0]!;
  assert.deepEqual([...line].filter(char => /[\p{Cc}\u2028\u2029]/u.test(char)).map(char => char.codePointAt(0)), []);
  assert.match(line, / on Test TV label host=127\.0\.0\.1: Picture input refused$/);
});

test("the report length bound cannot turn source credentials into a logged hostname", { timeout: 15_000 }, async t => {
  const f = await fixture(t), playbackId = await f.start();
  const username = "synthetic-private-user", url = `https://${username}:synthetic-password@media.example/private?sig=synthetic-query`;
  const prefix = "Decoder input refused: ".padEnd(300 - (`https://${username}`).length - 1, "x") + " ";
  f.report({ playbackId, status: "error", error: prefix + url });
  await f.barrier();
  assert.equal(f.errors().length, 1);
  assert.equal(f.errors()[0]!.includes(username), false);
  assert.equal(f.state.player.error?.includes(username), false);
});

test("a new Synced screen load logs an identical failure once even without an intervening state packet", { timeout: 15_000 }, async t => {
  const f = await fixture(t), playbackId = await f.start(), speakerId = await f.speaker();
  f.report({ playbackId, status: "paused", error: null });
  await f.barrier();
  assert.equal((await f.command({ type: "output", deviceId: speakerId, level: 50 })).ok, true);
  // Sound stays paused in Core. Screen failures do not change the group's transport.
  f.report({ playbackId, status: "error", error: "Picture input refused" });
  await f.barrier();
  assert.equal(f.errors().length, 1);
  for (let index = 0; index < 5; index++) f.report({ playbackId, status: "error", error: "Picture input refused" });
  await f.barrier();
  assert.equal(f.errors().length, 1);
  assert.equal(f.state.player.status, "paused");
  assert.equal((await f.command({ type: "output", deviceId: "t".repeat(43), picture: false })).ok, true);
  assert.equal((await f.command({ type: "output", deviceId: "t".repeat(43), picture: true })).ok, true);
  await until(() => f.commands.filter(command => command.type === "load").length === 2);
  assert.equal(f.commands.filter(command => command.type === "load").at(-1)!.playbackId, playbackId);
  // An immediate failure is a valid first response to the new load; Core must not
  // depend on the renderer first sending a loading/idle packet to reset its evidence.
  for (let index = 0; index < 5; index++) f.report({ playbackId, status: "error", error: "Picture input refused" });
  await f.barrier();
  assert.equal(f.errors().length, 2);
  // A renderer can report an error without a detail string. The group's healthy
  // paused state also has error:null, which does not make this an echoed failure.
  f.report({ playbackId, status: "error", error: null });
  await f.barrier();
  assert.equal(f.errors().length, 3);
});

test("alternating failures and healthy reports keep each error once within the same screen load", { timeout: 15_000 }, async t => {
  const f = await fixture(t), playbackId = await f.start(), speakerId = await f.speaker();
  f.report({ playbackId, status: "paused", error: null });
  await f.barrier();
  assert.equal((await f.command({ type: "output", deviceId: speakerId, level: 50 })).ok, true);
  const loads = f.commands.filter(command => command.type === "load").length;
  for (const error of ["Picture refused", "Audio refused", "Picture refused", null, "Audio refused"]) {
    f.report({ playbackId, status: error ? "error" : "paused", error });
    await f.barrier();
  }
  assert.equal(f.commands.filter(command => command.type === "load").length, loads);
  assert.equal(f.errors().length, 2, "A later different error or healthy packet must not forget an already logged error");
  assert.equal((await f.command({ type: "output", deviceId: "t".repeat(43), picture: false })).ok, true);
  assert.equal((await f.command({ type: "output", deviceId: "t".repeat(43), picture: true })).ok, true);
  await until(() => f.commands.filter(command => command.type === "load").length === loads + 1);
  for (const error of ["Picture refused", "Audio refused", "Picture refused"]) {
    f.report({ playbackId, status: "error", error });
    await f.barrier();
  }
  assert.equal(f.errors().length, 4, "Both errors must be observable again for the new load");
});

test("Try again logs the same error for the new attempt while duplicate packets stay quiet", { timeout: 15_000 }, async t => {
  const f = await fixture(t), first = await f.start();
  f.report({ playbackId: first, status: "error", error: "Connection refused" });
  await f.barrier();
  for (let index = 0; index < 5; index++) f.report({ playbackId: first, status: "error", error: "Connection refused" });
  await f.barrier();
  assert.equal(f.errors().length, 1);
  // PlaybackTransport's Try again action replays the current queue entry.
  assert.equal((await f.command({ type: "play", entryId: "film", fromStart: false })).ok, true);
  await until(() => f.commands.filter(command => command.type === "load").length === 2);
  const next = f.commands.filter(command => command.type === "load").at(-1)!.playbackId;
  assert.notEqual(next, first);
  f.report({ playbackId: next, status: "error", error: "Connection refused" });
  await f.barrier();
  for (let index = 0; index < 5; index++) f.report({ playbackId: next, status: "error", error: "Connection refused" });
  await f.barrier();
  assert.equal(f.errors().length, 2);
});

test("Core logs a refused Sendspin input without any renderer report", { timeout: 15_000 }, async t => {
  const f = await fixture(t, true);
  await f.start("/movie's/private.wav");
  const speakerId = await f.speaker();
  assert.equal((await f.command({ type: "output", deviceId: speakerId, level: 50 })).ok, true);
  await until(() => f.state.player.status === "error");
  assert.equal(f.errors().length, 1, "The FFmpeg failure itself must produce evidence without a reporting tab");
  const line = f.errors()[0]!;
  assert.match(line, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z player error [\da-f-]{8} Synced host=127\.0\.0\.1: .*Connection refused/);
  assert.deepEqual([...line].filter(char => /[\p{Cc}\u2028\u2029]/u.test(char)).map(char => char.codePointAt(0)), []);
  assert.equal(line.includes("synthetic-"), false);
  assert.equal(line.includes("http://"), false);
  assert.equal(line.includes("private.wav"), false);
  // A tab that echoes the group's published error adds no second account of it.
  f.report({ playbackId: f.state.player.playbackId, status: "error", error: f.state.player.error });
  await f.barrier();
  assert.equal(f.errors().length, 1);
  // A screen's independent picture error still has its own evidence.
  f.report({ playbackId: f.state.player.playbackId, status: "error", error: "Picture decoder refused" });
  await f.barrier();
  assert.equal(f.errors().length, 2);
});
