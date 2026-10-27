// After bun run build:
//   bun build tests/live-fanout.performance.ts --target=node --outfile=build/live-fanout.performance.mjs
//   nice -n 19 node build/live-fanout.performance.mjs <evidence directory> [pcm|opus ...]
// A scratch Core on the LAN HTTPS address streams the capture fixture to fixture listeners in a separate
// process, so their CPU doesn't count against Core. Core's threads are read from /proc (Linux only).
// COUCH_FANOUT_STEPS (1,10,25,50), COUCH_FANOUT_SECONDS (20) and COUCH_CPU_PROF=1 (V8 profiles of each Core thread).
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, release } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { Identity } from "@sonn-audio/node-sendspin";
import WebSocket from "ws";
import { buildInfo } from "../src/shared/build";
import { createHub } from "../src/server/hub";
import { openStore } from "../src/server/store";
import { readLivePacket } from "../src/server/live-packet";
import { prepareNativeCapture } from "../app/native-capture";
import type { Action, ServerMessage } from "../src/shared/protocol";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => unknown, label: string, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (!await check()) { assert(Date.now() < deadline, label); await sleep(20); }
}
const hostToken = "h".repeat(64), sourceId = "fanout", uploadToken = "1".repeat(64);
const steps = (process.env.COUCH_FANOUT_STEPS ?? "1,10,25,50").split(",").map(Number), seconds = Number(process.env.COUCH_FANOUT_SECONDS ?? 20);
type Device = { id: string; token: string };
const quantile = (values: number[], q: number) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]! : NaN; };

if (process.argv.includes("--core")) {
  Object.assign(buildInfo, JSON.parse(readFileSync("build/build-info.json", "utf8")));
  const databasePath = join(process.env.COUCH_DATA_DIR!, "couch.sqlite"), store = openStore(databasePath, true);
  const devices: Device[] = Array.from({ length: Math.max(...steps) }, (_, i) => { const id = Identity.generate().peerId; return { id, token: store.pair(id, `Listener ${i + 1}`) }; });
  store.close();
  const hub = await createHub({ databasePath, hostToken, port: Number(process.env.COUCH_PORT), managedLan: true, remoteControlEnabled: true, advertisedUrls: [] });
  let urls: string[] = [];
  await until(async () => { urls = (await (await fetch(`${hub.origin}/api/connection`)).json()).urls; return urls.some(url => url.startsWith("https:")); }, "LAN listener starts");
  process.send!({ devices, origin: urls.find(url => url.startsWith("https:")) });
  process.on("SIGTERM", () => void hub.close().then(() => process.exit()));
} else if (process.argv.includes("--listeners")) {
  // Like the browser listener: pings every 50 ms, one stats report a second, the clock from the quickest pong.
  type Listener = { arrivals: number[]; ages: number[]; gapMax: number; last: number; offsetUs: number; rtt: number; packets: number };
  const listeners: Listener[] = [], options = { rejectUnauthorized: false, headers: {} as Record<string, string> };
  let origin = "";
  const join = async (device: Device) => {
    options.headers = { Origin: origin };
    const ws = new WebSocket(`${origin.replace("https:", "wss:")}/api/ws?token=${device.token}&device=${device.id}`, options);
    const messages: ServerMessage[] = [];
    ws.on("message", data => messages.push(JSON.parse(String(data)))); ws.on("error", () => {});
    await until(() => messages.some(message => message.type === "state"), "listener window connects");
    ws.send(JSON.stringify({ type: "command", requestId: "1", action: { type: "playLive", sourceId, deviceId: device.id, picture: false, sound: true } satisfies Action }));
    await until(() => messages.some(message => message.type === "result" && message.requestId === "1"), "playLive");
    const result = messages.find(message => message.type === "result")!;
    assert(result.type === "result" && result.ok, result.type === "result" ? result.error : "");
    const l: Listener = { arrivals: [], ages: [], gapMax: 0, last: 0, offsetUs: 0, rtt: Infinity, packets: 0 };
    const socket = new WebSocket(`${origin.replace("https:", "wss:")}/api/live/listen?${new URLSearchParams({ token: device.token, sourceId })}`, options);
    socket.on("error", () => {});
    socket.on("message", (data, binary) => {
      const now = performance.now();
      if (binary) {
        const packet = readLivePacket(data as Buffer);
        if (l.last) l.gapMax = Math.max(l.gapMax, now - l.last);
        l.last = now; l.packets++;
        if (l.rtt < Infinity) l.ages.push(now * 1000 + l.offsetUs - packet.captureUs);
        return;
      }
      const message = JSON.parse(String(data));
      if (message.type === "pong") { const rtt = now - message.t; if (rtt < l.rtt) { l.rtt = rtt; l.offsetUs = message.s - (message.t + now) / 2 * 1000; } }
    });
    await new Promise(resolve => socket.once("open", resolve));
    const ping = setInterval(() => socket.readyState === 1 && socket.send(JSON.stringify({ type: "ping", t: performance.now() })), 50);
    const stats = setInterval(() => socket.readyState === 1 && socket.send(JSON.stringify({ type: "stats", needMs: 20, leadMs: 100, deadlineMarginMinMs: 60, marginMinMs: 60, debtMs: 0, missing: 0 })), 1000);
    socket.once("close", () => { clearInterval(ping); clearInterval(stats); });
    await until(() => l.packets > 0, "listener receives audio");
    listeners.push(l);
  };
  process.on("message", async (message: { origin?: string; devices?: Device[]; measure?: boolean }) => {
    if (message.origin) origin = message.origin;
    if (message.devices) { await Promise.all(message.devices.map(join)); process.send!({ joined: listeners.length }); }
    if (message.measure) {
      for (const l of listeners) { l.ages = []; l.gapMax = 0; l.packets = 0; }
      await sleep(seconds * 1000);
      const ages = listeners.flatMap(l => l.ages);
      process.send!({ measured: { packetsPerSecond: quantile(listeners.map(l => l.packets / seconds), 0), arrivalAgeMs: { p50: quantile(ages, 0.5) / 1000, p99: quantile(ages, 0.99) / 1000, max: quantile(ages, 1) / 1000 }, gapMaxMs: Math.max(...listeners.map(l => l.gapMax)) } });
    }
  });
} else {
  const directory = resolve(process.argv[2] ?? ".artifacts/live-fanout"), codecs = process.argv.slice(3).length ? process.argv.slice(3) : ["pcm", "opus"];
  mkdirSync(directory, { recursive: true });
  const ticks = 100; // USER_HZ
  const threads = (pid: number) => Object.fromEntries(readdirSync(`/proc/${pid}/task`).map(tid => {
    const stat = readFileSync(`/proc/${pid}/task/${tid}/stat`, "utf8"), fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return [`${tid}`, { name: readFileSync(`/proc/${pid}/task/${tid}/comm`, "utf8").trim(), user: Number(fields[11]) / ticks, system: Number(fields[12]) / ticks }];
  }));
  const results: Record<string, unknown>[] = [];
  for (const codec of codecs) {
    const data = join(directory, `data-${codec}`); mkdirSync(data, { recursive: true });
    const portServer = createServer(); await new Promise<void>(resolve => portServer.listen(0, "127.0.0.1", resolve));
    const port = (portServer.address() as { port: number }).port;
    await new Promise<void>(resolve => portServer.close(() => resolve()));
    const children: ChildProcess[] = [];
    try {
      const profile = process.env.COUCH_CPU_PROF ? ["--cpu-prof", "--cpu-prof-dir", join(directory, `profile-${codec}`)] : [];
      const core = spawn(process.execPath, [...profile, process.argv[1]!, "--core"], { env: { ...process.env, COUCH_DATA_DIR: data, COUCH_PORT: String(port) }, stdio: ["ignore", "pipe", "pipe", "ipc"] });
      children.push(core);
      const log: string[] = [];
      for (const stream of [core.stdout!, core.stderr!]) stream.on("data", chunk => log.push(...String(chunk).split("\n").filter(Boolean)));
      const config = await new Promise<{ devices: Device[]; origin: string }>((resolve, reject) => { core.once("message", value => resolve(value as never)); core.once("exit", code => reject(new Error(`Core exited (${code}): ${log.join("\n")}`))); });
      const hostMessages: ServerMessage[] = [];
      const host = new WebSocket(`ws://127.0.0.1:${port}/api/ws?token=${hostToken}&device=${Identity.generate().peerId}`, { headers: { Origin: `http://127.0.0.1:${port}` } });
      host.on("message", value => hostMessages.push(JSON.parse(String(value)))); host.on("error", () => {});
      await until(() => hostMessages.some(message => message.type === "state"), "host connected");
      const saved = await fetch(`http://127.0.0.1:${port}/api/settings/live-audio`, { method: "POST", headers: { Authorization: `Bearer ${hostToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ settings: { codec, lead: "fixed", leadMs: 100, maxLeadMs: 100 } }) });
      assert.equal(saved.status, 200);
      host.send(JSON.stringify({ type: "command", requestId: "publish", action: { type: "publishLive", sourceId, uploadToken, kind: "microphone", audio: true, video: false, audioDelivery: "pcm", intent: "live" } satisfies Action }));
      await until(() => hostMessages.some(message => message.type === "livePeers" && message.upload), "upload demand");
      const demand = hostMessages.findLast(message => message.type === "livePeers" && message.upload) as Extract<ServerMessage, { type: "livePeers" }>;
      const helper = spawn(process.execPath, [resolve("tests/fixtures/native-capture-helper.mjs"), "stream"], { stdio: ["pipe", "pipe", "pipe"] });
      children.push(helper);
      const capture = await prepareNativeCapture(helper, { sampleRate: 48000, requestedCallbackFrames: 128 }, error => { throw error; });
      await capture.upload(`ws://127.0.0.1:${port}/api/live/upload?${new URLSearchParams({ token: hostToken, key: uploadToken, sourceId, uploadId: demand.uploadId! })}`);
      const fixture = spawn(process.execPath, [process.argv[1]!, "--listeners"], { stdio: ["ignore", "inherit", "inherit", "ipc"] });
      children.push(fixture);
      const ask = <T>(message: unknown, key: string) => new Promise<T>(resolve => { const on = (reply: Record<string, T>) => { if (key in reply) { fixture.off("message", on); resolve(reply[key]!); } }; fixture.on("message", on); fixture.send(message as never); });
      fixture.send({ origin: config.origin });
      let joined = 0;
      for (const listeners of steps) {
        await ask({ devices: config.devices.slice(joined, listeners) }, "joined"); joined = listeners;
        // Send age is logged per ten seconds: settle past the joins first.
        await sleep(11_000);
        const before = threads(core.pid!), fixtureBefore = Object.values(threads(fixture.pid!)), from = log.length, started = performance.now();
        const measured = await ask<Record<string, unknown>>({ measure: true }, "measured");
        const after = threads(core.pid!), fixtureAfter = Object.values(threads(fixture.pid!)), wall = (performance.now() - started) / 1000;
        const busy = (all: { user: number; system: number }[]) => all.reduce((sum, thread) => sum + thread.user + thread.system, 0);
        const percent = (seconds: number) => Math.round(seconds / wall * 1000) / 10;
        const usage = Object.entries(after).map(([tid, { name, user, system }]) => ({ tid, name, percent: percent(user + system - (before[tid] ? before[tid].user + before[tid].system : 0)), systemPercent: percent(system - (before[tid]?.system ?? 0)) }));
        const worker = usage.filter(thread => thread.name === "WorkerThread").sort((a, b) => b.percent - a.percent)[0];
        const ages = log.slice(from).map(line => /send age \w+ max ([\d.]+) ms, mean ([\d.]+) ms over (\d+) packets(?:; (\d+) past)?/.exec(line)).filter(match => !!match);
        const main = usage.find(thread => thread.tid === String(core.pid))!;
        const result = { codec, listeners, mainPercent: main.percent, mainSystemPercent: main.systemPercent, workerPercent: worker?.percent, workerSystemPercent: worker?.systemPercent, processPercent: Math.round(usage.reduce((sum, thread) => sum + thread.percent, 0) * 10) / 10, fixturePercent: percent(busy(fixtureAfter) - busy(fixtureBefore)),
          sendAgeMs: { max: Math.max(...ages.map(match => Number(match[1]))), mean: ages.reduce((sum, match) => sum + Number(match[2]), 0) / Math.max(1, ages.length), late: ages.reduce((sum, match) => sum + Number(match[4] ?? 0), 0) }, ...measured, threads: usage.filter(thread => thread.percent >= 1) };
        console.log(JSON.stringify(result));
        results.push(result);
      }
      await capture.stop();
    } finally {
      for (const child of children.reverse()) if (child.exitCode === null) { child.kill("SIGTERM"); await new Promise(resolve => { child.once("exit", resolve); setTimeout(resolve, 5000); }); }
    }
  }
  writeFileSync(join(directory, "result.json"), JSON.stringify({ cpu: cpus()[0]?.model, cores: cpus().length, os: release(), node: process.version, seconds, results }, null, 2));
}
