import assert from "node:assert/strict";
import { test } from "node:test";
import { authorityFixture, resultOk, until } from "./hub-authority.fixture";

for (const guarded of [true, false]) test(`Remote retains explicit consented Live TV volume authority (${guarded ? "guarded" : "legacy"})`, { timeout: 15_000 }, async t => {
  const f = await authorityFixture(); t.after(() => f.close());
  const host = await f.connect(f.host), phone = await f.connect(), tvIdentity = f.devices[2]!, otherIdentity = f.devices[3]!;
  const tv = await f.connect(tvIdentity, "&tv=1&audio=1&video=1"), other = await f.connect(otherIdentity, "&tv=1&audio=1");
  // Synthetic publication and audience admission only: no capture/upload or audio player.
  resultOk(await host.command({ type: "publishLive", sourceId: "remote-live", uploadToken: "1".repeat(64), kind: "microphone", audio: true, video: false, audioDelivery: "pcm", intent: "live" }));
  resultOk(await tv.command({ type: "playLive", sourceId: "remote-live", deviceId: tv.id }));
  const volume = { type: "volume", deviceId: tv.id, volume: 32 } as const;
  assert.equal((await phone.command(volume)).ok, false, "merely naming a shared Live receiver grants no Remote authority");
  resultOk(await phone.command({ type: "control", deviceId: tv.id }));
  const envelope = guarded ? tv.id : undefined;
  resultOk(await phone.command(volume, envelope));
  resultOk(await phone.command({ type: "mute", deviceId: tv.id, muted: true }, envelope));
  await until(() => tv.state.devices?.find(device => device.id === tv.id)?.muted === true);
  assert.equal(tv.state.devices!.find(device => device.id === tv.id)!.volume, 32);
  resultOk(await phone.command({ type: "mute", deviceId: tv.id, muted: false }, envelope));
  resultOk(await other.command({ type: "playLive", sourceId: "remote-live", deviceId: other.id }));
  assert.equal((await other.command(volume)).ok, false, "an audience member cannot forge another receiver's volume");
  assert.equal((await phone.command({ ...volume, deviceId: other.id }, envelope)).ok, false, "a Remote cannot address another TV");
  assert.equal((await phone.command(volume, other.id)).ok, false, "a mismatched envelope is refused");
  resultOk(await phone.command({ type: "control", deviceId: other.id }));
  assert.equal((await phone.command(volume, envelope)).ok, false, "selection replacement revokes the old target");
  resultOk(await phone.command({ type: "control", deviceId: tv.id }));
  resultOk(await tv.command({ type: "sharing", sharing: { audio: false, video: true } }));
  assert.equal((await phone.command(volume, envelope)).ok, false, "shared video does not grant audio consent");
  resultOk(await tv.command({ type: "sharing", sharing: { audio: true, video: true } }));
  resultOk(await phone.command(volume, envelope));
  tv.socket.terminate();
  await until(() => phone.state.devices?.find(device => device.id === tv.id)?.online === false);
  assert.equal((await phone.command({ ...volume, volume: 41 }, envelope)).ok, false, "Remote authority requires the selected TV to stay connected");
  assert.equal(phone.state.devices!.find(device => device.id === tv.id)!.volume, 32);
});

test("a Remote-bound controller can unmute and adjust another consented ordinary output", { timeout: 15_000 }, async t => {
  const f = await authorityFixture(); t.after(() => f.close());
  const phone = await f.connect(), tv = await f.connect(f.devices[2]!, "&tv=1&audio=1&video=1");
  const speaker = await f.connect(f.devices[3]!, "&audio=1");
  resultOk(await tv.command({ type: "enqueue", entry: { id: "ordinary", title: "Ordinary queue", source: `${f.hub.origin}/api/health` } }));
  resultOk(await tv.command({ type: "output", deviceId: speaker.id, level: 40 }));
  resultOk(await speaker.command({ type: "mute", deviceId: speaker.id, muted: true }));
  resultOk(await phone.command({ type: "control", deviceId: tv.id }));
  assert.equal(phone.state.outputs?.filter(output => output.sound).length, 2);
  resultOk(await phone.command({ type: "mute", deviceId: speaker.id, muted: false }));
  resultOk(await phone.command({ type: "volume", deviceId: speaker.id, volume: 37 }));
  await until(() => phone.state.devices?.find(device => device.id === speaker.id)?.volume === 37);
  assert.equal(phone.state.devices!.find(device => device.id === speaker.id)!.muted, false);
  assert.equal(phone.state.controlling, tv.id, "a mixer row adjustment must not change the selected TV");
});

test("a Remote-bound Live viewer retains its own device volume and mute", { timeout: 15_000 }, async t => {
  const f = await authorityFixture(); t.after(() => f.close());
  const host = await f.connect(f.host), phone = await f.connect(f.devices[1]!, "&audio=1");
  const tv = await f.connect(f.devices[2]!, "&tv=1&audio=1&video=1");
  resultOk(await phone.command({ type: "volume", deviceId: phone.id, volume: 19 }));
  // Synthetic publication/admission only; no audio capture, upload or playback.
  resultOk(await host.command({ type: "publishLive", sourceId: "own-volume", uploadToken: "2".repeat(64), kind: "microphone", audio: true, video: false, audioDelivery: "pcm", intent: "live" }));
  resultOk(await tv.command({ type: "playLive", sourceId: "own-volume", deviceId: tv.id }));
  resultOk(await phone.command({ type: "control", deviceId: tv.id }));
  resultOk(await phone.command({ type: "volume", deviceId: phone.id, volume: 41 }));
  resultOk(await phone.command({ type: "mute", deviceId: phone.id, muted: true }));
  await until(() => phone.state.devices?.find(device => device.id === phone.id)?.muted === true);
  assert.equal(phone.state.devices!.find(device => device.id === phone.id)!.volume, 41);
  resultOk(await phone.command({ type: "mute", deviceId: phone.id, muted: false }));
  assert.equal(phone.state.controlling, tv.id);
});
