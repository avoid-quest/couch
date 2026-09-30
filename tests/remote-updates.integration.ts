import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { createHub } from "../src/server/hub";
import { openStore } from "../src/server/store";
import type { UpdateAction, UpdateState, UpdateTarget } from "../src/shared/app-bridge";

test("a phone administrator updates a Client TV through its paired WebSocket", { timeout: 15_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "couch-remote-update-"));
  const databasePath = join(directory, "couch.sqlite");
  const store = openStore(databasePath, true);
  const phone = store.pair("p".repeat(43), "Phone");
  const tv = store.pair("t".repeat(43), "Living room TV");
  store.setDeviceRole("p".repeat(43), "administrator");
  store.setDeviceRole("t".repeat(43), "controller");
  store.close();
  const hostActions: UpdateAction[] = [], tvActions: UpdateAction[] = [];
  let state: UpdateState = { version: "0.3.0", channel: "latest", status: "ready", available: "0.3.1", progress: null, checkedAt: null, error: null };
  const hub = await createHub({ databasePath, hostToken: "h".repeat(64), hostname: "127.0.0.1", port: 0, nativeUpdates: async action => { hostActions.push(action); return state; } });
  let socket: WebSocket | undefined;
  const api = (token: string, path: string, body?: unknown) => fetch(`${hub.origin}${path}`, { headers: { Authorization: `Bearer ${token}`, ...body === undefined ? {} : { "Content-Type": "application/json" } }, ...body === undefined ? {} : { method: "POST", body: JSON.stringify(body) } });
  try {
    assert.equal((await api(tv, "/api/updates/install", { version: "0.3.1" })).status, 403);
    socket = new WebSocket(`${hub.origin.replace("http:", "ws:")}/api/ws?token=${tv}&device=${"t".repeat(43)}&updates=1&administration=1&tv=1`, { headers: { Origin: hub.origin } });
    socket.onmessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.type !== "updates") return;
      tvActions.push(message.action);
      if (message.action.op === "install") state = { ...state, status: "installing" };
      socket!.send(JSON.stringify({ type: "updates", requestId: message.requestId, state }));
    };
    await new Promise<void>((resolve, reject) => { socket!.once("open", resolve); socket!.once("error", reject); });
    const targets = await (await api(phone, "/api/updates/targets")).json() as UpdateTarget[];
    assert.deepEqual(targets.map(target => [target.id, target.name]), [["host", "Couch"], ["t".repeat(43), "Living room TV"]]);
    assert.equal((await (await api(phone, `/api/updates?device=${"t".repeat(43)}`)).json()).version, "0.3.0");
    const installed = await api(phone, `/api/updates/install?device=${"t".repeat(43)}`, { version: "0.3.1" });
    assert.equal(installed.status, 200);
    assert.equal((await installed.json()).status, "installing");
    assert.deepEqual(tvActions, [{ op: "read" }, { op: "install", version: "0.3.1" }]);
    assert.deepEqual(hostActions, []);
    await api(phone, "/api/updates");
    assert.deepEqual(hostActions, [{ op: "read" }]);
    const revoked = await fetch(`${hub.origin}/api/devices/${"t".repeat(43)}`, { method: "DELETE", headers: { Authorization: `Bearer ${phone}` } });
    assert.equal(revoked.status, 200);
    assert.equal((await api(phone, `/api/updates?device=${"t".repeat(43)}`)).status, 503);
  } finally {
    socket?.close();
    await hub.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
