// Opt-in Linux measurement; see README.md. Only the renderer acknowledgement is a fixture.
import cp from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { createHub } from "../../src/server/hub";
import { startHelpers, helper } from "../../src/server/helpers";
import { readStatus } from "../../src/server/helper-status";
import type { ServerMessage, SessionState } from "../../src/shared/protocol";

declare const COUCH_BENCH_REVISION: string;
const data = process.env.COUCH_DATA_DIR, port = Number(process.env.COUCH_PORT);
if (!data || !Number.isInteger(port) || port < 1024 || port > 65535 || !process.argv[2]) throw new Error("Set a scratch COUCH_DATA_DIR and COUCH_PORT, and pass an output JSON path.");
if (process.platform !== "linux") throw new Error("This measurement requires Linux /proc.");
if (typeof COUCH_BENCH_REVISION === "undefined" || !/^[a-f0-9]{40}$/.test(COUCH_BENCH_REVISION)) throw new Error("Build with COUCH_BENCH_REVISION set to the measured source commit; see README.md.");
const output = resolve(process.argv[2]), label = process.env.COUCH_BENCH_LABEL ?? "current";
type Sample = { inspect: boolean; stdoutBytes: number; cpuSeconds: number; peakRssKiB: number; ms?: number; exitCode?: number | null };
const ticks = Number(cp.execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" }).trim());
const spawn = cp.spawn, processes: Sample[] = [];
// Observe the real executable without changing selection, arguments or transport.
cp.spawn = ((file: string, args: string[], options: cp.SpawnOptions) => {
  const child = spawn(file, args, options);
  if (args.includes("--dump-single-json")) {
    const sample: Sample = { inspect: args.includes("--ignore-no-formats-error"), stdoutBytes: 0, cpuSeconds: 0, peakRssKiB: 0 };
    processes.push(sample);
    const started = performance.now();
    child.stdout?.on("data", chunk => { sample.stdoutBytes += Buffer.byteLength(chunk); });
    const timer = setInterval(() => {
      try {
        const stat = readFileSync(`/proc/${child.pid}/stat`, "utf8").split(") ")[1]!.split(" ");
        sample.cpuSeconds = (Number(stat[11]) + Number(stat[12])) / ticks;
        const status = readFileSync(`/proc/${child.pid}/status`, "utf8");
        sample.peakRssKiB = Math.max(sample.peakRssKiB, Number(/VmRSS:\s+(\d+)/.exec(status)?.[1] ?? 0));
      } catch { /* A helper can exit between samples. */ }
    }, 20);
    child.once("close", code => { clearInterval(timer); sample.ms = performance.now() - started; sample.exitCode = code; });
  }
  return child;
}) as typeof cp.spawn;
syncBuiltinESMExports();
startHelpers(join(data, "helpers"));
await Promise.all([helper("yt-dlp"), helper("qjs"), helper("ffmpeg")]);
const { selected } = await readStatus(join(data, "helpers"));
const toolchain = { node: process.version, platform: process.platform, arch: process.arch,
  helpers: Object.fromEntries(Object.entries(selected).map(([name, choice]) => [name, { version: choice.version, origin: choice.origin }])) };
const database = mkdtempSync(join(data, "youtube-measure-")), token = randomBytes(32).toString("hex"), id = "h".repeat(43);
const hub = await createHub({ databasePath: join(database, "couch.sqlite"), hostToken: token, hostname: "127.0.0.1", port, streamingCommunityFetch: async () => new Response("", { status: 503 }) });
const socket = new WebSocket(`${hub.origin.replace("http:", "ws:")}/api/ws?token=${token}&device=${id}&tv=1`, { headers: { Origin: hub.origin } });
let state: SessionState | undefined, loadMs: number | undefined, started = 0;
socket.onmessage = event => {
  const message = JSON.parse(String(event.data)) as ServerMessage;
  if (message.type === "state") state = message.state;
  if (message.type === "text") socket.send(JSON.stringify({ type: "textResult", requestId: message.requestId, ok: true }));
  if (message.type === "player" && message.command.type === "load") {
    loadMs = performance.now() - started;
    socket.send(JSON.stringify({ type: "player", state: { playbackId: message.command.playbackId, status: "playing", position: 0, duration: 18.933, volume: 80, seekable: true, buffering: false, error: null, speed: 1, tracks: [], audioDelay: 0, subtitleDelay: 0 } }));
  }
};
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 40_000;
  while (!predicate()) { assert.ok(Date.now() < deadline, "Measurement deadline"); await new Promise(resolve => setTimeout(resolve, 20)); }
}
try {
  await until(() => !!state);
  started = performance.now();
  socket.send(JSON.stringify({ type: "command", requestId: "play", action: { type: "enqueueWeb", entryId: "measured", url: "https://www.youtube.com/watch?v=jNQXAC9IVRw", playNow: true } }));
  await until(() => loadMs !== undefined && processes.length > 0 && processes.every(sample => sample.exitCode !== undefined));
  const entry = state?.queue[0];
  const result = { revision: COUCH_BENCH_REVISION, toolchain, sampledAt: new Date().toISOString(), sampleIntervalMs: 20, label, loadMs, processes, extractions: processes.length, totalHelperCpuSeconds: processes.reduce((total, sample) => total + sample.cpuSeconds, 0), totalStdoutBytes: processes.reduce((total, sample) => total + sample.stdoutBytes, 0), metadata: { title: entry?.title, duration: entry?.duration, creator: entry?.creator, thumbnail: !!entry?.thumbnail } };
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result));
} finally {
  socket.terminate();
  await hub.close();
  rmSync(database, { recursive: true, force: true });
}
