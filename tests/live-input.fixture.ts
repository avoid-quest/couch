import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import WebSocket from "ws";
import { AudioCodec, Identity, PlayerCommand, Roles, SendspinClient, serverNowUs } from "@sonn-audio/node-sendspin";
import { createHub } from "../src/server/hub";
import { openStore } from "../src/server/store";
import { deviceId } from "../src/client/session/device-id";
import type { Action, PlaybackCommand, PlayerState, ServerMessage, SessionState } from "../src/shared/protocol";

export async function until(predicate: () => boolean) {
  const deadline = Date.now() + 5_000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error("Expected live playback state was not published."); await new Promise(resolve => setTimeout(resolve, 10)); }
}

// Real hub, HTTP, WebSockets, ownership and output routing. FFmpeg is replaced;
// paced PCM advances the group's state, while live-stream/live-clock test real media.
// local pairs "Local" with this process's own client device ID, so client components treat it as This device.
export async function liveFixture({ local = false } = {}) {
  const fetchLocal = globalThis.fetch;
  globalThis.fetch = ((input, init) => /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::|\/)/.test(String(input)) ? fetchLocal(input, init) : Promise.resolve(new Response(""))) as typeof fetch;
  const directory = mkdtempSync(join(tmpdir(), "couch-live-input-")), databasePath = join(directory, "couch.sqlite");
  const previousPath = process.env.PATH;
  writeFileSync(join(directory, "ffmpeg"), `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
if (process.argv.includes('-version')) { console.log('ffmpeg version 7.0'); process.exit(0); }
// Each capture chunk becomes the next segment; the playlist lists the newest four.
if (process.argv.includes('pipe:0')) {
  const playlists = process.argv.at(-1).split('|').map(output => output.slice(output.indexOf(']') + 1));
  let n = 0;
  process.stdin.on('data', () => {
    const name = index => 'segment-' + String(index).padStart(9, '0') + '.ts', first = Math.max(0, n - 3);
    const lines = ['#EXTM3U', '#EXT-X-TARGETDURATION:1', '#EXT-X-MEDIA-SEQUENCE:' + first];
    for (let index = first; index <= n; index++) lines.push('#EXTINF:1,', name(index));
    for (const playlist of playlists) {
      fs.writeFileSync(path.join(path.dirname(playlist), name(n)), 'fixture segment');
      fs.writeFileSync(playlist + '.tmp', lines.join('\\n') + '\\n');
      fs.renameSync(playlist + '.tmp', playlist);
    }
    n++;
  });
}
else if (process.argv.includes('s16le')) {
  process.stderr.write('[Parsed_ashowinfo_0] n:0 pts:0 pts_time:0\\n');
  setInterval(() => fs.writeSync(3, Buffer.alloc(19200)), 100);
}
process.stdin.resume();
setInterval(() => {}, 1000);
`, { mode: 0o755 });
  process.env.PATH = `${directory}${delimiter}${previousPath ?? ""}`;
  const store = openStore(databasePath, true);
  const hostIdentity = { id: Identity.generate().peerId, token: "h".repeat(64) };
  const identities = ["Publisher", "Receiver", "Other"].map(name => { const key = Identity.generate(), id = key.peerId; return { key, id, token: store.pair(id, name) }; });
  if (local) identities.push({ key: Identity.generate(), id: deviceId(), token: store.pair(deviceId(), "Local") });
  store.close();
  const hubOptions = { databasePath, hostToken: "h".repeat(64), hostname: "127.0.0.1", port: 0, advertisedUrls: ["https://receiver.example"] };
  let hub = await createHub(hubOptions);
  const sockets: WebSocket[] = [], speakers: SendspinClient[] = [], chunks: number[] = [];
  async function connect(index: number, sharing = "", secure = false) {
    const identity = index === -1 ? hostIdentity : identities[index]!;
    const socket = new WebSocket(`${hub.origin.replace("http:", "ws:")}/api/ws?token=${identity.token}&device=${identity.id}${sharing}`, { headers: { Origin: secure ? "https://receiver.example" : hub.origin } });
    sockets.push(socket);
    const messages: ServerMessage[] = [], pending = new Map<string, (message: Extract<ServerMessage, { type: "result" }>) => void>();
    let state: SessionState | undefined, sequence = 0;
    await new Promise<void>((resolve, reject) => {
      socket.once("error", reject);
      socket.onmessage = event => {
        const message = JSON.parse(String(event.data)) as ServerMessage;
        messages.push(message);
        if (message.type === "state") { state = message.state; resolve(); }
        if (message.type === "result") { pending.get(message.requestId)?.(message); pending.delete(message.requestId); }
      };
    });
    return { socket, messages, id: identity.id, report: (player: Partial<PlayerState> = {}) => socket.send(JSON.stringify({ type: "player", state: { ...state!.player, status: "playing", speed: 1, buffering: false, ...player } })), get state() { return state!; }, command: (action: Action) => new Promise<Extract<ServerMessage, { type: "result" }>>(resolve => {
      const requestId = String(++sequence); pending.set(requestId, resolve); socket.send(JSON.stringify({ type: "command", requestId, action }));
    }), load: () => {
      const message = messages.findLast(message => message.type === "player" && message.command.type === "load");
      return message?.type === "player" ? message.command as Extract<PlaybackCommand, { type: "load" }> : undefined;
    } };
  }
  const publisher = await connect(0), receiver = await connect(1);
  const uploadUrl = (sourceId: string, key: string, device = 0) => `${hub.origin.replace("http:", "ws:")}/api/live/upload?${new URLSearchParams({ sourceId, key, token: device === -1 ? hostIdentity.token : identities[device]!.token })}`;
  const uploadToken = "1".repeat(64);
  // Like live.ts, a publishing window records and uploads only while Core asks for its source (livePeers upload).
  const uploads = new Map<string, WebSocket>();
  const answerUploads = (client: { socket: WebSocket }, device = 0) => {
    const mine = new Set<WebSocket>();
    client.socket.on("message", data => {
      const message = JSON.parse(String(data)) as ServerMessage;
      if (message.type !== "livePeers") return;
      const open = uploads.get(message.sourceId);
      if (message.upload && !open) {
        const upload = new WebSocket(uploadUrl(message.sourceId, uploadToken, device), { headers: { Origin: hub.origin } });
        sockets.push(upload);
        mine.add(upload);
        uploads.set(message.sourceId, upload);
        upload.once("open", () => upload.send(Buffer.from("fixture capture")));
        upload.once("close", () => { if (uploads.get(message.sourceId) === upload) uploads.delete(message.sourceId); });
        upload.on("error", () => {});
      } else if (!message.upload && open) { uploads.delete(message.sourceId); open.close(); }
    });
    return { terminate: () => { for (const upload of mine) upload.terminate(); } };
  };
  answerUploads(publisher);
  // A timestamped PCM producer like the desktop's: clock start, then real-time
  // 10 ms stereo frames in binary upload v1, so Core measures real headroom.
  const streamCapture = async (client: { messages: ServerMessage[] }, sourceId: string, device = 0) => {
    await until(() => client.messages.some(message => message.type === "livePeers" && message.sourceId === sourceId && message.upload));
    const demand = client.messages.findLast(message => message.type === "livePeers" && message.sourceId === sourceId);
    const url = new URL(uploadUrl(sourceId, uploadToken, device));
    if (demand?.type === "livePeers" && demand.uploadId) url.searchParams.set("uploadId", demand.uploadId);
    const upload = new WebSocket(url, { headers: { Origin: hub.origin } });
    sockets.push(upload); upload.on("error", () => {});
    await new Promise(resolve => upload.once("open", resolve));
    upload.send(JSON.stringify({ type: "start", generation: "fixture", offsetUs: 0, rttUs: 0 }));
    let sequence = 0; const origin = serverNowUs();
    const timer = setInterval(() => {
      for (; origin + (sequence + 1) * 10_000 <= serverNowUs(); sequence++) {
        const frame = Buffer.alloc(40 + 480 * 8);
        frame.writeUInt32LE(0x31414343, 0); frame.writeUInt8(2, 4); frame.writeUInt8(1, 5); frame.writeUInt16LE(40, 6); frame.writeUInt32LE(48000, 8);
        frame.writeUInt32LE(sequence, 12); frame.writeBigUInt64LE(BigInt(sequence * 480), 16); frame.writeBigInt64LE(BigInt(origin + sequence * 10_000), 24); frame.writeUInt32LE(480, 32);
        upload.send(frame);
      }
    }, 5);
    timer.unref();
    return { stop: () => { clearInterval(timer); upload.close(); } };
  };
  return { get hub() { return hub; }, publisher, receiver, connect, databasePath, uploadToken, uploadUrl, uploads, answerUploads, streamCapture,
    // Core restarts on the same database; every socket and speaker reconnects itself.
    restart: async () => {
      await Promise.all(speakers.splice(0).map(speaker => speaker.disconnect()));
      await hub.close();
      for (const socket of sockets.splice(0)) socket.terminate();
      hub = await createHub(hubOptions);
    },
    publish: async (sourceId: string, kind: "screen" | "system-audio" | "microphone" = "screen", audio = true) => {
      assert.equal((await publisher.command({ type: "publishLive", sourceId, uploadToken, kind, audio, video: kind === "screen" })).ok, true);
    },
    speaker: async (index: number, codec = AudioCodec.PCM, state?: Parameters<SendspinClient["sendPlayerState"]>[0]) => {
      const identity = identities[index]!, delays: number[] = [];
      const speaker = new SendspinClient(identity.id, "Test speaker", [Roles.PLAYER], { encryption: { identity: identity.key },
        playerSupport: { supported_formats: [{ codec, channels: 2, sample_rate: 48_000, bit_depth: 16 }], buffer_capacity: 512 * 1024, supported_commands: [PlayerCommand.SET_STATIC_DELAY] } });
      speakers.push(speaker);
      chunks[index] = 0;
      speaker.addAudioChunkListener(() => chunks[index]!++);
      speaker.addServerCommandListener(command => {
        if (command.player?.command !== PlayerCommand.SET_STATIC_DELAY) return;
        const delay = command.player.static_delay_ms!;
        delays.push(delay);
        speaker.setStaticDelayMs(delay);
        void speaker.sendPlayerState({ static_delay_ms: delay });
      });
      await speaker.connect(`${hub.origin.replace("http:", "ws:")}/sendspin`, { timeoutMs: 3_000 });
      if (state) await speaker.sendPlayerState(state);
      return delays;
    },
    // PCM chunks the speaker last connected for a Device has received.
    heard: (index: number) => chunks[index] ?? 0,
    api: (path: string, body?: unknown) => fetch(`${hub.origin}${path}`, { headers: { Authorization: `Bearer ${identities[0]!.token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }) }),
    subtitle: (playbackId: string) => fetch(`${hub.origin}/api/subtitles?${new URLSearchParams({ playbackId, name: "captions.vtt" })}`, { method: "POST", headers: { Authorization: `Bearer ${identities[0]!.token}`, "Content-Type": "application/octet-stream" }, body: "WEBVTT\n\n00:00.000 --> 00:01.000\nHello" }),
    close: async () => {
      await Promise.all(speakers.map(speaker => speaker.disconnect()));
      await hub.close();
      for (const socket of sockets) socket.terminate();
      process.env.PATH = previousPath;
      globalThis.fetch = fetchLocal;
      rmSync(directory, { recursive: true, force: true });
    } };
}
