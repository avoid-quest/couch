import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { createHub } from "../src/server/hub";
import { openStore } from "../src/server/store";
import type { Action, PlayerState, ServerMessage, SessionState } from "../src/shared/protocol";

export async function until(predicate: () => boolean) {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Expected authority state was not published.");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

// Real Core/HTTP/socket boundaries; no capture devices or renderer are opened.
export async function authorityFixture(options: Partial<Parameters<typeof createHub>[0]> = {}) {
  const fetchLocal = globalThis.fetch;
  globalThis.fetch = ((input, init) => /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::|\/)/.test(String(input)) ? fetchLocal(input, init) : Promise.resolve(new Response(""))) as typeof fetch;
  const directory = mkdtempSync(join(process.env.COUCH_DATA_DIR ?? tmpdir(), "authority-"));
  const databasePath = join(directory, "couch.sqlite");
  const store = openStore(databasePath, true);
  const host = { id: "h".repeat(43), token: "h".repeat(64) };
  const devices = ["a", "p", "t", "b"].map((letter, index) => {
    const id = letter.repeat(43);
    return { id, token: store.pair(id, ["Admin", "Phone", "TV", "Other TV"][index]) };
  });
  store.close();
  let hub = await createHub({ databasePath, hostToken: host.token, hostname: "127.0.0.1", port: 0, ...options });
  const sockets: WebSocket[] = [];
  const connect = async (identity = devices[1]!, flags = "") => {
    const socket = new WebSocket(`${hub.origin.replace("http:", "ws:")}/api/ws?token=${identity.token}&device=${identity.id}${flags}`, { headers: { Origin: hub.origin } });
    sockets.push(socket);
    const messages: ServerMessage[] = [];
    const pending = new Map<string, (message: Extract<ServerMessage, { type: "result" }>) => void>();
    let state: SessionState | undefined, sequence = 0;
    await new Promise<void>((resolve, reject) => {
      socket.once("error", reject);
      socket.on("message", data => {
        const message = JSON.parse(String(data)) as ServerMessage;
        messages.push(message);
        if (message.type === "state") { state = message.state; resolve(); }
        if (message.type === "result") { pending.get(message.requestId)?.(message); pending.delete(message.requestId); }
      });
    });
    return {
      socket, messages, id: identity.id, get state() { return state!; },
      report: (player: Partial<PlayerState>) => socket.send(JSON.stringify({ type: "player", state: { ...state!.player, buffering: false, duration: 60, seekable: true, speed: 1, ...player } })),
      command: (action: Action, targetDeviceId?: string) => new Promise<Extract<ServerMessage, { type: "result" }>>(resolve => {
        const requestId = String(++sequence);
        pending.set(requestId, resolve);
        socket.send(JSON.stringify({ type: "command", requestId, action, ...(targetDeviceId ? { targetDeviceId } : {}) }));
      }),
    };
  };
  return {
    get hub() { return hub; }, directory, databasePath, host, devices, connect,
    api: (path: string, token = host.token, body?: unknown) => fetch(`${hub.origin}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Origin: hub.origin, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
    }),
    restart: async () => { await hub.close(); for (const socket of sockets.splice(0)) socket.terminate(); hub = await createHub({ databasePath, hostToken: host.token, hostname: "127.0.0.1", port: 0, ...options }); },
    close: async () => {
      try { await hub.close(); }
      finally { for (const socket of sockets) socket.terminate(); globalThis.fetch = fetchLocal; rmSync(directory, { recursive: true, force: true }); }
    },
  };
}

export function resultOk(result: Extract<ServerMessage, { type: "result" }>) { assert.equal(result.ok, true, result.error ?? ""); }
