// After bun run build: xvfb-run -a node_modules/.bin/bun tests/live-host.native.ts [evidence directory].
// Real Main/preload/Core with Chromium's documented WAV input, never a physical device.
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import electron from "electron";

const root = resolve(import.meta.dirname, "..");
const directory = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "couch-live-host-"));
mkdirSync(directory, { recursive: true });
// Chromium loops a WAV with --use-file-for-fake-audio-capture. Distinct channels
// provide stereo at the input, without duplicating a mono MediaStream/AudioData.
// https://chromium.googlesource.com/chromium/src/+/main/media/base/media_switches.cc
const wave = join(directory, "stereo.wav"), rate = 48000, frames = rate * 2;
const pcm = Buffer.alloc(44 + frames * 4);
pcm.write("RIFF"); pcm.writeUInt32LE(pcm.length - 8, 4); pcm.write("WAVEfmt ", 8);
pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(2, 22);
pcm.writeUInt32LE(rate, 24); pcm.writeUInt32LE(rate * 4, 28); pcm.writeUInt16LE(4, 32); pcm.writeUInt16LE(16, 34);
pcm.write("data", 36); pcm.writeUInt32LE(frames * 4, 40);
for (let i = 0; i < frames; i++) for (let channel = 0; channel < 2; channel++)
  pcm.writeInt16LE(Math.round(6000 * Math.sin(2 * Math.PI * (channel ? 659 : 431) * i / rate)), 44 + i * 4 + channel * 2);
writeFileSync(wave, pcm);

const server = createServer();
await new Promise<void>((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
const { port } = server.address() as { port: number };
await new Promise<void>(resolve => server.close(() => resolve()));
const run = join(directory, "stereo"), scratch = join(run, "probe"), data = join(run, "data");
mkdirSync(scratch, { recursive: true }); mkdirSync(data, { recursive: true });
cpSync(join(root, "packaging/icons"), join(scratch, "packaging/icons"), { recursive: true });
cpSync(join(root, "tests/fixtures/live-host-probe.mjs"), join(scratch, "probe.mjs"));
writeFileSync(join(scratch, "package.json"), JSON.stringify({ name: "couch-live-host-probe", version: "0.4.0", identifier: "quest.avoid.couch", type: "module", main: "probe.mjs" }));
writeFileSync(join(data, "operating-mode.json"), JSON.stringify({ mode: "local", address: null, targets: [], localSetupComplete: true }));
writeFileSync(join(scratch, "config.json"), JSON.stringify({ wave, evidence: join(run, "events.json"), main: pathToFileURL(join(root, "build/main.mjs")).href, port }));
const { ELECTRON_RUN_AS_NODE: _, COUCH_TV_PRESENTATION: __, ...env } = process.env;
const output = Bun.file(join(run, "electron-output.log"));
const child = Bun.spawn([electron as unknown as string, scratch], {
  cwd: root, env: { ...env, COUCH_DATA_DIR: data, COUCH_PORT: String(port) }, stdout: output, stderr: output,
});
writeFileSync(join(run, "launched-pid"), `${child.pid}\n`);
const deadline = setTimeout(() => child.kill("SIGTERM"), 120_000);
let code: number;
try { code = await child.exited; } finally { clearTimeout(deadline); }
const evidence = JSON.parse(readFileSync(join(run, "events.json"), "utf8"));
assert.equal(evidence.error, undefined, evidence.error);
assert.equal(evidence.passed, true, `See ${run}`);
assert.equal(code, 0, `Native app must quit cleanly; see ${run}`);
for (const pid of evidence.pids) assert.throws(() => process.kill(pid, 0), /ESRCH/, `Owned process ${pid} must exit`);
assert.equal(evidence.coreExitedBeforeApp, true);
assert.equal(evidence.captureStoppedBeforeCore, true, "Quit stops capture before shutting down Core");
await assert.rejects(fetch(`http://127.0.0.1:${port}/api/connection`), /fetch failed|Unable to connect/);
console.log(`Hidden Live stereo capture lifecycle passed: ${run}`);
