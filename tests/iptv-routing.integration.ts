import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type ServerResponse } from "node:http";
import WebSocket from "ws";
import { createHub } from "../src/server/hub";
import { openStore } from "../src/server/store";
import type { Action, ServerMessage, SessionState } from "../src/shared/protocol";

async function until(predicate: () => boolean) {
  const deadline = Date.now() + 3_000;
  while (!predicate()) { assert.ok(Date.now() < deadline, "Expected routing result."); await new Promise(resolve => setTimeout(resolve, 5)); }
}

const master = (...codecs: string[]) => ["#EXTM3U", ...codecs.flatMap((list, index) => [`#EXT-X-STREAM-INF:BANDWIDTH=${index + 1}000000,CODECS="${list}"`, `${index}.m3u8`])].join("\n");

async function fixture(raw = false) {
  const directory = mkdtempSync(join(process.env.COUCH_DATA_DIR ?? tmpdir(), "iptv-routing-"));
  const databasePath = join(directory, "couch.sqlite"), remoteId = "r".repeat(43), hostId = "t".repeat(43), hostToken = "h".repeat(64);
  const store = openStore(databasePath, true), token = store.pair(remoteId, "Remote fixture");
  const targetId = "d".repeat(43), targetToken = store.pair(targetId, "Target fixture"); store.close();
  const playlists: Record<string, string> = {
    HEVC: master("hvc1.1.6.L93.B0,mp4a.40.2"), H264: master("avc1.42c01e,mp4a.40.2"),
    Alternative: master("hvc1.1.6.L93.B0,mp4a.40.2", "avc1.42c01e,mp4a.40.2"),
    MPEG2: master("mp4v.61,mp4a.40.2"), AC3: master("avc1.42c01e,ac-3"), EAC3: master("avc1.42c01e,ec-3"),
    HEVC_AC3: master("hvc1.1.6.L93.B0,ac-3"),
  };
  const binary = join(directory, "bin"), nativeLog = join(directory, "mpv.jsonl"), readyLog = join(directory, "mpv-ready"), originalPath = process.env.PATH;
  mkdirSync(binary);
  // Model only the external mpv executable/IPC boundary. No video/audio device is opened.
  writeFileSync(join(binary, "mpv"), `#!${process.execPath}\n${[
    'const { appendFileSync, rmSync } = require("node:fs"), { createServer } = require("node:net");',
    'if (process.argv.includes("--version")) { console.log("mpv 0.40.0"); process.exit(); }',
    `appendFileSync(${JSON.stringify(nativeLog)}, JSON.stringify({ pid: process.pid, source: process.argv.at(-1) }) + "\\n");`,
    'const ipc = process.argv.find(arg => arg.startsWith("--input-ipc-server=")).split("=")[1]; rmSync(ipc, {force:true});',
    `const server = createServer(socket => { let commands = 0, ready = false; socket.on("data", bytes => { commands += String(bytes).split("\\n").length - 1; if (commands >= 6 && !ready) { ready = true; appendFileSync(${JSON.stringify(readyLog)}, process.pid + "\\n"); } }); socket.on("error", () => {}); }); server.listen(ipc);`,
    'process.on("SIGTERM", () => server.close(() => process.exit()));',
  ].join("\n")}\n`, { mode: 0o755 });
  if (process.env.COUCH_TEST_FFMPEG) symlinkSync(process.env.COUCH_TEST_FFMPEG, join(binary, "ffmpeg"));
  // HLS routing alone needs no audio decoding. Keep its unrelated Synced helper offline.
  else writeFileSync(join(binary, "ffmpeg"), `#!${process.execPath}\nif (process.argv.includes("-version")) console.log("ffmpeg version 7.0.0");\n`, { mode: 0o755 });
  const streams: Record<string, Buffer> = {};
  if (raw) {
    assert.ok(process.env.COUCH_TEST_FFMPEG, "Set COUCH_TEST_FFMPEG to a real FFmpeg 7+ executable for raw TS fixtures.");
    for (const [name, video, audio] of [["TS_HEVC", "libx265", "aac"], ["TS_H264", "libx264", "aac"], ["TS_MPEG2", "mpeg2video", "aac"], ["TS_AC3", "libx264", "ac3"], ["TS_EAC3", "libx264", "eac3"], ["TS_MP2", "libx264", "mp2"]]) {
      streams[name!] = execFileSync(process.env.COUCH_TEST_FFMPEG, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=s=64x64:r=10", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", "0.3", "-c:v", video!, "-threads", "1", ...video === "libx265" ? ["-x265-params", "pools=none:log-level=error"] : [], "-c:a", audio!, "-f", "mpegts", "pipe:1"]);
    }
  }
  process.env.PATH = `${binary}:${originalPath ?? ""}`;
  let held: { path: string; entered: () => void; responses: Map<ServerResponse, string | Buffer> } | undefined;
  const source = createServer((request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    const body = request.url === "/channels.m3u" ? `#EXTM3U\n${[...Object.keys(playlists), ...Object.keys(streams)].map(name => `#EXTINF:-1 tvg-id="${name}",${name}\n${origin}/${name}.${name in streams ? "ts" : "m3u8"}`).join("\n")}\n`
      : streams[request.url?.slice(1, -3) ?? ""] ?? playlists[request.url?.slice(1, -5) ?? ""] ?? "#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\n0.ts\n";
    if (held && held.path === request.url) { held.responses.set(response, body); held.entered(); }
    else response.end(body);
  });
  await new Promise<void>(resolve => source.listen(0, "127.0.0.1", resolve));
  const address = source.address(); assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`, originalFetch = globalThis.fetch;
  // Only unrelated external startup discovery is synthetic. Routing uses real Hub/guide HTTP and WebSockets.
  globalThis.fetch = (async (input, init) => {
    if (String(input).startsWith("https://streamingcommunity")) {
      const response = new Response('<div data-page="{&quot;component&quot;:&quot;Home&quot;,&quot;props&quot;:{}}"></div>');
      Object.defineProperty(response, "url", { value: String(input) }); return response;
    }
    return originalFetch(input, init);
  }) as typeof fetch;
  const hub = await createHub({ databasePath, hostToken, hostname: "127.0.0.1", port: Number(process.env.COUCH_PORT ?? 0) });
  const sockets: WebSocket[] = [];
  const connect = async (auth: string, id: string, sharing = false) => {
    const socket = new WebSocket(`${hub.origin.replace("http:", "ws:")}/api/ws?token=${auth}&device=${id}&audio=${Number(sharing)}&video=${Number(sharing)}`, { headers: { Origin: hub.origin } }); sockets.push(socket);
    const messages: ServerMessage[] = [];
    const pending = new Map<string, (message: Extract<ServerMessage, { type: "result" }>) => void>();
    let state: SessionState | undefined, sequence = 0;
    socket.on("message", bytes => {
      const message = JSON.parse(String(bytes)) as ServerMessage; messages.push(message);
      if (message.type === "state") state = message.state;
      if (message.type === "result") { pending.get(message.requestId)?.(message); pending.delete(message.requestId); }
    });
    await until(() => !!state);
    return { socket, messages, get state() { return state!; }, command: (action: Action) => new Promise<Extract<ServerMessage, { type: "result" }>>(resolve => {
      const requestId = String(++sequence); pending.set(requestId, resolve); socket.send(JSON.stringify({ type: "command", requestId, action }));
    }) };
  };
  const nativeLoads = () => existsSync(nativeLog) ? readFileSync(nativeLog, "utf8").trim().split("\n").map(line => JSON.parse(line) as { pid: number; source: string }) : [];
  // Wait for mpv's observation commands to drain before replacing its IPC process.
  const nativeReady = () => until(() => existsSync(readyLog) && readFileSync(readyLog, "utf8").split("\n").includes(String(nativeLoads().at(-1)?.pid)));
  const close = async () => {
    for (const socket of sockets) socket.terminate(); await hub.close();
    source.closeAllConnections(); await new Promise<void>(resolve => source.close(() => resolve()));
    await until(() => nativeLoads().every(({ pid }) => { try { process.kill(pid, 0); return false; } catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH"; } }));
    if (nativeLoads().length) rmSync(join(tmpdir(), `couch-mpv-${process.pid}.sock`), { force: true });
    globalThis.fetch = originalFetch; process.env.PATH = originalPath; rmSync(directory, { recursive: true, force: true });
  };
  try {
    const host = await connect(hostToken, hostId), remote = await connect(token, remoteId);
    const api = (path: string, body?: unknown, auth = token) => fetch(`${hub.origin}${path}`, { headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" }, ...body === undefined ? {} : { method: "POST", body: JSON.stringify(body) } });
    const added = await api("/api/iptv/sources", { name: "Codec fixture", playlistUrl: `${origin}/channels.m3u` });
    assert.equal(added.status, 201, JSON.stringify(await added.json()));
    const { channels } = await (await api("/api/iptv/guide")).json() as { channels: { id: string; name: string }[] };
    return { host, remote, hostId, remoteId, hostToken, targetId, targetToken, api, connect, nativeLoads, nativeReady,
      play: (name: string, on: string | null = remoteId, auth = token) => api(`/api/iptv/channels/${channels.find(channel => channel.name === name)!.id}/play${on ? `?on=${on}` : ""}`, {}, auth),
      hold: (name: string) => {
        const entered = new Promise<void>(resolve => { held = { path: `/${name}.${name in streams ? "ts" : "m3u8"}`, entered: resolve, responses: new Map() }; });
        return { entered, release: () => { const pending = held; held = undefined; for (const [response, body] of pending!.responses) response.end(body); } };
      },
      close,
    };
  } catch (error) { await close(); throw error; }
}

const loads = (device: Awaited<ReturnType<typeof fixture>>["remote"]) => device.messages.flatMap(message => message.type === "player" && message.command.type === "load" ? [message.command] : []);

test("remote-only HEVC can try its browser without starting the host", { timeout: 15_000 }, async () => {
  const f = await fixture();
  try {
    for (const name of ["H264", "Alternative", "HEVC"]) {
      const before = loads(f.remote).length;
      assert.equal((await f.play(name)).status, 200);
      await until(() => f.remote.state.player.status === "error" || loads(f.remote).length > before);
      assert.equal(f.remote.state.player.error, null);
      assert.equal(loads(f.remote).length, before + 1);
      assert.ok(loads(f.remote).at(-1)!.source.endsWith(`/${name}.m3u8`));
      assert.equal(loads(f.remote).at(-1)!.mpv, undefined);
      await until(() => f.remote.state.player.playbackId === loads(f.remote).at(-1)!.playbackId);
      assert.deepEqual(f.remote.state.outputs?.map(output => output.deviceId), [f.remoteId]);
      assert.equal(loads(f.host).length, 0);
      assert.equal(f.nativeLoads().length, 0);
    }
    f.remote.socket.send(JSON.stringify({ type: "player", state: { ...f.remote.state.player, speed: 1, buffering: false, status: "error", error: "Synthetic decoder refusal" } }));
    await until(() => f.remote.state.player.error === "Synthetic decoder refusal");
    assert.deepEqual(f.remote.state.outputs?.map(output => output.deviceId), [f.remoteId]);
    assert.equal(loads(f.host).length, 0);
    assert.equal(f.nativeLoads().length, 0);
  } finally { await f.close(); }
});

for (const raw of [false, true]) {
  const options = { timeout: 30_000, skip: raw && !process.env.COUCH_TEST_FFMPEG ? "Set COUCH_TEST_FFMPEG for real TS generation and probing." : false };
  test(`${raw ? "raw MPEG-TS" : "HLS"} preserves H264 and other native-codec routing on remote and host outputs`, options, async () => {
    const f = await fixture(raw);
    try {
      const native = raw ? ["TS_MPEG2", "TS_AC3", "TS_EAC3", "TS_MP2"] : ["MPEG2", "AC3", "EAC3", "HEVC_AC3"];
      const browser = raw ? ["TS_H264", "TS_HEVC"] : ["H264", "Alternative"];
      for (const name of browser) {
        const before = loads(f.remote).length;
        assert.equal((await f.play(name)).status, 200);
        await until(() => loads(f.remote).length > before || f.remote.state.player.status === "error");
        assert.equal(f.remote.state.player.error, null);
        assert.equal(loads(f.remote).at(-1)!.mpegts, raw ? true : undefined);
        assert.equal(loads(f.remote).at(-1)!.mpv, undefined);
      }
      for (const name of native) {
        assert.equal((await f.play(name)).status, 200);
        await until(() => f.remote.state.queue.find(entry => entry.id === f.remote.state.currentEntryId)?.title === name && f.remote.state.player.status === "error");
        assert.match(f.remote.state.player.error!, /plays only on Couch/);
        assert.deepEqual(f.remote.state.outputs?.map(output => output.deviceId), [f.remoteId]);
        assert.equal(loads(f.host).length, 0);
        assert.equal(f.nativeLoads().length, 0);
      }
      for (const name of raw ? ["TS_H264", "TS_HEVC", ...native] : ["H264", "Alternative", "HEVC", ...native]) {
        const nativeBefore = f.nativeLoads().length, browserBefore = loads(f.host).length;
        assert.equal((await f.play(name, f.hostId)).status, 200);
        const nativeRoute = native.includes(name) || process.platform === "linux" && ["HEVC", "TS_HEVC"].includes(name);
        await until(() => nativeRoute ? f.nativeLoads().length > nativeBefore : loads(f.host).length > browserBefore);
        if (nativeRoute) { await f.nativeReady(); assert.ok(f.nativeLoads().at(-1)!.source.endsWith(`/${name}.${raw ? "ts" : "m3u8"}`)); }
        assert.equal(f.nativeLoads().length, nativeBefore + Number(nativeRoute));
        assert.equal(loads(f.host).length, browserBefore + Number(!nativeRoute));
        await until(() => f.remote.state.outputs?.[0]?.deviceId === f.hostId);
        assert.deepEqual(f.remote.state.outputs?.map(output => output.deviceId), [f.hostId]);
      }
    } finally { await f.close(); }
  });

  test(`${raw ? "raw HEVC TS" : "HEVC-only HLS"} keeps conservative native routing when the mix includes the Linux host`, options, async () => {
    const f = await fixture(raw);
    try {
      assert.equal((await f.play("H264")).status, 200);
      await until(() => loads(f.remote).length === 1);
      assert.equal((await f.remote.command({ type: "output", deviceId: f.hostId, picture: true })).ok, true);
      await until(() => f.remote.state.outputs?.length === 2);
      const browserName = raw ? "TS_H264" : "Alternative";
      assert.equal((await f.play(browserName, null)).status, 200);
      await until(() => loads(f.remote).some(command => command.source.endsWith(`/${browserName}.${raw ? "ts" : "m3u8"}`)));
      assert.equal(f.nativeLoads().length, 0);
      assert.equal(f.remote.state.outputs?.length, 2);
      const remoteBefore = loads(f.remote).length;
      const gate = f.hold(raw ? "TS_HEVC" : "HEVC");
      assert.equal((await f.play(raw ? "TS_HEVC" : "HEVC", null)).status, 200);
      await gate.entered;
      assert.equal(f.remote.state.outputs?.length, 2);
      gate.release();
      if (process.platform === "linux") {
        await until(() => f.nativeLoads().length === 1);
        await f.nativeReady();
        await until(() => f.remote.state.outputs?.length === 1);
        assert.deepEqual(f.remote.state.outputs?.map(output => output.deviceId), [f.hostId]);
      } else {
        await until(() => loads(f.remote).length > remoteBefore);
        assert.equal(f.remote.state.outputs?.length, 2);
        assert.equal(f.nativeLoads().length, 0);
      }
    } finally { await f.close(); }
  });

  test(`${raw ? "raw HEVC TS" : "HEVC HLS"} cannot load an output whose consent was revoked during resolution`, options, async () => {
    const f = await fixture(raw);
    try {
      const target = await f.connect(f.targetToken, f.targetId, true), gate = f.hold(raw ? "TS_HEVC" : "HEVC");
      assert.equal((await f.play(raw ? "TS_HEVC" : "HEVC", f.targetId)).status, 200);
      await gate.entered;
      await until(() => f.remote.state.outputs?.[0]?.deviceId === f.targetId);
      const playback = f.remote.state.playback;
      assert.equal((await target.command({ type: "sharing", sharing: { audio: false, video: false } })).ok, true);
      gate.release();
      await until(() => f.remote.state.player.error === "Choose a shared output to play it.");
      assert.deepEqual(f.remote.state.playbacks?.find(item => item.id === playback)?.outputs, []);
      assert.equal(loads(target).length, 0);
      assert.equal(loads(f.host).length, 0);
      assert.equal(f.nativeLoads().length, 0);
    } finally { await f.close(); }
  });
}

test("removing the host during HEVC source resolution refuses fallback and keeps the remote output", { timeout: 15_000, skip: process.platform !== "linux" }, async () => {
  const f = await fixture();
  try {
    assert.equal((await f.play("H264")).status, 200);
    await until(() => loads(f.remote).length === 1);
    assert.equal((await f.remote.command({ type: "output", deviceId: f.hostId, picture: true })).ok, true);
    const gate = f.hold("HEVC");
    assert.equal((await f.play("HEVC", null)).status, 200);
    await gate.entered;
    assert.equal((await f.remote.command({ type: "output", deviceId: f.hostId, picture: false })).ok, true);
    await until(() => f.remote.state.outputs?.length === 1);
    gate.release();
    await until(() => f.remote.state.player.status === "error");
    assert.match(f.remote.state.player.error!, /plays only on Couch/);
    assert.deepEqual(f.remote.state.outputs?.map(output => output.deviceId), [f.remoteId]);
    assert.equal(f.nativeLoads().length, 0);
    assert.equal(loads(f.host).some(command => command.source.endsWith("/HEVC.m3u8")), false);
  } finally { await f.close(); }
});

test("revoking host network sharing during HEVC resolution prevents the pending remote request from loading mpv", { timeout: 15_000, skip: process.platform !== "linux" }, async () => {
  const f = await fixture();
  try {
    const gate = f.hold("HEVC");
    assert.equal((await f.play("HEVC", f.hostId)).status, 200);
    await gate.entered;
    assert.equal((await f.api("/api/settings/sharing", { enabled: false }, f.hostToken)).status, 200);
    gate.release();
    await until(() => f.host.state.player.status === "error");
    assert.equal(f.nativeLoads().length, 0);
    assert.equal(loads(f.host).length, 0);
  } finally { await f.close(); }
});

test("Solo to the host resolves HEVC for the requested destination", { timeout: 15_000 }, async () => {
  const f = await fixture();
  try {
    assert.equal((await f.play("HEVC")).status, 200);
    await until(() => loads(f.remote).length === 1);
    await until(() => f.remote.state.player.playbackId === loads(f.remote)[0]!.playbackId);
    f.remote.socket.send(JSON.stringify({ type: "player", state: { ...f.remote.state.player, speed: 1, buffering: false, status: "playing" } }));
    await until(() => f.remote.state.player.status === "playing");
    assert.equal((await f.remote.command({ type: "solo", deviceId: f.hostId })).ok, true);
    await until(() => f.host.state.outputs?.[0]?.deviceId === f.hostId);
    if (process.platform === "linux") {
      await until(() => f.nativeLoads().length === 1);
      await f.nativeReady();
      assert.equal(loads(f.host).length, 0);
    } else await until(() => loads(f.host).length === 1);
  } finally { await f.close(); }
});
