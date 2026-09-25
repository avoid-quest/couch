import { afterEach, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, stat } from "node:fs/promises";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { version } from "../package.json";
import { selectLan } from "./server/lan-listener";
import type { HostMessage, SidecarMessage } from "./shared/protocol";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const task of cleanup.splice(0).reverse()) await task();
});

test.each(["stdin close", "shutdown message", "AppImage admission"])("the sidecar accepts native observations, protects its data, and exits on %s", async reason => {
  const interfaces = networkInterfaces();
  const lan = Object.entries(interfaces).flatMap(([name, entries]) => (entries ?? []).map(({ address }) => ({ name, address }))).find(({ name, address }) => {
    try { return !!selectLan(interfaces, name, address); } catch { return false; }
  });
  if (!lan) throw new Error("This test needs a private IPv4 LAN address.");
  const dir = await mkdtemp(join(tmpdir(), "couch-sidecar-"));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  await chmod(dir, 0o755);
  const token = crypto.randomUUID();
  const child = Bun.spawn([process.execPath, "src/main.ts"], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      COUCH_NATIVE: "1",
      COUCH_APPIMAGE: reason === "AppImage admission" ? "1" : "0",
      COUCH_HOST: "127.0.0.1",
      COUCH_PORT: "0",
      COUCH_LAN_INTERFACE: lan.name,
      COUCH_LAN_ADDRESS: lan.address,
      COUCH_HOST_TOKEN: token,
      COUCH_DATA_DIR: dir,
    },
    stdin: "pipe", stdout: "pipe", stderr: "pipe",
  });
  cleanup.push(async () => { child.kill(); await child.exited; });
  const reader = child.stdout.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  async function message(): Promise<SidecarMessage> {
    while (!buffer.includes("\n")) {
      const value = await reader.read();
      if (value.done) throw new Error("Sidecar exited before its response");
      buffer += value.value;
    }
    const end = buffer.indexOf("\n");
    const line = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    const result = JSON.parse(line) as SidecarMessage;
    if (result.type === "addresses") {
      expect(result.urls.every(url => url.startsWith("http://"))).toBe(true);
      return message();
    }
    if (result.type === "sound") {
      const state = (result.action as { op?: string }).op === "inventory" ? { defaultOutput: "test-output", profiles: [], outputs: [{ id: "test-output", name: "Test output", state: "Available", availability: "available", volume: 50, muted: false, volumeWritable: true, muteWritable: true }] } : { output: null };
      child.stdin.write(`${JSON.stringify({ type: "sound", requestId: result.requestId, state } satisfies HostMessage)}\n`);
      await child.stdin.flush();
      return message();
    }
    return result;
  }

  const ready = await message();
  expect(ready.type).toBe("ready");
  if (ready.type !== "ready") throw new Error("Missing startup message");
  expect(ready.token).toBe(token);
  if (process.platform !== "win32") expect((await stat(dir)).mode & 0o777).toBe(0o700);
  const health = () => fetch(`${ready.origin}/api/health`).then(response => response.json());
  const enableSharing = () => fetch(`${ready.origin}/api/settings/sharing`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ enabled: true }) });
  expect((await health()).player).toBe("unavailable");
  expect((await fetch(`${ready.origin}/api/build`)).status).toBe(503);
  expect((await fetch(`${ready.origin}/api/connection`).then(response => response.json())).remoteControlEnabled).toBe(false);

  const observation: HostMessage = {
    type: "player",
    state: { playbackId: null, status: "idle", position: 0, duration: null, volume: 50, seekable: false, error: null },
  };
  if (reason === "AppImage admission") {
    expect((await enableSharing()).status).toBe(503);
    expect((await fetch(`${ready.origin}/api/connection`).then(response => response.json())).remoteControlEnabled).toBe(false);
    const status = await message();
    expect(status.type).toBe("appimageUpdate");
    if (status.type !== "appimageUpdate") throw new Error("Missing startup status");
    expect(status.action.type).toBe("status");
    // The native host reports idle before the asynchronous startup gate opens.
    child.stdin.write(JSON.stringify(observation) + "\n");
    child.stdin.write(JSON.stringify({ type: "appimageUpdate", requestId: status.requestId, ok: true, transaction: null }) + "\n");
    await child.stdin.flush();
    expect(await message()).toEqual({ type: "observe" });
    expect((await health()).player).toBe("unavailable");
  }
  expect((await enableSharing()).status).toBe(200);
  expect((await fetch(`${ready.origin}/api/build`)).status).toBe(401);
  const identity = await fetch(`${ready.origin}/api/build`, { headers: { Authorization: `Bearer ${token}` } }).then(response => response.json());
  expect(identity).toMatchObject({ version, packaged: false });
  // Split a message to cover pipe chunk boundaries rather than assuming one read per line.
  const line = `${JSON.stringify(observation)}\n`;
  child.stdin.write(line.slice(0, 12));
  await child.stdin.flush();
  child.stdin.write(line.slice(12));
  await child.stdin.flush();
  // Native Linux and Mac sound controls leave the player at unity gain.
  expect(await message()).toEqual({ type: "playback", command: { type: "volume", volume: process.platform === "linux" || process.platform === "darwin" ? 100 : 80 } });
  expect((await health()).player).toBe("idle");

  if (reason === "stdin close") child.stdin.end();
  else { child.stdin.write(`${JSON.stringify({ type: "shutdown" } satisfies HostMessage)}\n`); await child.stdin.flush(); }
  expect(await child.exited).toBe(0);
}, 15_000);

test("the Docker preview admits its published origin without changing native LAN admission", async () => {
  const dir = await mkdtemp(join(tmpdir(), "couch-preview-proxy-"));
  const token = crypto.randomUUID(), advertised = "http://192.168.10.2:4100";
  const child = Bun.spawn([process.execPath, "src/main.ts"], { env: { ...process.env, NODE_ENV: "production", COUCH_NATIVE: "1", COUCH_PREVIEW_PROXY_LAN: "1", COUCH_ADVERTISE_URLS: advertised, COUCH_HOST: "127.0.0.1", COUCH_PORT: "0", COUCH_HOST_TOKEN: token, COUCH_DATA_DIR: dir }, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  cleanup.push(async () => { child.kill(); await child.exited; await rm(dir, { recursive: true, force: true }); });
  const reader = child.stdout.pipeThrough(new TextDecoderStream()).getReader();
  let message = "";
  while (!message.includes("\n")) {
    const value = await reader.read();
    if (value.done) throw new Error("Preview sidecar exited before readiness");
    message += value.value;
  }
  const ready = JSON.parse(message.split("\n", 1)[0]!) as Extract<SidecarMessage, { type: "ready" }>;
  expect(ready).toMatchObject({ type: "ready", urls: [advertised] });
  const headers = { Host: new URL(advertised).host, Origin: advertised, "Content-Type": "application/json" };
  expect((await fetch(`${ready.origin}/api/settings/sharing`, { method: "POST", headers: { ...headers, Authorization: `Bearer ${token}` }, body: JSON.stringify({ enabled: true }) })).status).toBe(200);
  expect(await (await fetch(`${ready.origin}/api/connection`, { headers })).json()).toMatchObject({ urls: [advertised] });
  expect((await fetch(`${ready.origin}/api/pair`, { method: "POST", headers, body: JSON.stringify({ code: ready.pairingCode, name: "Preview phone" }) })).status).toBe(200);
  expect((await fetch(`${ready.origin}/api/connection`, { headers: { Host: "untrusted.example", Origin: "http://untrusted.example" } })).status).toBe(403);
  child.stdin.end();
  expect(await child.exited).toBe(0);
}, 15_000);
