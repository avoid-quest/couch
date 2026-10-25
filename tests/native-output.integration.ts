import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { X509Certificate, randomUUID } from "node:crypto";
import { createServer } from "node:https";
import { createServer as tcpServer, type Socket } from "node:net";
import { Agent } from "node:https";
import { EventEmitter } from "node:events";
import type { WebContents } from "electron";
import { WebSocketServer } from "ws";
import { AudioCodec, Identity, PlayerCommand, Roles, SendspinClient, SendspinCore, SENTINEL_RESOLVED, serverNowUs, type SendspinSession } from "@sonn-audio/node-sendspin";
import { exportSendspinClientIdentity, loadSendspinClientIdentity } from "@sendspin/sendspin-js";
import { audioPeerTls, certificatePin } from "../app/audio-peer";
import { nativeAudioOutput } from "../app/native-audio-output";
import { createLiveOutput } from "../app/live-output";

const until = async (predicate: () => boolean, ms = 4000) => {
  const end = Date.now() + ms;
  while (!predicate()) { assert.ok(Date.now() < end, "native output did not reach the expected state"); await new Promise(resolve => setTimeout(resolve, 5)); }
};

test("explicit browser identity export preserves the paired Device, including memory storage", () => {
  const entries = new Map<string, string>(), storage = { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); } };
  const browser = loadSendspinClientIdentity(storage), exported = exportSendspinClientIdentity(storage);
  assert.equal(exported.clientId, browser.clientId);
  assert.equal(Identity.fromPrivateB64u(exported.privateKey).peerId, browser.clientId);
  assert.equal("privateKey" in browser, false, "ordinary identity reads do not expose the key");
  assert.deepEqual(exportSendspinClientIdentity(storage), exported);
});

test("pinned native receiver uses one identity, preserves PCM/deadlines and controls, then fails on a gap", { timeout: 15000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), "couch-native-output-"));
  const helper = join(directory, "helper.mjs"), key = join(directory, "key.pem"), cert = join(directory, "cert.pem");
  await writeFile(helper, "#!/usr/bin/env node\n" + await readFile(resolve("tests/fixtures/native-playback-helper.mjs"), "utf8"));
  await chmod(helper, 0o700);
  // Couch serves a CA-signed leaf. A self-signed test certificate hides the need
  // to trust the explicitly pinned leaf as a partial chain anchor.
  const caKey = join(directory, "ca-key.pem"), caCert = join(directory, "ca.pem"), csr = join(directory, "leaf.csr");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=fixture-ca", "-keyout", caKey, "-out", caCert], { stdio: "ignore" });
  execFileSync("openssl", ["req", "-new", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=native-fixture", "-keyout", key, "-out", csr], { stdio: "ignore" });
  execFileSync("openssl", ["x509", "-req", "-in", csr, "-CA", caCert, "-CAkey", caKey, "-set_serial", "1", "-days", "1", "-out", cert], { stdio: "ignore" });
  const core = new SendspinCore(), certificate = await readFile(cert), server = createServer({ cert: certificate, key: await readFile(key) });
  const ws = new WebSocketServer({ server });
  let session: SendspinSession | undefined;
  const peerIds: string[] = [];
  core.configureServer({ name: "Native output fixture" });
  core.enableEncryption(Identity.generate(), id => {
    peerIds.push(id); core.registerHooks(id, { onIdentified: current => { session = current; } }); return SENTINEL_RESOLVED;
  });
  ws.on("connection", (socket, request) => core.handleConnection(socket, request));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `https://127.0.0.1:${(server.address() as { port: number }).port}`;
  const pin = certificatePin(new X509Certificate(certificate)), signal = new AbortController();
  const tls = await audioPeerTls(origin, pin, signal.signal), agent = new Agent(tls);
  let output: ReturnType<typeof nativeAudioOutput> | undefined;
  t.after(async () => {
    await output?.stop(); agent.destroy();
    for (const socket of ws.clients) socket.terminate(); ws.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });
  assert.equal(tls.rejectUnauthorized, true);
  await assert.rejects(audioPeerTls(origin, "wrong-pin", signal.signal), /certificate changed/);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(audioPeerTls(origin, pin, aborted.signal));
  assert.equal(ws.clients.size, 0, "certificate probes never open an application socket");
  const identity = Identity.generate(), receiverId = randomUUID(), events: Record<string, unknown>[] = [], failures: string[] = [];
  const request = { op: "start" as const, clientId: identity.peerId, privateKey: identity.privateB64u, receiverId, name: "Fixture", bufferMs: 20 };
  assert.throws(() => nativeAudioOutput(helper, origin, { ...request, clientId: Identity.generate().peerId }, { agent }, () => {}), /identity/);
  output = nativeAudioOutput(helper, origin, request, { agent }, error => failures.push(error), event => events.push(event));
  await output.ready;
  await until(() => session?.getOutputPreparation()?.state === "ready");
  assert.deepEqual(peerIds, [identity.peerId]);
  assert.deepEqual(session!.getOutputPreparation(), { receiverId, epoch: 0, state: "ready" });
  assert.equal(session!.getPlayerTiming().requiredLeadTimeMs, 31);
  session!.sendServerCommand(PlayerCommand.VOLUME, { volume: 37 });
  session!.sendServerCommand(PlayerCommand.MUTE, { mute: true });
  session!.sendServerCommand(PlayerCommand.SET_STATIC_DELAY, { static_delay_ms: 3 });
  await until(() => events.some(event => event.event === "fixture-control" && event.op === 1 && event.value === 37)
    && events.some(event => event.event === "fixture-control" && event.op === 2 && event.value === 1));
  session!.sendStreamStart({ codec: AudioCodec.PCM, sampleRate: 48000, bitDepth: 16, channels: 2 });
  const pcm = Buffer.from(Array.from({ length: 512 }, (_, i) => i % 256)), timestamp = serverNowUs() + 50000;
  for (let i = 0; i < 3; i++) session!.sendPcmAudioFrame({ data: pcm, timestampUs: Math.round(timestamp + i * 128e6 / 48000) });
  await until(() => events.filter(event => event.event === "write").length === 3);
  const received = events.filter(event => event.event === "fixture-packet");
  assert.deepEqual(received.map(event => event.sequence), [0, 1, 2]);
  assert.ok(received.every(event => event.pcm === pcm.toString("base64")));
  assert.ok(Math.abs(Number(received[1]!.target) - Number(received[0]!.target) - 128e6 / 48000) < 20, "PCM deadlines retain sample spacing");
  assert.deepEqual(failures, []);
  session!.sendServerCommand(PlayerCommand.SET_STATIC_DELAY, { static_delay_ms: 3 });
  session!.sendServerCommand(PlayerCommand.MUTE, { mute: false });
  await until(() => events.some(event => event.event === "fixture-control" && event.op === 2 && event.value === 0));
  assert.deepEqual(failures, [], "repeated delay and stream controls do not interrupt PCM");
  session!.sendPcmAudioFrame({ data: pcm, timestampUs: Math.round(timestamp + 4 * 128e6 / 48000) });
  await until(() => failures.length === 1 && events.some(event => event.event === "closed"));
  assert.match(failures[0]!, /missing or repeated/);
  assert.equal(events.filter(event => event.event === "write").length, 3);
  assert.equal(events.find(event => event.event === "closed")!.writtenFrames, 384);
  await output.stop();
  // Exercise the actual Main owner adapter with the same TLS/SDK/helper boundary.
  const owner = Object.assign(new EventEmitter(), { mainFrame: { url: origin + "/", detached: false }, isDestroyed: () => false, send() {} });
  const manager = createLiveOutput(() => owner as unknown as WebContents, () => origin, () => pin, "http://localhost:48414", helper);
  t.after(() => manager.stop());
  const secondId = randomUUID();
  await manager.action({ ...request, receiverId: secondId });
  await until(() => session?.getOutputPreparation()?.receiverId === secondId && session?.getOutputPreparation()?.state === "ready");
  await manager.action({ op: "stop", receiverId }); // A delayed old stop cannot close its replacement.
  assert.equal(session!.getOutputPreparation()!.receiverId, secondId);
  owner.mainFrame.url = origin + "/settings";
  owner.emit("did-start-navigation", {}, owner.mainFrame.url, false, true);
  await manager.stop(); await until(() => ws.clients.size === 0);
});

test("disconnect during WebSocket preparation settles and closes its underlying connection", { timeout: 4000 }, async t => {
  const sockets = new Set<Socket>();
  const server = tcpServer(socket => { sockets.add(socket); socket.on("data", () => {}); socket.on("close", () => sockets.delete(socket)); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const client = new SendspinClient("fixture", "Fixture", [Roles.CONTROLLER]);
  t.after(async () => { await client.disconnect(); for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const connecting = client.connect(`ws://127.0.0.1:${(server.address() as { port: number }).port}`, { timeoutMs: 300 });
  const rejected = assert.rejects(connecting);
  await until(() => sockets.size === 1);
  await client.disconnect();
  await rejected; await until(() => sockets.size === 0);
});

test("Main cancels superseded/pre-ready requests and rejects an unrelated frame origin", async () => {
  const owner = Object.assign(new EventEmitter(), { mainFrame: { url: "http://localhost:48414/", detached: false }, isDestroyed: () => false, send() {} });
  const origin = "http://localhost:48414";
  const manager = createLiveOutput(() => owner as unknown as WebContents, () => origin, () => undefined, origin, process.execPath);
  const identity = Identity.generate(), receiverId = randomUUID();
  const request = { op: "start" as const, clientId: identity.peerId, privateKey: identity.privateB64u, receiverId, name: "Fixture", bufferMs: 20 };
  const pending = manager.action(request), rejected = assert.rejects(pending, /canceled/);
  await manager.action({ op: "stop", receiverId }); await rejected;
  owner.mainFrame.url = "https://unrelated.invalid/";
  await assert.rejects(manager.action(request), /current Couch/);
  await manager.stop();
});
