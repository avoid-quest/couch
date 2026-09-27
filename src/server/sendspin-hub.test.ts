import { expect, test } from "bun:test";
import { appendFileSync, chmodSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerMessage } from "../shared/protocol";
import { createHub, type Hub } from "./hub";

const BunWebSocket = WebSocket as typeof WebSocket & { new(url: string, options: Bun.WebSocketOptions): WebSocket };
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error("Sendspin hub timeout"); await Bun.sleep(10); }
}
async function peer(hub: Hub, token: string) {
  const messages: ServerMessage[] = [];
  const socket = new BunWebSocket(`${hub.origin.replace("http:", "ws:")}/api/ws?token=${token}&clientProtocol=1`, { headers: { Origin: hub.origin } });
  socket.addEventListener("message", event => messages.push(JSON.parse(String(event.data))));
  await until(() => messages.some(message => message.type === "state"));
  return { socket, messages, async command(action: unknown) {
    const requestId = crypto.randomUUID();
    socket.send(JSON.stringify({ type: "command", requestId, action }));
    await until(() => messages.some(message => message.type === "result" && message.requestId === requestId));
    return messages.find(message => message.type === "result" && message.requestId === requestId);
  } };
}

// The helper exercises Core's process/dispatch boundary; it does not simulate or qualify the Sendspin SDK.
test("Sendspin hub registers its group, restricts pairing, dispatches group controls and closes its helper", async () => {
  const directory = mkdtempSync(join(tmpdir(), "sendspin-hub-"));
  const executable = join(directory, "helper"), log = join(directory, "requests.jsonl");
  appendFileSync(log, "");
  await Bun.write(executable, `#!${process.execPath}
import { appendFileSync } from 'node:fs';
const emit=x=>console.log(JSON.stringify({v:1,...x}));
let buffer='';for await(const bytes of Bun.stdin.stream()){buffer+=new TextDecoder().decode(bytes);for(;;){const end=buffer.indexOf('\\n');if(end<0)break;const r=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);appendFileSync(${JSON.stringify(log)},JSON.stringify(r)+'\\n');if(r.op==='start')emit({event:'members',members:[{id:'speaker',name:'Room',connected:true,joined:true,paired:true,qualified:false,volume:50,muted:false,methods:['dynamic_pin']}]});if(r.op==='pair')emit({event:'pairing',clientId:r.clientId,stage:'pin'});emit({id:r.id,ok:true});if(r.op==='close')process.exit(0);}}
`);
  chmodSync(executable, 0o755);
  const requests = (): { op: string; [key: string]: unknown }[] => readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  const hostToken = "sendspin-test-host-token-with-at-least-32-characters";
  const hub = createHub({ hostname: "127.0.0.1", port: 0, databasePath: join(directory, "core.sqlite"), pairingCode: "123456", hostToken, sendspin: { python: executable, script: join(directory, "unused.py"), stateDirectory: join(directory, "private"), name: "Rooms", port: 8927 } });
  const peers: Awaited<ReturnType<typeof peer>>[] = [];
  try {
    const pair = async () => {
      const response = await fetch(`${hub.origin}/api/pair`, { method: "POST", headers: { Origin: hub.origin, "Content-Type": "application/json" }, body: JSON.stringify({ code: hub.pairingCode }) });
      expect(response.status).toBe(200);
      return await response.json() as { token: string; controller: { id: string } };
    };
    const administrator = await pair(), controller = await pair();
    expect((await fetch(`${hub.origin}/api/controllers/${administrator.controller.id}/role`, { method: "POST", headers: { Authorization: `Bearer ${hostToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ role: "administrator" }) })).status).toBe(200);
    const host = await peer(hub, hostToken), admin = await peer(hub, administrator.token), remote = await peer(hub, controller.token);
    peers.push(host, admin, remote);
    await until(() => host.messages.some(message => message.type === "state" && message.state.targets?.some(target => target.id === "sendspin-group" && target.connected)));
    const state = host.messages.findLast(message => message.type === "state");
    expect(state).toMatchObject({ state: { targets: expect.arrayContaining([expect.objectContaining({ id: "sendspin-group", backend: "sendspin", name: "Rooms", connected: true })]) } });
    const pairing = { type: "groupPair", targetId: "sendspin-group", memberId: "speaker" };
    expect(await remote.command(pairing)).toMatchObject({ ok: false });
    expect(await remote.command({ ...pairing, type: "groupPairCancel" })).toMatchObject({ ok: false });
    expect(requests().filter(request => ["pair", "pairCancel"].includes(request.op))).toHaveLength(0);
    expect(await admin.command(pairing)).toMatchObject({ ok: true });
    expect(await host.command({ ...pairing, pin: "123456" })).toMatchObject({ ok: true });
    expect(await admin.command({ ...pairing, type: "groupPairCancel" })).toMatchObject({ ok: true });
    expect(await remote.command({ type: "groupMembers", targetId: "sendspin-group", memberIds: ["speaker"] })).toMatchObject({ ok: true });
    expect(await remote.command({ type: "groupVolume", targetId: "sendspin-group", memberId: "speaker", volume: 37, muted: true })).toMatchObject({ ok: true });
    expect(requests()).toEqual(expect.arrayContaining([expect.objectContaining({ op: "pair", clientId: "speaker" }), expect.objectContaining({ op: "pin", pin: "123456" }), expect.objectContaining({ op: "pairCancel" }), expect.objectContaining({ op: "members", ids: ["speaker"] }), expect.objectContaining({ op: "volume", clientId: "speaker", volume: 37, muted: true })]));
    const closed = new Promise<number>(resolve => host.socket.addEventListener("close", event => resolve(event.code), { once: true }));
    host.socket.send(JSON.stringify({ type: "command", requestId: "bad-pin", action: { ...pairing, pin: "12x456" } }));
    expect(await closed).toBe(1008);
    expect(requests().filter(request => request.op === "pin")).toHaveLength(1);
  } finally {
    for (const { socket } of peers) socket.close();
    await hub.close();
    const closed = requests().some(request => request.op === "close");
    rmSync(directory, { recursive: true, force: true });
    expect(closed).toBe(true);
  }
});
