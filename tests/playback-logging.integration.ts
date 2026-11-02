import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHelpers } from "../src/server/helpers";
import WebSocket from "ws";
import { createHub } from "../src/server/hub";
import { openStore } from "../src/server/store";
import type { Action, PlaybackCommand, PlayerState, ServerMessage, SessionState } from "../src/shared/protocol";

async function until(predicate: () => boolean) {
  const deadline = Date.now() + 5_000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error("Expected playback state was not published."); await new Promise(resolve => setTimeout(resolve, 10)); }
}

async function fixture(t: TestContext, name = "Test TV") {
  const directory = mkdtempSync(join(tmpdir(), "couch-playback-logging-")), databasePath = join(directory, "couch.sqlite");
  const lines: string[] = [];
  // The audio worker forwards its output through Core's stdout. Observe that
  // public log boundary, including lines split across writes, rather than only
  // calls to the main thread's console object.
  const write = process.stdout.write.bind(process.stdout);
  let partial = "";
  t.mock.method(process.stdout, "write", (chunk: string | Uint8Array, ...args: unknown[]) => {
    const complete = (partial + (typeof chunk === "string" ? chunk : Buffer.from(chunk).toString())).split("\n");
    partial = complete.pop()!;
    lines.push(...complete);
    return Reflect.apply(write, undefined, [chunk, ...args]);
  });
  // Keep unrelated startup origin discovery at the external network boundary.
  const fetch = globalThis.fetch;
  t.mock.method(globalThis, "fetch", (input: RequestInfo | URL, init?: RequestInit) => new URL(input instanceof Request ? input.url : String(input)).hostname === "127.0.0.1"
    ? fetch(input, init) : Promise.resolve(new Response(null, { status: 503 })));
  const store = openStore(databasePath, true), deviceId = "t".repeat(43);
  const token = store.pair(deviceId, name);
  store.close();
  startHelpers(join(directory, "helpers"));
  const hub = await createHub({ databasePath, hostToken: "h".repeat(64), hostname: "127.0.0.1", port: 0 });
  const sockets: WebSocket[] = [];
  const connect = async (deviceId: string, token: string) => {
    const socket = new WebSocket(`${hub.origin.replace("http:", "ws:")}/api/ws?token=${token}&device=${deviceId}`, { headers: { Origin: hub.origin } });
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
    start: async () => {
      assert.equal((await tv.command({ type: "enqueue", entry: { id: "film", title: "Film", source: `${hub.origin}/api/health?token=synthetic-direct-secret` }, playNow: true, deviceId })).ok, true);
      await until(() => tv.commands.some(command => command.type === "load"));
      return tv.commands.find(command => command.type === "load")!.playbackId;
    },
    errors: () => lines.filter(line => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z player error /.test(line)),
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
  const f = await fixture(t, "Test\u2028TV\u2029label"), playbackId = await f.start();
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
