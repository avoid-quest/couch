// Build this for Node and live-r4.browser.ts as a minified browser IIFE with
// --define 'import.meta.url="http://localhost/unused-receiver-worker"'. Start
// with COUCH_TEST_FFMPEG and COUCH_EVIDENCE, navigate to the printed Hub origin,
// load /bundle from the control origin, and call runR4Browser(controlOrigin).
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { liveFixture, until } from "./live-input.fixture";
import { ffmpeg, ingests, recording, speaker, start } from "./live-r4.fixture";

const evidence = resolve(process.env.COUCH_EVIDENCE ?? ".scratch/player-modes/r4/browser");
await mkdir(evidence, { recursive: true });
const pageName = `live-r4-${process.pid}.html`;
const pagePath = resolve("dist", pageName);
await mkdir("dist", { recursive: true });
await writeFile(pagePath, "<!doctype html><title>R4 media regression</title><body></body>");
const f = await liveFixture({ media: { ffmpeg, recording: await recording(90) }, extraDevices: 1 });
let sound: Awaited<ReturnType<typeof speaker>> | undefined, closed = false;
const close = async () => {
  if (closed) return;
  closed = true;
  const encoders = f.encoders(), pids = [...f.capturePids(), ...encoders.map(encoder => encoder.pid)];
  await sound?.client.disconnect();
  await f.close();
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await rm(pagePath, { force: true });
  for (const pid of pids) assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  for (const encoder of encoders.filter(encoder => encoder.args.includes("-f tee"))) await assert.rejects(access(encoder.cwd));
  await writeFile(resolve(evidence, "cleanup.json"), JSON.stringify({ pids, stopped: true, ingestDirectoriesRemoved: true, fixturePageRemoved: true }));
};
const command = async (action: Parameters<typeof f.publisher.command>[0]) => { const result = await f.publisher.command(action); assert.equal(result.ok, true, result.error); };
const output = (index: number, level: number, picture: boolean) => command({ type: "output", deviceId: f.identities[index]!.id, level, picture });
const server = createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (request.method === "OPTIONS") { response.end(); return; }
  const path = new URL(request.url!, "http://localhost").pathname;
  try {
    let value: unknown = { ok: true };
    if (path === "/config") value = { page: `${f.hub.origin}/${pageName}`, clients: f.identities.slice(1).map(identity => ({ id: identity.id, token: identity.token, key: identity.key.privateB64u })) };
    else if (path === "/bundle") { response.setHeader("Content-Type", "text/javascript"); response.end(await readFile("build/live-r4.browser.js")); return; }
    else if (request.method !== "POST") throw new Error("Use POST for fixture actions.");
    else if (path === "/add-picture") await output(2, 50, true);
    else if (path === "/split") {
      await f.connect(1, "&audio=1&video=1");
      sound = await speaker(f, 1);
      await output(2, 0, true);
      await output(1, 100, false);
      await command({ type: "inSync", inSync: true });
    } else if (path === "/add-late") await output(3, 0, true);
    else if (path === "/restart") {
      const count = sound!.frames.length, starts = sound!.starts, clears = sound!.clears;
      await output(1, 0, false); // Retire the sticky fallback before dropping buffered demand.
      await command({ type: "inSync", inSync: false });
      await until(() => f.uploads.size === 0);
      await new Promise(resolve => setTimeout(resolve, 1500));
      await command({ type: "inSync", inSync: true });
      await output(1, 100, false);
      await until(() => sound!.frames.length >= count + 5);
      assert.equal(ingests(f).length, 2);
      value = { frames: sound!.frames.length, previousFrames: count, startsBeforeRestart: starts, clearsBeforeRestart: clears, ingests: ingests(f).length };
    } else if (path === "/receipt") {
      const bytes: Buffer[] = [];
      for await (const chunk of request) bytes.push(Buffer.from(chunk));
      await writeFile(resolve(evidence, "result.json"), Buffer.concat(bytes));
    } else if (path === "/end") {
      await command({ type: "endLive", sourceId: "screen" });
      setTimeout(() => void close(), 100);
    } else throw new Error("Unknown fixture action.");
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(value));
  } catch (error) { response.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: String(error) })); }
});
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address(); assert.ok(address && typeof address !== "string");
await start(f);
const config = { page: `${f.hub.origin}/${pageName}`, control: `http://127.0.0.1:${address.port}` };
await writeFile(resolve(evidence, "fixture.json"), JSON.stringify(config));
console.log(JSON.stringify(config));
const timer = setTimeout(() => void close(), 180_000); timer.unref();
process.once("SIGTERM", () => void close());
