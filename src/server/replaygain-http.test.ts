import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Action, PlaybackCommand, PlayerState, ServerMessage } from "../shared/protocol";
import { createHub, type Hub } from "./hub";

const BunWebSocket = WebSocket as typeof WebSocket & { new(url: string, options: Bun.WebSocketOptions): WebSocket };
const idle: PlayerState = { playbackId: null, status: "idle", position: 0, duration: null, volume: 80, seekable: false, error: null };

async function connect(hub: Hub, token?: string) {
  if (!token) {
    const response = await fetch(`${hub.origin}/api/pair`, { method: "POST", headers: { Origin: hub.origin, "Content-Type": "application/json" }, body: JSON.stringify({ code: hub.pairingCode }) });
    expect(response.status).toBe(200);
    token = (await response.json() as { token: string }).token;
  }
  const socket = new BunWebSocket(`${hub.origin.replace("http:", "ws:")}/api/ws?token=${encodeURIComponent(token)}`, { headers: { Origin: hub.origin } });
  const messages: ServerMessage[] = [];
  socket.addEventListener("message", event => messages.push(JSON.parse(String(event.data))));
  async function wait(predicate: (message: ServerMessage) => boolean) {
    const deadline = Date.now() + 2000;
    while (!messages.some(predicate)) {
      if (Date.now() > deadline) throw new Error("ReplayGain HTTP controller did not receive its expected message");
      await Bun.sleep(5);
    }
    return messages.findLast(predicate)!;
  }
  await wait(message => message.type === "state");
  return {
    token, socket, messages, wait,
    command: async (action: Action) => {
      const requestId = crypto.randomUUID();
      socket.send(JSON.stringify({ type: "command", requestId, action }));
      return wait(message => message.type === "result" && message.requestId === requestId);
    },
    close: () => new Promise<void>(resolve => {
      if (socket.readyState === WebSocket.CLOSED) return resolve();
      socket.addEventListener("close", () => resolve(), { once: true }); socket.close();
    }),
  };
}

test("two paired HTTP controllers share observed gain, independent preference patches and a fresh reconnect snapshot", async () => {
  const directory = mkdtempSync(join(tmpdir(), "couch-replaygain-http-"));
  const commands: PlaybackCommand[] = [];
  const hub = createHub({ hostname: "127.0.0.1", port: 0, databasePath: join(directory, "state.sqlite"), pairingCode: "123456", hostToken: "replaygain-private-test-host-token-123456789", sendPlayer: command => commands.push(command) });
  const peers: Awaited<ReturnType<typeof connect>>[] = [];
  try {
    hub.session.observe(idle);
    const first = await connect(hub), second = await connect(hub); peers.push(first, second);
    expect(await first.command({ type: "preferences", profileId: "household", preferences: { replayGain: "track" } })).toMatchObject({ ok: true });
    expect(await second.command({ type: "preferences", profileId: "household", preferences: { subtitleLanguage: "ita" } })).toMatchObject({ ok: true });
    await first.wait(message => message.type === "state" && message.state.preferences?.profile.subtitleLanguage === "ita" && message.state.preferences.profile.replayGain === "track");
    expect(await first.command({ type: "enqueue", entry: { id: "music", title: "Music", source: "https://media.example/music.flac" }, playNow: true })).toMatchObject({ ok: true });
    const playbackId = hub.session.state.player.playbackId!;
    expect(commands.at(-1)).toMatchObject({ type: "load", preferences: { replayGain: "track", subtitleLanguage: "ita" } });
    // Native state is injected here; actual native capture has separate qualification.
    hub.session.observe({ ...idle, playbackId, status: "playing", replayGain: "track" });
    expect(await second.command({ type: "replayGain", playbackId, mode: "album" })).toMatchObject({ ok: true });
    expect(hub.session.state.player.replayGain).toBe("track");
    hub.session.observe({ ...hub.session.state.player, replayGain: "album" });
    await first.wait(message => message.type === "state" && message.state.player.replayGain === "album");
    expect(await first.command({ type: "savePlaybackDefault", profileId: "household", playbackId, setting: "replayGain" })).toMatchObject({ ok: true });
    await second.close();
    expect(await first.command({ type: "preferences", profileId: "household", preferences: { replayGain: "off" } })).toMatchObject({ ok: true });
    const fresh = await connect(hub, second.token); peers.push(fresh);
    expect(fresh.messages[0]).toMatchObject({ type: "state", state: { player: { replayGain: "album" }, preferences: { profile: { replayGain: "off", subtitleLanguage: "ita" } } } });
    expect(await fresh.command({ type: "replayGain", playbackId: "stale", mode: "off" })).toMatchObject({ ok: false });
    expect(JSON.stringify(fresh.messages)).not.toContain("replaygain-private");
  } finally {
    await Promise.all(peers.map(peer => peer.close()));
    await hub.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
