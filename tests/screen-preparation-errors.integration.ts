import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { helper, startHelpers } from "../src/server/helpers";
import { liveFixture, until } from "./live-input.fixture";
import { executableName } from "./executable.fixture";
import type { ServerMessage } from "../src/shared/protocol";

async function fixture(t: TestContext) {
  const f = await liveFixture({ extraDevices: 1 }), directory = dirname(f.executable);
  const failure = join(directory, "fail-picture"), gate = join(directory, "hold-picture"), runs = join(directory, "picture-runs.jsonl");
  writeFileSync(join(directory, executableName("qjs")), `#!${process.execPath}\nconsole.log('0.17.0');\n`, { mode: 0o755 });
  writeFileSync(join(directory, executableName("yt-dlp")), `#!${process.execPath}
const fs = require('node:fs');
if (process.argv.includes('--version')) { console.log('2026.10.21'); process.exit(0); }
const format = process.argv[process.argv.indexOf('--format') + 1] || '';
const picture = format.replace(/^\\(/, '').startsWith('bv[');
const fail = picture && fs.existsSync(${JSON.stringify(failure)});
fs.appendFileSync(${JSON.stringify(runs)}, JSON.stringify({pid:process.pid,picture}) + '\\n');
const finish = () => {
  if (picture && fs.existsSync(${JSON.stringify(gate)})) { setTimeout(finish, 10); return; }
  if (fail) { console.error('Fixture screen preparation unavailable'); process.exit(1); }
  const video = {url:'https://media.invalid/picture.mp4',vcodec:'avc1.640028',acodec:'none',protocol:'https'};
  const audio = {url:'https://media.invalid/sound.m4a',vcodec:'none',acodec:'mp4a.40.2',protocol:'https'};
  const sound = format.replace(/^\\(/, '').startsWith('ba[');
  console.log(JSON.stringify({id:'fixture',title:'Programme',duration:60,formats:[video,audio],requested_formats:picture?[video]:sound?[audio]:[video,audio]}));
};
finish();
`, { mode: 0o755 });
  startHelpers(join(directory, "helpers"));
  await Promise.all([helper("yt-dlp"), helper("qjs"), helper("ffmpeg")]);
  t.after(async () => {
    rmSync(gate, { force: true });
    if (process.env.COUCH_DATA_DIR && existsSync(runs)) writeFileSync(join(process.env.COUCH_DATA_DIR, `screen-owned-${crypto.randomUUID()}.jsonl`), readFileSync(runs));
    assert.deepEqual(await f.close(), { children: [], workers: [] }, "all owned children and workers retire before forced cleanup");
  });
  const other = await f.connect(2, "&audio=1"), screen = await f.connect(3, "&video=1&vp9=1");
  assert.equal((await f.receiver.command({ type: "enqueueWeb", entryId: "programme", url: "https://www.youtube.com/watch?v=abcdefghijk", playNow: true })).ok, true);
  await until(() => !!f.receiver.load());
  f.receiver.report({ status: "playing", duration: 60 });
  await f.speaker(1); await f.speaker(2);
  assert.equal((await f.receiver.command({ type: "output", deviceId: other.id, level: 80 })).ok, true);
  await until(() => f.heard(1) > 0 && f.heard(2) > 0 && f.receiver.state.player.status === "playing");
  return {
    ...f, screen, other,
    pictures: () => existsSync(runs) ? readFileSync(runs, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line) as { pid: number; picture: boolean }).filter(run => run.picture) : [],
    fail: () => writeFileSync(failure, ""), recover: () => rmSync(failure, { force: true }),
    hold: () => writeFileSync(gate, ""), release: () => rmSync(gate, { force: true }),
  };
}

const loads = (messages: ServerMessage[]) => messages.filter(message => message.type === "player" && message.command.type === "load").length;

test("a screen preparation failure stays on that output while healthy sound continues, and picture retry clears it", { timeout: 20_000 }, async t => {
  const f = await fixture(t), before = f.heard(2);
  f.fail();
  assert.equal((await f.receiver.command({ type: "output", deviceId: f.screen.id, picture: true })).ok, true);
  await until(() => !!f.receiver.state.outputs?.find(output => output.deviceId === f.screen.id)?.error);
  assert.equal(f.receiver.state.outputs!.find(output => output.deviceId === f.screen.id)!.error, "Couldn't open this page. It may be unsupported.", "retain the resolver's public error rather than exposing raw extractor diagnostics");
  assert.equal(f.receiver.state.player.error, null);
  assert.equal(f.receiver.state.player.status, "playing");
  await until(() => f.heard(2) > before);
  assert.equal(f.receiver.state.outputs!.find(output => output.deviceId === f.other.id)!.error, undefined);
  const attempts = f.pictures().length;
  assert.equal((await f.receiver.command({ type: "inSync", inSync: false })).ok, true);
  assert.equal(f.pictures().length, attempts, "unrelated reconciliation retains the actionable error instead of retrying silently");
  f.recover();
  assert.equal((await f.receiver.command({ type: "output", deviceId: f.screen.id, picture: false })).ok, true);
  assert.equal(f.receiver.state.outputs?.find(output => output.deviceId === f.screen.id)?.error, undefined);
  assert.equal((await f.receiver.command({ type: "output", deviceId: f.screen.id, picture: true })).ok, true);
  await until(() => loads(f.screen.messages) === 1);
  assert.equal(f.receiver.state.outputs?.find(output => output.deviceId === f.screen.id)?.error, undefined);
});

for (const change of ["remove", "route", "tab", "item"] as const) test(`an obsolete screen preparation failure cannot contaminate a replacement (${change})`, { timeout: 20_000 }, async t => {
  const f = await fixture(t);
  f.fail(); f.hold();
  assert.equal((await f.receiver.command({ type: "output", deviceId: f.screen.id, picture: true })).ok, true);
  await until(() => f.pictures().length === 1);
  const ownedPid = f.pictures()[0]!.pid;
  f.recover();
  let replacement = f.screen;
  if (change === "remove") assert.equal((await f.receiver.command({ type: "output", deviceId: f.screen.id, picture: false })).ok, true);
  if (change === "route") assert.equal((await f.receiver.command({ type: "output", deviceId: f.other.id, level: 60 })).ok, true);
  if (change === "tab") replacement = await f.connect(3, "&video=1&vp9=1");
  if (change === "item") assert.equal((await f.receiver.command({ type: "enqueue", entry: { id: "replacement", title: "Replacement", source: `${f.hub.origin}/api/health` }, playNow: true })).ok, true);
  f.release();
  await until(() => { try { process.kill(ownedPid, 0); return false; } catch { return true; } });
  if (change !== "remove") await until(() => loads(replacement.messages) > 0);
  // A real socket command observes Core after the child's rejection has settled.
  assert.equal((await f.receiver.command({ type: "enqueue", entry: { id: "barrier", title: "Barrier", source: `${f.hub.origin}/api/health` } })).ok, true);
  assert.equal(f.receiver.state.outputs?.find(output => output.deviceId === f.screen.id)?.error, undefined);
  assert.equal(f.receiver.state.player.error, null);
});
