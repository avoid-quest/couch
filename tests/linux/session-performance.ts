// Coordination benchmark, not a decoder or physical-output benchmark.
// Run: bun tests/linux/session-performance.ts [artifact-directory]
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { Action, PlayerState, ServerMessage, SessionState } from '../../src/shared/protocol';
import { desktopClientProtocol } from '../../src/shared/desktop-protocol';

const idle: PlayerState = { playbackId: null, status: 'idle', position: 0, duration: null, volume: 80, seekable: false, error: null };
const until = async (check: () => boolean, label: string) => {
  const deadline = performance.now() + 8000;
  while (!check()) { if (performance.now() > deadline) throw new Error(`Timed out: ${label}`); await Bun.sleep(5); }
};

if (process.argv[2] === '--core-fixture') {
  const { createHub } = await import('../../src/server/hub');
  const { openStore } = await import('../../src/server/store');
  const store = openStore(process.argv[3]!, true);
  const rendererTokens = [store.pair('Household renderer fixture'), store.pair('Personal renderer fixture')];
  store.close();
  const hub = createHub({ hostname: '127.0.0.1', port: 0, databasePath: process.argv[3]!, hostToken: crypto.randomUUID(), pairingCode: '123456' });
  process.on('message', async (message: unknown) => {
    const request = message as { type: string; id: string };
    if (request.type === 'sample') process.send?.({ id: request.id, cpu: process.cpuUsage(), rss: process.memoryUsage().rss, at: performance.now() });
    if (request.type === 'close') { await hub.close(); process.exit(0); }
  });
  process.send?.({ type: 'ready', origin: hub.origin, rendererTokens });
} else {
  const artifacts = resolve(process.argv[2] ?? '.artifacts/session-performance');
  mkdirSync(artifacts, { recursive: true });
  const directory = mkdtempSync(join(tmpdir(), 'couch-session-performance-'));
  const pending = new Map<string, (message: any) => void>();
  let origin = '';
  let rendererTokens: string[] = [];
  const command = (args: string[]) => Bun.spawnSync(args, { cwd: resolve(import.meta.dir, '../..') }).stdout.toString().trim();
  const files = ['src/server/hub.ts', 'src/server/session.ts', 'src/server/playback-targets.ts', 'src/shared/protocol.ts', 'tests/linux/session-performance.ts'];
  const sourceHashes = Object.fromEntries(await Promise.all(files.map(async file => [file, createHash('sha256').update(new Uint8Array(await Bun.file(resolve(import.meta.dir, '../..', file)).arrayBuffer())).digest('hex')])));
  const revision = command(['git', 'rev-parse', 'HEAD']), dirty = command(['git', 'status', '--porcelain']);
  const child = Bun.spawn([process.execPath, import.meta.path, '--core-fixture', join(directory, 'core.sqlite')], {
    stdout: 'ignore', stderr: 'inherit', ipc(message: any) { if (message.type === 'ready') { origin = message.origin; rendererTokens = message.rendererTokens; } else pending.get(message.id)?.(message); },
  });
  const sample = () => new Promise<{ cpu: { user: number; system: number }; rss: number; at: number }>((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Core sample timeout')); }, 5000);
    pending.set(id, message => { clearTimeout(timer); pending.delete(id); resolve(message); });
    child.send({ type: 'sample', id });
  });
  const peers: Peer[] = [];
  const requests: Record<string, number> = {};
  const media = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    const path = new URL(request.url).pathname;
    requests[path] = (requests[path] ?? 0) + 1;
    return new Response(new Uint8Array(1024), { headers: { 'Content-Type': 'audio/mpeg' } });
  } });
  class Peer {
    socket: WebSocket;
    state: SessionState | null = null;
    messages: ServerMessage[] = [];
    traffic: Record<string, { messages: number; bytes: number }> = {};
    rendererState: PlayerState = { ...idle };
    rendererSession = '';
    results = new Map<string, (message: Extract<ServerMessage, { type: "result" }>) => void>();
    constructor(token: string, readonly renderer = false, personal = false) {
      const WS = WebSocket as typeof WebSocket & { new(url: string, options: Bun.WebSocketOptions): WebSocket };
      this.socket = new WS(`${origin.replace('http:', 'ws:')}/api/ws?token=${token}&clientProtocol=${desktopClientProtocol}&playbackClock=1${personal ? "&session=personal" : ""}`, { headers: { Origin: origin } });
      this.socket.onmessage = event => {
        const text = String(event.data), message = JSON.parse(text) as ServerMessage;
        const counter = this.traffic[message.type] ??= { messages: 0, bytes: 0 };
        counter.messages++; counter.bytes += Buffer.byteLength(text);
        this.messages.push(message);
        if (message.type === "result") this.results.get(message.requestId)?.(message);
        if (message.type === 'state') this.state = message.state;
        if (message.type === 'rendererRegistered') this.rendererSession = message.sessionId;
        if (message.type === 'rendererCommand') {
          assert.ok(renderer, 'idle controllers never receive delivery commands');
          const command = message.command;
          if (command.type === 'load') {
            // Simulate one delivery fetch, not decoding; controllers never fetch this endpoint.
            void fetch(command.source).then(response => response.arrayBuffer());
            this.rendererState = { ...idle, playbackId: command.playbackId, status: command.paused ? 'paused' : 'playing', duration: 600, seekable: true, position: command.startPosition ?? 0 };
          } else if (command.type === 'stop') this.rendererState = { ...idle };
          else if (command.type === 'pause') this.rendererState.status = command.paused ? 'paused' : 'playing';
          else if (command.type === 'volume') this.rendererState.volume = command.volume;
          this.observe();
        }
      };
      peers.push(this);
    }
    observe() { if (this.rendererSession) this.socket.send(JSON.stringify({ type: 'rendererObservation', sessionId: this.rendererSession, state: this.rendererState })); }
    async command(action: Action) {
      const requestId = crypto.randomUUID(), start = performance.now();
      return new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => { this.results.delete(requestId); reject(new Error('Command timeout')); }, 8000);
        this.results.set(requestId, result => {
          clearTimeout(timer); this.results.delete(requestId);
          if (!result.ok) reject(new Error(result.error)); else resolve(performance.now() - start);
        });
        this.socket.send(JSON.stringify({ type: 'command', requestId, action }));
      });
    }
  }
  const pair = async (renderer = false, personal = false) => {
    const response = await fetch(`${origin}/api/pair`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ code: '123456', name: renderer ? 'Simulated renderer' : 'Idle controller' }) });
    assert.equal(response.status, 200);
    const peer = new Peer((await response.json() as { token: string }).token, renderer, personal);
    await until(() => !!peer.state, 'initial snapshot');
    return peer;
  };
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    await until(() => !!origin, 'child Core startup');
    const household = new Peer(rendererTokens[0]!, true), personal = new Peer(rendererTokens[1]!, true, true);
    await until(() => !!household.state && !!personal.state, 'renderer initial snapshots');
    const idlePeers = [];
    for (let index = 0; index < 20; index++) idlePeers.push(await pair());
    for (const peer of [household, personal]) {
      peer.socket.send(JSON.stringify({ type: 'registerRenderer', capabilities: { mp3: true, mp4H264Aac: true } }));
      await until(() => peer.messages.some(message => message.type === 'rendererRegistered'), 'renderer registration');
      const registration = peer.messages.find(message => message.type === 'rendererRegistered')!;
      assert.equal(registration.type, 'rendererRegistered');
      await peer.command({ type: 'selectTarget', targetId: registration.targetId });
    }
    await household.command({ type: 'enqueue', entry: { id: 'household-stream', title: 'Household stream', source: `${media.url}household.mp3` }, playNow: true });
    await personal.command({ type: 'enqueue', entry: { id: 'personal-stream', title: 'Personal stream', source: `${media.url}personal.mp3` }, playNow: true });
    await until(() => household.rendererState.status === 'playing' && personal.rendererState.status === 'playing', 'distinct playback');
    assert.notEqual(household.state!.sessionId, personal.state!.sessionId, 'sessions must be independent');
    const first = await sample();
    for (const peer of peers) peer.traffic = {};
    timer = setInterval(() => { for (const peer of [household, personal]) { peer.rendererState.position += 0.25; peer.observe(); } }, 250);
    const latencies: number[] = [], rss = [first.rss];
    const started = performance.now();
    for (let index = 0; index < 60; index++) {
      latencies.push(await (index % 2 ? personal : household).command({ type: 'volume', volume: 40 + index % 20 }));
      await Bun.sleep(250);
      if (index % 12 === 0) rss.push((await sample()).rss);
    }
    const last = await sample(); rss.push(last.rss);
    assert.equal(household.state!.currentEntryId, 'household-stream');
    assert.equal(personal.state!.currentEntryId, 'personal-stream');
    assert.ok(idlePeers.every(peer => peer.state!.currentEntryId === 'household-stream'), 'idle controllers stay on household');
    assert.deepEqual(requests, { '/household.mp3': 1, '/personal.mp3': 1 }, 'only simulated renderer loads fetch sources');
    latencies.sort((a, b) => a - b);
    const report = { qualification: 'Core coordination only. Real HTTP/WebSocket transport; two simulated renderer observation streams and two simulated source fetches; twenty idle controllers. Renderer credentials are seeded privately before startup to respect the 20/minute HTTP pairing cap; idle controllers pair over HTTP. No decoder CPU, browser rendering, hardware audio or sustained media-throughput claim.', wallMs: performance.now() - started, core: { cpuPercentOfOneCore: (last.cpu.user + last.cpu.system - first.cpu.user - first.cpu.system) / ((last.at - first.at) * 1000) * 100, rssBytes: { first: first.rss, last: last.rss, sampledPeak: Math.max(...rss) } }, commandRoundtripMs: { samples: latencies.length, p50: latencies[Math.floor(latencies.length * .5)], p95: latencies[Math.floor(latencies.length * .95)], measurement: 'Send to matching WebSocket result event; no hardware performance thresholds asserted.' }, traffic: peers.map((peer, index) => ({ role: index < 2 ? ['household renderer', 'personal renderer'][index] : 'idle controller', ...peer.traffic })), sourceRequests: requests, revision, dirty, sourceHashes, sourceChangedDuringRun: (await Promise.all(files.map(async file => createHash('sha256').update(new Uint8Array(await Bun.file(resolve(import.meta.dir, '../..', file)).arrayBuffer())).digest('hex') !== sourceHashes[file]))).some(Boolean) };
    await Bun.write(join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ report: join(artifacts, 'report.json'), core: report.core, commandRoundtripMs: report.commandRoundtripMs }, null, 2));
  } finally {
    if (timer) clearInterval(timer);
    for (const peer of peers) peer.socket.close();
    await media.stop(true);
    child.send({ type: 'close' });
    await Promise.race([child.exited, Bun.sleep(5000).then(() => child.kill())]);
    rmSync(directory, { recursive: true, force: true });
  }
}
