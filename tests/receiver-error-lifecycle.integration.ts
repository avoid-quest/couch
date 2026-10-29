import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
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
  const facade = createSendspin({ name: 'Review fixture', admit: id => authorized.has(id),
    changed() {}, ffmpeg: async () => process.env.COUCH_TEST_FFMPEG ?? "ffmpeg" });
  const server = createServer();
  server.on('upgrade', (req, socket, head) => facade.upgrade(req, socket as any, head));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const group = facade.group('review-group', state => states.push(state));
  let timer: ReturnType<typeof setInterval> | undefined;
  t.after(async () => { clearInterval(timer); group.close(); facade.close(); await Promise.all(clients.map(client => client.disconnect())); await new Promise<void>(resolve => server.close(() => resolve())); });
  async function receiver(format = true, identity = key) {
    authorized.add(identity.peerId);
    const client = new SendspinClient(identity.peerId, 'Receiver', [Roles.PLAYER], { playerSupport: { supported_formats: [{ codec: AudioCodec.OPUS, sample_rate: format ? 48000 : 44100, channels: 2, bit_depth: 16 }], buffer_capacity: 4096, supported_commands: [] } });
    clients.push(client);
    const observation = { starts: 0, frames: 0, clears: 0 };
    client.addStreamStartListener(() => observation.starts++);
    client.addStreamClearListener(() => observation.clears++);
    client.addAudioChunkListener(() => observation.frames++);
    await client.connect(`ws://127.0.0.1:${(server.address() as any).port}`, { timeoutMs: 2000 });
    await client.sendPlayerState({ required_lead_time_ms: 25, min_buffer_ms: 25 });
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

// These are real worker/plaintext Sendspin/FFmpeg paths; only capture samples are synthetic.
for (const action of ['remove', 'close'] as const) test(`relaxed ${action} retires refusal before recovery and reassignment`, { timeout: 8000 }, async t => {
  const f = await fixture(t), refused = await f.receiver(false);
  f.facade.registerSource('review-source');
  f.group.members([{ deviceId: f.key.peerId, level: 100 }]);
  f.group.send({ type: 'load', playbackId: 'review-group', source: '', liveSourceId: 'review-source', live: true });
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
  replacement.send({ type: 'load', playbackId: 'replacement', source: '', liveSourceId: 'review-source', live: true });
  await until(() => healthy.observation.frames >= 8, 'replacement actually receives Opus');
  assert.equal(f.facade.receiverError(f.key.peerId), undefined);
});

test("old group retirement cannot clear the current relaxed failure", { timeout: 8000 }, async t => {
  const f = await fixture(t);
  await f.receiver(false);
  const member = { deviceId: f.key.peerId, level: 100 };
  f.facade.registerSource('review-source');
  f.group.members([member]);
  f.group.send({ type: 'load', playbackId: 'review-group', source: '', liveSourceId: 'review-source', live: true });
  f.feed();
  await until(() => !!f.facade.receiverError(f.key.peerId), 'old group has an unsupported format');
  const replacementStates: any[] = [];
  const replacement = f.facade.group('replacement', state => replacementStates.push(state)); t.after(() => replacement.close());
  replacement.members([member]);
  replacement.send({ type: 'load', playbackId: 'replacement', source: '', liveSourceId: 'review-source', live: true });
  // Wait for the replacement's first source data, not merely its load command.
  await until(() => replacementStates.some(state => state.status === 'playing'), 'replacement has source data');
  // Observe a replacement state before retiring its predecessor.
  const barrierStates: unknown[] = [], barrier = f.facade.group('barrier', state => barrierStates.push(state));
  t.after(() => barrier.close()); barrier.send({ type: 'stop' });
  await until(() => barrierStates.length > 0, 'replacement started');
  const failure = f.facade.receiverError(f.key.peerId);
  assert.ok(failure);
  const observerIdentity = Identity.generate(), observer = await f.receiver(true, observerIdentity);
  f.group.close(); barrierStates.length = 0; barrier.send({ type: 'stop' });
  await until(() => barrierStates.length > 0, 'old group close completed');
  await observer.client.sendPlayerState({ static_delay_ms: 1 });
  await until(() => f.facade.delay(observerIdentity.peerId) === 1, 'independent observer publishes post-close status');
  assert.equal(f.facade.receiverError(f.key.peerId), failure);
});
