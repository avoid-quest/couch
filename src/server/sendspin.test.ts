import { expect, test } from "bun:test";
import { mkdtemp, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSendspin, validateSendspinConfig } from "./sendspin";
import type { PlaybackTarget, PlayerState } from "../shared/protocol";

async function until(predicate: () => boolean) { const end = Date.now() + 5000; while (!predicate()) { if (Date.now() > end) throw new Error("Sendspin timeout"); await Bun.sleep(10); } }
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "couch-sendspin-"));
  const executable = join(directory, "helper");
  await Bun.write(executable, `#!${process.execPath}\nconst member={id:'speaker',name:'Room',connected:true,joined:true,paired:true,qualified:false,volume:50,muted:false,methods:['dynamic_pin']};
const emit=x=>console.log(JSON.stringify({v:1,...x}));
let buffer='';for await(const bytes of Bun.stdin.stream()){buffer+=new TextDecoder().decode(bytes);for(;;){const end=buffer.indexOf('\\n');if(end<0)break;const r=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);if(r.op==='start')emit({event:'members',members:[member]});if(r.op==='volume'){member.volume=r.volume;member.muted=r.muted;emit({event:'members',members:[member]});}if(r.op==='pair')emit({event:'pairing',clientId:r.clientId,stage:'pin',methods:['dynamic_pin']});if(r.op==='pin')emit({event:'pairing',clientId:r.clientId,stage:'complete',methods:['dynamic_pin']});emit({id:r.id,ok:true,position:0});if(r.op==='close')process.exit(0);}}`);
  await chmod(executable, 0o755);
  const targets: PlaybackTarget[] = [], players: PlayerState[] = [];
  const config = { python: executable, script: join(directory, "unused.py"), stateDirectory: join(directory, "private-state"), name: "Rooms", port: 8927 };
  const adapter = createSendspin(config, { changed: target => targets.push(structuredClone(target)), observe: player => players.push(player) });
  return { targets, players, adapter, directory, async close() { await adapter.close(); await rm(directory, { recursive: true, force: true }); } };
}
test("Sendspin private IPC publishes observed volume, pairing and idle reconnect without leaking helper paths", async () => {
  const f = await fixture();
  try {
    await until(() => f.targets.at(-1)?.connected === true);
    expect(f.targets.at(-1)?.handoffSafety).toBe("unverified");
    expect(JSON.stringify(f.targets)).not.toContain(f.directory);
    await f.adapter.setMemberVolume("speaker", 20, true);
    await until(() => f.players.at(-1)?.volume === 20);
    await f.adapter.pair("speaker");
    await until(() => !!(f.targets.at(-1) as any).pairing);
    await f.adapter.pair("speaker", "123456");
    await until(() => !(f.targets.at(-1) as any).pairing);
    await f.adapter.reconnect();
    expect(f.players.at(-1)?.status).toBe("idle");
    expect(f.targets.at(-1)?.connected).toBe(true);
    expect(() => f.adapter.send({ type: "load", playbackId: "secret", source: "file:///etc/passwd" })).toThrow("HTTP");
    expect(f.targets.at(-1)?.connected).toBe(true);
  } finally { await f.close(); }
});
test("Sendspin validates operator helper paths and bounds before starting a process", () => {
  const config = { python: "python", script: "/bridge.py", stateDirectory: "/state", name: "Rooms", port: 8927 };
  expect(() => validateSendspinConfig(config)).toThrow("configuration");
  expect(() => validateSendspinConfig({ ...config, python: "/python", host: "not-an-ip" })).toThrow("configuration");
  expect(() => validateSendspinConfig({ ...config, python: "/python", host: "0.0.0.0" })).not.toThrow();
  expect(() => validateSendspinConfig({ ...config, python: "/python", qualifiedClientIds: Array(33).fill("id") })).toThrow("configuration");
});
