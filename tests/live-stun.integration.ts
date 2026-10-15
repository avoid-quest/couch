import { test } from "node:test";
import assert from "node:assert/strict";
import { createSocket } from "node:dgram";
import { once } from "node:events";
import { crc32 } from "node:zlib";
import { networkInterfaces } from "node:os";
import { serveLiveStun } from "../src/server/live-stun";
import { createHub } from "../src/server/hub";
import { selectLan } from "../src/server/lan-listener";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { get } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("LAN STUN returns the receiver's real address and port", async () => {
  const server = await serveLiveStun({ name: "test", address: "127.0.0.1", netmask: "255.0.0.0" }, 0);
  const client = createSocket("udp4");
  try {
    client.bind(0, "127.0.0.1");
    await once(client, "listening");
    const request = Buffer.from("000100002112a4420102030405060708090a0b0c", "hex");
    const reply = once(client, "message", { signal: AbortSignal.timeout(1000) });
    client.send(request, server.port, "127.0.0.1");
    const [response] = await reply as [Buffer];
    assert.equal(response.readUInt16BE(0), 0x0101);
    assert.equal(response.readUInt16BE(2), response.length - 20);
    assert.deepEqual(response.subarray(4, 20), request.subarray(4, 20));
    assert.equal(response.readUInt16BE(20), 0x0020);
    assert.equal(response.readUInt16BE(22), 8);
    assert.equal(response[25], 1);
    assert.equal(response.readUInt16BE(26) ^ 0x2112, client.address().port);
    assert.equal((response.readUInt32BE(28) ^ 0x2112a442) >>> 0, 0x7f000001);
    assert.equal(response.readUInt16BE(32), 0x8028);
    assert.equal(response.readUInt32BE(36), (crc32(response.subarray(0, 32)) ^ 0x5354554e) >>> 0);
  } finally { client.close(); await server.stop(); }
});

const outsideAddress = Object.values(networkInterfaces()).flatMap(entries => entries ?? []).find(entry => entry.family === "IPv4" && !entry.internal)?.address;
test("LAN STUN ignores malformed discovery and peers outside its selected subnet", { skip: !outsideAddress }, async () => {
  const server = await serveLiveStun({ name: "test", address: "127.0.0.1", netmask: "255.255.255.255" }, 0);
  const local = createSocket("udp4"), outside = createSocket("udp4");
  try {
    local.bind(0, "127.0.0.1"); outside.bind(0, outsideAddress);
    await Promise.all([once(local, "listening"), once(outside, "listening")]);
    const replies: Buffer[] = [];
    local.on("message", response => replies.push(response));
    outside.on("message", response => replies.push(response));
    const request = Buffer.from("000100002112a4420102030405060708090a0b0c", "hex");
    outside.send(request, server.port, "127.0.0.1");
    for (const malformed of [request.subarray(0, 19), Buffer.alloc(20), Buffer.concat([request, Buffer.alloc(4)]), Buffer.from("000100082112a4420102030405060708090a0b0c0006000461626364", "hex")]) local.send(malformed, server.port, "127.0.0.1");
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(replies.length, 0);
  } finally { local.close(); outside.close(); await server.stop(); }
});

test("LAN STUN reports an occupied port without leaving a socket open", async () => {
  const network = { name: "test", address: "127.0.0.1", netmask: "255.0.0.0" };
  const server = await serveLiveStun(network, 0);
  try { await assert.rejects(serveLiveStun(network, server.port), { code: "EADDRINUSE" }); }
  finally { await server.stop(); }
});

test("LAN STUN closes idempotently and releases its port", async () => {
  const network = { name: "test", address: "127.0.0.1", netmask: "255.0.0.0" };
  const server = await serveLiveStun(network, 0);
  await Promise.all([server.stop(), server.stop()]);
  const replacement = await serveLiveStun(network, server.port);
  await replacement.stop();
});

const lan = Object.entries(networkInterfaces()).flatMap(([name, entries]) => {
  try { return [selectLan({ [name]: entries }, name)]; } catch { return []; }
})[0];
test("Core advertises LAN STUN only while sharing is listening and closes UDP with it", { skip: !lan, timeout: 10000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), "couch-live-stun-"));
  const previousInterface = process.env.COUCH_LAN_INTERFACE, previousAddress = process.env.COUCH_LAN_ADDRESS;
  process.env.COUCH_LAN_INTERFACE = lan!.name;
  process.env.COUCH_LAN_ADDRESS = lan!.address;
  const hostToken = "h".repeat(64);
  let hub: Awaited<ReturnType<typeof createHub>> | undefined;
  t.after(async () => {
    await hub?.close();
    if (previousInterface === undefined) delete process.env.COUCH_LAN_INTERFACE; else process.env.COUCH_LAN_INTERFACE = previousInterface;
    if (previousAddress === undefined) delete process.env.COUCH_LAN_ADDRESS; else process.env.COUCH_LAN_ADDRESS = previousAddress;
    await rm(directory, { recursive: true, force: true });
  });
  hub = await createHub({ databasePath: join(directory, "couch.sqlite"), hostToken, hostname: "127.0.0.1", port: 0, managedLan: true, remoteControlEnabled: true });
  const client = createSocket("udp4");
  try {
    const connection = () => fetch(`${hub!.origin}/api/live/ice-servers`, { headers: { Authorization: `Bearer ${hostToken}` } }).then(response => response.json());
    let servers = await connection();
    const deadline = Date.now() + 2000;
    while (!servers.length && Date.now() < deadline) { await new Promise(resolve => setTimeout(resolve, 10)); servers = await connection(); }
    assert.deepEqual(servers, [{ urls: `stun:${lan!.address}:${hub.server.port}` }]);
    client.bind(0, lan!.address);
    await once(client, "listening");
    const reply = once(client, "message", { signal: AbortSignal.timeout(1000) });
    client.send(Buffer.from("000100002112a4420102030405060708090a0b0c", "hex"), hub.server.port, lan!.address);
    const [response] = await reply as [Buffer];
    assert.equal(response.readUInt16BE(26) ^ 0x2112, client.address().port);
    const off = await fetch(`${hub.origin}/api/settings/sharing`, { method: "POST", headers: { Authorization: `Bearer ${hostToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ enabled: false }) });
    assert.equal(off.status, 200);
    assert.deepEqual(await connection(), []);
    const replacement = await serveLiveStun(lan!, hub.server.port);
    await replacement.stop();
  } finally {
    client.close();
  }
});

test("Occupied LAN STUN leaves HTTPS sharing up, unadvertised, and retries on the next listen", { skip: !lan, timeout: 10000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), "couch-live-stun-busy-"));
  const previousInterface = process.env.COUCH_LAN_INTERFACE, previousAddress = process.env.COUCH_LAN_ADDRESS;
  process.env.COUCH_LAN_INTERFACE = lan!.name;
  process.env.COUCH_LAN_ADDRESS = lan!.address;
  const hostToken = "h".repeat(64);
  const occupied = createSocket("udp4");
  let hub: Awaited<ReturnType<typeof createHub>> | undefined;
  t.after(async () => {
    try { occupied.close(); } catch {}
    await hub?.close();
    if (previousInterface === undefined) delete process.env.COUCH_LAN_INTERFACE; else process.env.COUCH_LAN_INTERFACE = previousInterface;
    if (previousAddress === undefined) delete process.env.COUCH_LAN_ADDRESS; else process.env.COUCH_LAN_ADDRESS = previousAddress;
    await rm(directory, { recursive: true, force: true });
  });
  occupied.bind(0, lan!.address);
  await once(occupied, "listening");
  const port = occupied.address().port;
  hub = await createHub({ databasePath: join(directory, "couch.sqlite"), hostToken, hostname: "127.0.0.1", port, managedLan: true, remoteControlEnabled: true });
  const https = `https://${lan!.address}:${port}`;
  const deadline = Date.now() + 3000;
  while (!hub.urls.includes(https)) { assert.ok(Date.now() < deadline, "LAN HTTPS did not start"); await new Promise(resolve => setTimeout(resolve, 10)); }
  const ca = await readFile(join(directory, "tls/cert.pem"), "utf8");
  const status = await new Promise<number | undefined>((resolve, reject) => {
    const request = get(`${https}/api/health`, { ca, allowPartialTrustChain: true, agent: false }, response => { response.resume(); response.on("end", () => resolve(response.statusCode)); });
    request.on("error", reject); request.setTimeout(1000, () => request.destroy(new Error("TLS request timed out")));
  });
  assert.equal(status, 200);
  const connection = () => fetch(`${hub!.origin}/api/live/ice-servers`, { headers: { Authorization: `Bearer ${hostToken}` } }).then(response => response.json());
  assert.deepEqual(await connection(), []);
  const sharing = (enabled: boolean) => fetch(`${hub!.origin}/api/settings/sharing`, { method: "POST", headers: { Authorization: `Bearer ${hostToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ enabled }) });
  occupied.close();
  assert.equal((await sharing(false)).status, 200);
  assert.equal((await sharing(true)).status, 200);
  assert.deepEqual(await connection(), [{ urls: `stun:${lan!.address}:${port}` }]);
  await assert.rejects(serveLiveStun(lan!, port), { code: "EADDRINUSE" });
  assert.equal((await sharing(false)).status, 200);
  const replacement = await serveLiveStun(lan!, port);
  await replacement.stop();
});
