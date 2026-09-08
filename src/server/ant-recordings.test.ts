import { afterEach, expect, setSystemTime, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAntRecordings } from "./ant-recordings";
import { createRecordings } from "./recordings";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "couch-ant-test-")); cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "db.sqlite"), shutdown = new AbortController(); cleanup.push(() => shutdown.abort());
  const now = Date.now(), row = { streamId: "capture", date: now - 120_000, startTime: now - 60_000, plannedEndDate: Math.floor(now / 1000) + 60, status: "broadcasting", name: "Programme" };
  const manifest = () => `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:EVENT\n#EXTINF:2,\ncapture000000001.ts\n${row.status === "finished" ? '#EXT-X-ENDLIST\n' : ''}`;
  const state = { body: manifest, anonymous: false, anonymousSegments: false, denied: false, oversized: false, hold: false, chunks: false, cancelled: false, admitted: true };
  const calls: { path: string; authenticated: boolean; range: string | null; redirect: RequestRedirect | undefined }[] = [];
  const request: typeof fetch = (async (input, init) => {
    const url = new URL(String(input)), headers = new Headers(init?.headers), authenticated = headers.get("authorization") === `Basic ${Buffer.from("reader:private password ").toString("base64")}`;
    calls.push({ path: url.pathname, authenticated, range: headers.get("range"), redirect: init?.redirect });
    if (state.denied || !authenticated && !state.anonymous && !(state.anonymousSegments && url.pathname.endsWith('.ts'))) return new Response(null, { status: 401 });
    if (url.pathname.includes('/rest/')) return Response.json(row);
    if (url.pathname.endsWith('.m3u8')) return new Response(state.body());
    if (state.hold && authenticated) {
      await new Promise((_, reject) => init?.signal?.addEventListener('abort', () => { state.cancelled = true; reject(init.signal!.reason); }, { once: true }));
    }
    if (state.chunks) { let count = 0; return new Response(new ReadableStream({ pull(controller) { if (count++ < 3) controller.enqueue(new Uint8Array(8 * 1024 * 1024)); else controller.close(); } })); }
    if (state.oversized) return new Response(new Uint8Array(1), { headers: { 'Content-Length': String(16 * 1024 * 1024 + 1) } });
    const bytes = new Uint8Array([1, 2, 3, 4]);
    return new Response(headers.has('range') ? bytes.slice(1, 3) : bytes, { status: headers.has('range') ? 206 : 200, headers: headers.has('range') ? { 'Content-Range': 'bytes 1-2/4', 'Content-Length': '2' } : {} });
  }) as typeof fetch;
  let broadcasts = 0;
  const open = () => {
    const db = new Database(path); cleanup.push(() => db.close());
    return createAntRecordings(db, { request, shutdown: shutdown.signal, assertOpen: () => { if (!state.admitted) throw new Error('Closed admission'); }, publish: () => { broadcasts++; }, connectionChanged: () => {}, mediaUrl: path => `http://127.0.0.1:3800${path}` });
  };
  const ant = open();
  const config = { revision: 0, endpoint: 'https://backend.test/LiveApp', username: 'reader', password: 'private password ', captureHours: 24, retentionDays: 7, storageGiB: 100, storageConfigured: true };
  const configure = () => ant.configure(config, () => {}, shutdown.signal);
  const attach = () => ant.attach({ revision: 1, streamId: 'capture', title: 'Saved programme' }, () => {}, shutdown.signal);
  return { ant, open, row, state, calls, config, configure, attach, signal: shutdown.signal, broadcasts: () => broadcasts, request };
}

test('Ant attachment preserves a durable UUID and EVENT timeline through completion and restart', async () => {
  const f = fixture(); await f.configure(); const job = await f.attach();
  expect(job).toMatchObject({ status: 'running', backend: 'ant', title: 'Saved programme' });
  expect((await f.attach()).id).toBe(job.id);
  const controller = new AbortController(), media = await f.ant.resolve(job.id, controller.signal);
  expect(media.headers).toBeUndefined(); expect(media.source).not.toContain('backend'); expect(media.canComplete!(true)).toBe(false);
  const playlist = await f.ant.media(new Request(media.source)); expect(await playlist.text()).toContain('capture000000001.ts');
  const segment = await f.ant.media(new Request(media.source.replace('capture.m3u8', 'capture000000001.ts'), { headers: { Range: 'bytes=1-2' } }));
  expect(segment.status).toBe(206); expect(segment.headers.get('content-range')).toBe('bytes 1-2/4'); expect([...new Uint8Array(await segment.arrayBuffer())]).toEqual([2, 3]);
  f.row.status = 'finished';
  expect(await (await f.ant.media(new Request(media.source))).text()).toContain('#EXT-X-ENDLIST');
  expect(media.canComplete!(true)).toBe(true); expect(media.canComplete!(false)).toBe(false);
  expect(f.open().snapshot().jobs[0]).toMatchObject({ id: job.id, status: 'completed' });
  expect(JSON.stringify(f.ant.snapshot())).not.toMatch(/private password|backend.test|reader|capture000/);
  expect(f.calls.every(call => call.redirect === 'error')).toBe(true);
  controller.abort(); expect((await f.ant.media(new Request(media.source))).status).toBe(404);
  expect(f.ant.snapshot().jobs[0]?.status).toBe('completed');
});

test('Ant refuses anonymous API, manifest, or segment access and keeps failed attachments out of storage', async () => {
  for (const key of ['anonymous', 'anonymousSegments'] as const) {
    const f = fixture(); await f.configure(); f.state[key] = true;
    await expect(f.attach()).rejects.toThrow('proxy'); expect(f.ant.snapshot().jobs).toHaveLength(0);
  }
});

test('Ant rejects foreign child URLs, keys, nonzero timeline origins and ENDLIST followed by content', async () => {
  for (const body of [
    '#EXTINF:2,\nhttps://other.test/capture000000001.ts\n',
    '#EXT-X-KEY:METHOD=AES-128,URI="https://other.test/key"\n#EXTINF:2,\ncapture000000001.ts\n',
    '#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:2,\ncapture000000001.ts\n',
    '#EXT-X-ENDLIST\n#EXTINF:2,\ncapture000000001.ts\n',
  ]) {
    const f = fixture(); await f.configure(); f.state.body = () => '#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-PLAYLIST-TYPE:EVENT\n' + body;
    await expect(f.attach()).rejects.toThrow(); expect(f.calls.some(call => call.path.includes('other.test'))).toBe(false);
  }
});

test('Ant stream restart, access expiry and oversized segments invalidate completion without replacing identity', async () => {
  for (const failure of ['generation', 'denied', 'oversized'] as const) {
    const f = fixture(); await f.configure(); const job = await f.attach(); f.row.status = 'finished';
    const media = await f.ant.resolve(job.id, new AbortController().signal); expect(media.canComplete!(true)).toBe(true);
    if (failure === 'generation') f.row.startTime++; else f.state[failure] = true;
    const response = await f.ant.media(new Request(media.source.replace('capture.m3u8', 'capture000000001.ts')));
    expect(response.status).toBe(502); expect(media.canComplete!(true)).toBe(false);
    expect(f.ant.snapshot().jobs[0]).toMatchObject({ id: job.id, status: 'failed' });
  }
});

test('Stop aborts pending Ant HTTP and revokes its lease while backend capture continues', async () => {
  const f = fixture(); await f.configure(); const job = await f.attach(), controller = new AbortController();
  const media = await f.ant.resolve(job.id, controller.signal); f.state.hold = true;
  const pending = f.ant.media(new Request(media.source.replace('capture.m3u8', 'capture000000001.ts')));
  while (!f.calls.some(call => call.path.endsWith('.ts') && call.authenticated)) await Bun.sleep(1);
  controller.abort(); expect((await pending).status).toBe(502); expect(f.state.cancelled).toBe(true);
  expect((await f.ant.media(new Request(media.source))).status).toBe(404);
  expect(f.row.status).toBe('broadcasting'); expect(f.calls.every(call => !/stop|delete|recording/.test(call.path))).toBe(true);
});

test('Ant attachment and credential replacement fence authorization, account identity and finite capture limits', async () => {
  const f = fixture(); await f.configure();
  await expect(f.ant.attach({ revision: 1, streamId: 'capture' }, () => { throw new Error('Revoked'); }, f.signal)).rejects.toThrow('Revoked');
  expect(f.ant.snapshot().jobs).toHaveLength(0);
  f.row.plannedEndDate = 0; await expect(f.attach()).rejects.toThrow('finite');
  f.row.plannedEndDate = Math.floor(Date.now() / 1000) + 60; const job = await f.attach();
  await expect(f.ant.configure({ ...f.config, revision: 1, username: 'other' }, () => {}, f.signal)).rejects.toThrow('identity');
  await expect(f.ant.configure({ ...f.config, revision: 1, storageConfigured: false }, () => {}, f.signal)).rejects.toThrow('enforces');
  const media = await f.ant.resolve(job.id, new AbortController().signal);
  await f.ant.configure({ ...f.config, revision: 1 }, () => {}, f.signal);
  expect((await f.ant.media(new Request(media.source))).status).toBe(404);
});

test('Ant retention expiry remains a visible job and refuses replay', async () => {
  const f = fixture(); await f.configure(); const job = await f.attach();
  try {
    setSystemTime(Date.now() + 8 * 86_400_000); await f.ant.refresh(f.signal);
    expect(f.ant.snapshot().jobs[0]).toMatchObject({ id: job.id, status: 'failed', cause: expect.stringContaining('retention') });
    await expect(f.ant.resolve(job.id, new AbortController().signal)).rejects.toThrow('retention');
  } finally { setSystemTime(); }
});

test('recording routes require an administrator for Ant attachment while existing Tvheadend setup remains separate', async () => {
  const f = fixture(), dir = mkdtempSync(join(tmpdir(), 'couch-ant-routes-')); cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const app = createRecordings({ databasePath: join(dir, 'db'), selection: () => { throw new Error('unused'); }, channel: () => { throw new Error('unused'); }, pollMs: 0, fetch: f.request }); cleanup.push(() => app.close());
  let host = true;
  const call = (path: string, body?: unknown) => app.handle(new Request(`http://localhost/api/recordings/${path}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), () => ({ authority: host ? 'host' : 'controller', controller: null, claimAvailable: false }));
  expect((await call('ant/setup', f.config)).status).toBe(200);
  host = false; expect((await call('ant/attach', { revision: 1, streamId: 'capture' })).status).toBe(403);
  host = true; const result = await call('ant/attach', { revision: 1, streamId: 'capture' }); expect(result.status).toBe(200);
  expect(app.snapshot()).toMatchObject({ configured: false, antConfigured: true });
  host = false; expect((await call(`${app.snapshot().jobs[0]!.id}/play`, {})).status).toBe(200);
  expect((await call('setup')).status).toBe(403);
});

test('the real hub keeps Ant credentials private and restricts media leases to loopback without browser origins', async () => {
  const { createHub } = await import('./hub');
  const f = fixture();
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: req => f.request(req.url, { headers: req.headers, signal: req.signal, redirect: 'error' }) }); cleanup.push(() => upstream.stop(true));
  const dir = mkdtempSync(join(tmpdir(), 'couch-ant-hub-')); cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const commands: import('../shared/protocol').PlaybackCommand[] = [];
  const token = 'private-host-token-for-ant-integration-123456789';
  const hub = createHub({ hostname: '127.0.0.1', port: 0, databasePath: join(dir, 'db'), pairingCode: '123456', hostToken: token, sendPlayer: command => commands.push(command) }); cleanup.push(() => hub.close());
  hub.session.observe({ playbackId: null, status: 'idle', position: 0, duration: null, seekable: false, error: null, volume: 80 });
  const call = (path: string, value: unknown) => fetch(`${hub.origin}/api/recordings/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, Origin: hub.origin, 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  expect((await call('ant/setup', { ...f.config, endpoint: `http://127.0.0.1:${upstream.port}/LiveApp` })).status).toBe(200);
  const attached = await call('ant/attach', { revision: 1, streamId: 'capture' }); expect(attached.status).toBe(200);
  const { job } = await attached.json(); expect((await call(`${job.id}/play`, {})).status).toBe(200);
  for (let attempts = 0; !commands.some(command => command.type === 'load') && attempts < 100; attempts++) await Bun.sleep(2);
  const load = commands.findLast(command => command.type === 'load'); expect(load?.type).toBe('load');
  if (load?.type !== 'load') throw new Error('No native load');
  expect(load.headers).toBeUndefined(); expect(load.source).not.toContain(String(upstream.port));
  expect((await fetch(load.source, { headers: { Origin: hub.origin } })).status).toBe(403);
  expect((await fetch(load.source.replace(/\/[^/]+\/capture.m3u8$/, '/wrong/capture.m3u8'))).status).toBe(404);
  expect(await (await fetch(load.source)).text()).toContain('capture000000001.ts');
  expect([...new Uint8Array(await (await fetch(load.source.replace('capture.m3u8', 'capture000000001.ts'))).arrayBuffer())]).toEqual([1, 2, 3, 4]);
  expect(JSON.stringify(hub.session.state)).not.toMatch(/private password|recording-media|reader|LiveApp/);
  hub.session.command({ type: 'stop' }); expect((await fetch(load.source)).status).toBe(404);
  expect(f.row.status).toBe('broadcasting');
});


test('Ant limits concurrent segment requests and streamed bytes without trusting Content-Length', async () => {
  const f = fixture(); await f.configure(); const job = await f.attach(); f.row.status = 'finished';
  const controller = new AbortController(), media = await f.ant.resolve(job.id, controller.signal);
  const url = media.source.replace('capture.m3u8', 'capture000000001.ts'); f.state.hold = true;
  const pending = Array.from({ length: 4 }, () => f.ant.media(new Request(url)));
  while (f.calls.filter(call => call.path.endsWith('.ts') && call.authenticated).length < 4) await Bun.sleep(1);
  expect((await f.ant.media(new Request(url))).status).toBe(429); controller.abort();
  expect((await Promise.all(pending)).every(response => response.status === 502)).toBe(true);
  f.state.hold = false; f.state.chunks = true;
  const current = await f.ant.resolve(job.id, new AbortController().signal);
  const response = await f.ant.media(new Request(current.source.replace('capture.m3u8', 'capture000000001.ts')));
  await expect(response.arrayBuffer()).rejects.toThrow();
  expect(current.canComplete!(true)).toBe(false); expect(f.ant.snapshot().jobs[0]?.status).toBe('failed');
});
