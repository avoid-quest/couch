// xvfb-run -a bun tests/native-input-process.native.ts
// A native input's upload keeps flowing to Core while Electron's main process is
// blocked for 400 ms. The same reader run inside main must show the stall, so the
// probe proves it can see one.
import electron from "electron";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { WebSocketServer } from "ws";
import { acceptCaptureUpload } from "../src/server/capture-ingest";

const blockMs = 400;
const directory = mkdtempSync(join(tmpdir(), "couch-native-input-"));
for (const [entry, output] of [
  ["app/native-audio-input.ts", "probe-input.mjs"],
  ["app/native-input-process.ts", "native-input.mjs"],
] as const) {
  const result = await Bun.build({
    entrypoints: [entry],
    target: "node",
    format: "esm",
    external: ["electron"],
  });
  if (!result.success) throw new AggregateError(result.logs, `${entry} build failed`);
  await Bun.write(join(directory, output), await result.outputs[0]!.text());
}
const executable = join(directory, "capture");
writeFileSync(
  executable,
  `#!${process.execPath}\nvoid import(${JSON.stringify(pathToFileURL(resolve("tests/fixtures/native-capture-helper.mjs")).href)});\n`,
  { mode: 0o700 },
);

const server = createServer(),
  sockets = new WebSocketServer({ server });
let arrivals: number[] = [];
sockets.on("connection", (socket) =>
  acceptCaptureUpload(
    socket,
    () => {
      arrivals.push(performance.timeOrigin + performance.now());
      return true;
    },
    (error) => console.error("ingest", error),
  ),
);
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert.ok(address && typeof address !== "string");
const url = `ws://127.0.0.1:${address.port}/api/live/upload`;

const probe = join(directory, "probe.mjs");
writeFileSync(
  probe,
  `import { app } from "electron";
import { setTimeout as sleep } from "node:timers/promises";
import { nativeAudioInput } from "./probe-input.mjs";
import { readNativeInput } from "./native-input.mjs";
app.whenReady().then(async () => {
  try {
    const open = process.argv.includes("--in-main") ? readNativeInput : nativeAudioInput;
    const source = open(${JSON.stringify(executable)},
      { uid: "test", name: "stream", channels: 2, nominalRate: 48000, ownerHalBufferFrames: 256 },
      48000, 128, (error) => { console.error("FAILED", error); app.exit(1); }, new AbortController().signal);
    await source.prepare();
    await source.command({ op: "upload", id: "source", uploadId: "probe", url: ${JSON.stringify(url)} });
    await sleep(1000);
    const start = Date.now();
    while (Date.now() - start < ${blockMs});
    console.log("BLOCK", start, Date.now());
    await sleep(1000);
    await source.stop();
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});`,
);

async function run(inMain: boolean) {
  arrivals = [];
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = Bun.spawn(
    [electron as unknown as string, probe, ...(inMain ? ["--in-main"] : [])],
    {
      env,
      stdout: "pipe",
      stderr: "inherit",
    },
  );
  const output = await new Response(child.stdout).text();
  assert.equal(await child.exited, 0, `probe ${inMain ? "in main" : "in its process"} failed`);
  const block = output.match(/BLOCK (\d+) (\d+)/);
  assert.ok(block, "probe blocked main");
  const [start, end] = [Number(block[1]), Number(block[2])];
  // The largest gap between packets that arrived around the block.
  let gap = 0;
  for (let i = 1; i < arrivals.length; i++)
    if (arrivals[i]! > start - 100 && arrivals[i - 1]! < end + 100)
      gap = Math.max(gap, arrivals[i]! - arrivals[i - 1]!);
  console.log(
    `${inMain ? "reader in main" : "reader process"}: ${arrivals.length} packets, main blocked ${end - start} ms, largest gap ${gap.toFixed(1)} ms`,
  );
  return gap;
}

try {
  assert.ok((await run(true)) > blockMs * 0.75, "the probe sees a stall when main reads");
  assert.ok((await run(false)) < 50, "a blocked main doesn't stop the reader process's upload");
  console.log("PASS: blocking main doesn't stop a native input's upload");
} finally {
  for (const socket of sockets.clients) socket.terminate();
  await new Promise<void>((done) => sockets.close(() => server.close(() => done())));
  rmSync(directory, { recursive: true, force: true });
}
