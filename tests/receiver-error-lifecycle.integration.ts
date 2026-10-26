import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { AudioCodec, Identity, Roles, SendspinClient, serverNowUs } from '@sonn-audio/node-sendspin';
import { createSendspin } from '../src/server/sendspin';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const until = async (check: () => boolean, message: string) => {
  const end = Date.now() + 3000;
  while (!check()) { assert.ok(Date.now() < end, message); await sleep(5); }
};
async function fixture(t: any) {
  const key = Identity.generate(), clients: SendspinClient[] = [], states: any[] = [];
  const authorized = new Set([key.peerId]);
  const facade = createSendspin({ identity: Identity.generate().privateB64u, name: 'Review fixture', admit: id => authorized.has(id),
    changed() {}, ffmpeg: async () => process.env.COUCH_TEST_FFMPEG! });
  const server = createServer();
  server.on('upgrade', (req, socket, head) => facade.upgrade(req, socket as any, head));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const group = facade.group('review-group', state => states.push(state));
  let timer: ReturnType<typeof setInterval> | undefined;
  t.after(async () => { clearInterval(timer); group.close(); facade.close(); await Promise.all(clients.map(client => client.disconnect())); await new Promise<void>(resolve => server.close(() => resolve())); });
  async function receiver(receiverId?: string, format = true, identity = key) {
    authorized.add(identity.peerId);
    const client = new SendspinClient(identity.peerId, 'Receiver', [Roles.PLAYER], { encryption: { identity },
      playerSupport: { supported_formats: [{ codec: AudioCodec.OPUS, sample_rate: format ? 48000 : 44100, channels: 2, bit_depth: 16 }], buffer_capacity: 4096, supported_commands: [] } });
    clients.push(client);
    const observation = { starts: 0, frames: 0, clears: 0 };
    client.addStreamStartListener(() => observation.starts++);
    client.addStreamClearListener(() => observation.clears++);
    client.addAudioChunkListener(() => observation.frames++);
    await client.connect(`ws://127.0.0.1:${(server.address() as any).port}`, { timeoutMs: 2000 });
    await client.sendPlayerState({ required_lead_time_ms: 25, min_buffer_ms: 25,
      ...(receiverId ? { couch_preparation: { receiverId, epoch: 1, state: 'ready' as const } } : {}) });
    return { client, observation };
  }
  function feed() {
    let sequence = 0; const origin = serverNowUs();
    timer = setInterval(() => { const due = Math.floor((serverNowUs() - origin) / 10000);
      while (sequence < due) { facade.writeSource('review-source', { generation: 'g1', sequence, samplePosition: sequence * 480,
        capturedAtUs: origin + sequence * 10000, channels: 2, sampleRate: 48000, pcm: new Float32Array(960) }); sequence++; }
    }, 5);
  }
  return { key, facade, group, receiver, feed, states };
}

// These are real worker/Noise/FFmpeg paths; only capture samples are synthetic.
for (const action of ['remove', 'close'] as const) test(`relaxed ${action} retires refusal before recovery and reassignment`, { timeout: 8000 }, async t => {
  const f = await fixture(t), refused = await f.receiver(undefined, false);
  f.facade.registerSource('review-source', { intent: 'relaxed' });
  f.group.members([{ deviceId: f.key.peerId, level: 100 }]);
  f.group.send({ type: 'load', playbackId: 'review-group', source: '', liveSourceId: 'review-source', intent: 'relaxed', live: true });
  f.feed();
  await until(() => !!f.facade.receiverError(f.key.peerId), 'current unsupported wire fails');
  const states = f.states.length;
  if (action === 'remove') {
    f.group.members([]);
    await until(() => f.states.length > states, 'membership command crossed worker boundary');
  } else f.group.close();
  // Worker commands and network data have distinct queues. A following group
  // callback establishes command order; the timing update then publishes status.
  const barrierStates: unknown[] = [], barrier = f.facade.group('barrier', state => barrierStates.push(state));
  t.after(() => barrier.close()); barrier.send({ type: 'stop' });
  await until(() => barrierStates.length > 0, 'retirement command completed');
  await refused.client.sendPlayerState({ static_delay_ms: 1 });
  await until(() => f.facade.delay(f.key.peerId) === 1, 'post-retirement facade status');
  assert.equal(f.facade.receiverError(f.key.peerId), undefined, 'retired relaxed failure must be absent before any successful replacement packet');
  await refused.client.disconnect();
  const healthy = await f.receiver();
  const replacement = f.facade.group('replacement', () => {}); t.after(() => replacement.close());
  replacement.members([{ deviceId: f.key.peerId, level: 100 }]);
  replacement.send({ type: 'load', playbackId: 'replacement', source: '', liveSourceId: 'review-source', intent: 'relaxed', live: true });
  await until(() => healthy.observation.frames >= 8, 'replacement actually receives Opus');
  assert.equal(f.facade.receiverError(f.key.peerId), undefined);
});

for (const replacementIntent of ['live', 'relaxed'] as const) test(`old group retirement cannot clear current ${replacementIntent} failure`, { timeout: 8000 }, async t => {
  const f = await fixture(t), token = randomUUID();
  const receiver = await f.receiver(token, replacementIntent === 'live');
  const member = { deviceId: f.key.peerId, level: 100, receiverId: token };
  f.facade.registerSource('review-source', { intent: 'relaxed' });
  f.group.members([member]);
  f.group.send({ type: 'load', playbackId: 'review-group', source: '', liveSourceId: 'review-source', intent: 'live', live: true });
  // Measured headroom never reaches the whole one-second relaxed lead.
  f.feed();
  await receiver.client.sendPlayerState({ required_lead_time_ms: 2000, min_buffer_ms: 25, couch_preparation: { receiverId: token, epoch: 2, state: 'ready' } });
  await until(() => !!f.facade.receiverError(f.key.peerId), 'old group has a real refusal');
  const replacement = f.facade.group('replacement', () => {}); t.after(() => replacement.close());
  replacement.members([{ deviceId: f.key.peerId, level: 100, ...(replacementIntent === 'live' ? { receiverId: token } : {}) }]);
  replacement.send({ type: 'load', playbackId: 'replacement', source: '', liveSourceId: 'review-source', intent: replacementIntent, live: true });
  if (replacementIntent === 'live') await receiver.client.sendPlayerState({ required_lead_time_ms: 2001, min_buffer_ms: 25, couch_preparation: { receiverId: token, epoch: 3, state: 'ready' } });
  await until(() => replacementIntent === 'live' ? /2001 ms/.test(f.facade.receiverError(f.key.peerId) ?? '') : f.facade.receiverError(f.key.peerId) === "This output cannot meet live audio's Opus deadline. Use relaxed sharing.", 'replacement owns a distinct failure');
  const failure = f.facade.receiverError(f.key.peerId);
  const observerIdentity = Identity.generate(), observer = await f.receiver(undefined, true, observerIdentity);
  f.group.close();
  const barrierStates: unknown[] = [], barrier = f.facade.group('barrier', state => barrierStates.push(state));
  t.after(() => barrier.close()); barrier.send({ type: 'stop' });
  await until(() => barrierStates.length > 0, 'old group close completed');
  await observer.client.sendPlayerState({ static_delay_ms: 1 });
  await until(() => f.facade.delay(observerIdentity.peerId) === 1, 'independent observer publishes post-close status without refreshing replacement');
  assert.equal(f.facade.receiverError(f.key.peerId), failure, 'old cleanup cannot clear replacement refusal');
});
