// bun build tests/live-audio.bench.ts --target=node --outfile=/tmp/couch-live-bench.mjs
// COUCH_TEST_FFMPEG=/path/to/ffmpeg nice -n 19 node /tmp/couch-live-bench.mjs
// Optional: --seconds=30 --warmup=3 --listeners=1,10,50 --codecs=pcm,opus
// Add node --cpu-prof --cpu-prof-dir=/tmp/profiles to profile each isolate.
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { createHistogram, monitorEventLoopDelay } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import { WebSocketServer } from "ws";
import { AudioCodec, Roles, SendspinClient, SendspinSession, serverNowUs } from "@sonn-audio/node-sendspin";
import { createScheduledAudio } from "../src/server/scheduled-audio";

type Case = { listeners: number; codec: "pcm" | "opus"; seconds: number; warmup: number };
const bufferMs = 200;

async function measure(config: Case) {
  const delays = createHistogram(), lag = monitorEventLoopDelay({ resolution: 1 });
  let measuring = false, timer: ReturnType<typeof setInterval> | undefined;
  const send = SendspinSession.prototype.sendPcmAudioFrame;
  // Test-only observation of the public boundary; always call the stock SDK.
  // Fixed declarations make timestampUs - lead exactly the mapped capture time,
  // including Opus pre-skip. No production diagnostics or SDK files are changed.
  SendspinSession.prototype.sendPcmAudioFrame = function (frame) {
    if (measuring) delays.record(Math.max(1, Math.round(serverNowUs() - (frame.timestampUs! - bufferMs * 1000))));
    return send.call(this, frame);
  };
  const audio = createScheduledAudio({ name: "Live benchmark", admit: () => true, changed() {},
    ffmpeg: async () => process.env.COUCH_TEST_FFMPEG ?? "ffmpeg",
    sourceFailed: (_id, error) => { throw new Error(error); },
  });
  const server = createServer(), sockets = new WebSocketServer({ server });
  sockets.on("connection", (socket, request) => audio.accept(socket, request));
  const group = audio.group("bench", state => { if (state.error) throw new Error(state.error); });
  try {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    parentPort!.postMessage({ type: "ready", port: (server.address() as { port: number }).port });
    await once(parentPort!, "message");
    const deadline = Date.now() + 5000;
    while (audio.status().delays.length !== config.listeners) {
      assert.ok(Date.now() < deadline, "all player declarations must arrive before capture");
      await sleep(10);
    }
    audio.registerSource("capture");
    group.members(Array.from({ length: config.listeners }, (_, i) => ({ deviceId: `listener-${i}`, level: 100 })));
    group.send({ type: "load", playbackId: "bench", source: "", liveSourceId: "capture", captureIntent: "live" });
    // One repeating 10 ms stereo block; no hardware, decode, disk IO or signal
    // generation inside the measured loop. Opposite channels match integration fixtures.
    const pcm = new Float32Array(960);
    for (let i = 0; i < 480; i++) { pcm[2 * i] = Math.sin(i * 2 * Math.PI * 1000 / 48000) * .2; pcm[2 * i + 1] = -pcm[2 * i]!; }
    let sequence = 0;
    const origin = serverNowUs();
    timer = setInterval(() => {
      const due = Math.floor((serverNowUs() - origin) / 10_000);
      while (sequence < due) {
        assert.equal(audio.writeSource("capture", { generation: "bench", sequence, samplePosition: sequence * 480,
          capturedAtUs: origin + sequence * 10_000, sampleRate: 48000, channels: 2, pcm }), true);
        sequence++;
      }
    }, 5);
    await sleep(config.warmup * 1000);
    lag.enable();
    measuring = true;
    const cpu = process.threadCpuUsage(), start = performance.now();
    await sleep(config.seconds * 1000);
    const elapsed = (performance.now() - start) / 1000, used = process.threadCpuUsage(cpu);
    measuring = false;
    lag.disable();
    const memory = process.memoryUsage();
    assert.ok(delays.count > config.listeners * config.seconds * 180, `too few sends: ${delays.count}`);
    const round = (n: number) => Math.round(n * 100) / 100;
    parentPort!.postMessage({ type: "result", ...config, seconds: round(elapsed), sends: delays.count,
      delayP50Ms: round(delays.percentile(50) / 1000), delayP99Ms: round(delays.percentile(99) / 1000),
      workerCpuMsPerSecond: round((used.user + used.system) / 1000 / elapsed),
      workerCpuMsPerListenerSecond: round((used.user + used.system) / 1000 / elapsed / config.listeners),
      loopP99Ms: round(lag.percentile(99) / 1e6),
      workerHeapMiB: round(memory.heapUsed / 2 ** 20), workerExternalMiB: round(memory.external / 2 ** 20),
      processRssMiB: round(memory.rss / 2 ** 20),
    });
    await once(parentPort!, "message");
  } finally {
    clearInterval(timer); lag.disable(); group.close(); audio.close();
    SendspinSession.prototype.sendPcmAudioFrame = send;
    sockets.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    parentPort!.close();
  }
}

async function run(config: Case) {
  const worker = new Worker(new URL(import.meta.url), { workerData: config });
  const clients: SendspinClient[] = [], received: number[] = [];
  try {
    const [ready] = await once(worker, "message");
    const result = once(worker, "message");
    for (let i = 0; i < config.listeners; i++) {
      const client = new SendspinClient(`listener-${i}`, `Listener ${i}`, [Roles.PLAYER], { playerSupport: {
        supported_formats: [{ codec: config.codec === "pcm" ? AudioCodec.PCM : AudioCodec.OPUS, sample_rate: 48000, channels: 2, bit_depth: 16 }],
        buffer_capacity: 1 << 20, supported_commands: [],
      } });
      received[i] = 0;
      client.addAudioChunkListener(() => { received[i]!++; });
      clients.push(client);
      await client.connect(`ws://127.0.0.1:${ready.port}`);
      await client.sendPlayerState({ min_buffer_ms: bufferMs, static_delay_ms: 0 });
    }
    worker.postMessage("start");
    const [measured] = await result;
    assert.ok(received.every(count => count > config.seconds * 180), "every SDK client must receive real audio");
    console.log(JSON.stringify(measured));
    const exited = once(worker, "exit");
    await Promise.all(clients.map(client => client.disconnect()));
    worker.postMessage("close");
    await exited;
  } finally {
    await Promise.all(clients.map(client => client.disconnect()));
    await worker.terminate();
  }
}

if (isMainThread) {
  const args = new Map(process.argv.slice(2).map(arg => {
    const [name, value] = arg.replace(/^--/, "").split("=");
    return [name, value] as const;
  }));
  const seconds = Number(args.get("seconds") ?? 30), warmup = Number(args.get("warmup") ?? 3);
  assert.ok(seconds > 0 && warmup >= 0);
  for (const codec of (args.get("codecs") ?? "pcm,opus").split(",")) {
    assert.ok(codec === "pcm" || codec === "opus");
    for (const listeners of (args.get("listeners") ?? "1,10,50").split(",").map(Number)) {
      assert.ok(Number.isInteger(listeners) && listeners > 0);
      await run({ listeners, codec, seconds, warmup });
    }
  }
} else await measure(workerData as Case);
