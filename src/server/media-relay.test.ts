import { afterEach, expect, test } from 'bun:test';
import { createMediaRelay } from './media-relay';

const disposals: (() => void)[] = [];
afterEach(() => { for (const dispose of disposals.splice(0)) dispose(); });
function fixture(handler: (request: Request) => Response | Promise<Response>) {
  const server = Bun.serve({ port: 0, fetch: handler });
  const relay = createMediaRelay();
  disposals.push(() => { relay.close(); void server.stop(true); });
  const issue = (path = '/') => relay.issue('attempt', { source: new URL(path, server.url).href, headers: { Authorization: 'Bearer upstream-secret' } }, () => {});
  const request = (path: string, init?: RequestInit) => relay.handle(new Request(`http://couch${path}`, init));
  return { relay, issue, request };
}

test('relays ranges, HEAD, conditional and unsatisfiable responses with private credentials', async () => {
  const { issue, request } = fixture(req => {
    expect(req.headers.get('authorization')).toBe('Bearer upstream-secret');
    expect(req.headers.get('cookie')).toBeNull();
    expect(req.headers.get('accept-encoding')).toBe('identity');
    const headers = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', ETag: '"version"', 'Last-Modified': 'Mon, 01 Jan 2024 00:00:00 GMT', 'Set-Cookie': 'secret=yes', Location: '/private' };
    if (req.headers.get('if-none-match') === '"version"') return new Response(null, { status: 304, headers });
    if (req.headers.get('range') === 'bytes=99-') return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': 'bytes */6' } });
    if (req.headers.get('range')) return new Response('bcd', { status: 206, headers: { ...headers, 'Content-Range': 'bytes 1-3/6', 'Content-Length': '3' } });
    return new Response(req.method === 'HEAD' ? null : 'abcdef', { headers: { ...headers, 'Content-Length': '6' } });
  });
  const path = issue();
  expect(path).not.toContain('secret');
  const response = (await request(path, { headers: { Range: 'bytes=1-3', Authorization: 'attacker', Cookie: 'client-secret' } }))!;
  expect(response.status).toBe(206);
  expect(response.headers.get('content-range')).toBe('bytes 1-3/6');
  expect(response.headers.get('content-length')).toBe('3');
  expect(response.headers.get('set-cookie')).toBeNull();
  expect(response.headers.get('location')).toBeNull();
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.text()).toBe('bcd');
  const head = (await request(path, { method: 'HEAD' }))!;
  expect(head.headers.get('content-length')).toBe('6');
  expect(await head.text()).toBe('');
  expect((await request(path, { headers: { 'If-None-Match': '"version"' } }))!.status).toBe(304);
  expect((await request(path, { headers: { Range: 'bytes=99-' } }))!.status).toBe(416);
  expect(await (await request(path))!.text()).toBe('abcdef');
});

test('rejects redirects and arbitrary targets', async () => {
  let hits = 0;
  const { issue, request, relay } = fixture(() => { hits++; return Response.redirect('https://example.com/private'); });
  const path = issue();
  expect((await request(path))!.status).toBe(502);
  expect((await request(`${path}?url=https://example.com`))!.status).toBe(404);
  expect(await request('/api/media/https://example.com')).toBeNull();
  expect((await request(path, { method: 'POST' }))!.status).toBe(405);
  expect(hits).toBe(1);
  for (const source of ['file:///secret', 'https://user:pass@example.com']) expect(() => relay.issue('bad', { source }, () => {})).toThrow('Invalid media resource');
});

test('revocation aborts an active response and invalidates its capability', async () => {
  const { issue, request, relay } = fixture(() => new Response(new ReadableStream({ start(stream) { stream.enqueue(new TextEncoder().encode('first')); } })));
  const path = issue();
  const reader = (await request(path))!.body!.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toBe('first');
  const pending = reader.read();
  relay.revoke('attempt');
  await expect(pending).rejects.toThrow('Media stream unavailable');
  expect((await request(path))!.status).toBe(404);
});

test('checks authorization, expires grants and bounds capability storage', async () => {
  let time = 0;
  let calls = 0;
  const relay = createMediaRelay({ now: () => time, fetch: Object.assign(async () => { calls++; return new Response('ok'); }, { preconnect: fetch.preconnect }) });
  disposals.push(() => relay.close());
  const media = { source: 'https://example.com/private' };
  const denied = relay.issue('denied', media, () => { throw new Error('private details'); });
  expect((await relay.handle(new Request(`http://couch${denied}`)))!.status).toBe(404);
  const expired = relay.issue('old', media, () => {});
  time += 24 * 60 * 60 * 1_000;
  expect((await relay.handle(new Request(`http://couch${expired}`)))!.status).toBe(404);
  expect(calls).toBe(0);
  for (let i = 0; i < 32; i++) relay.issue(String(i), media, () => {});
  expect(() => relay.issue('overflow', media, () => {})).toThrow('Media relay unavailable');
  relay.close();
  expect(() => relay.issue('closed', media, () => {})).toThrow('Media relay unavailable');
});

test('client cancellation aborts upstream work after headers arrive', async () => {
  let upstreamSignal: AbortSignal | undefined;
  const relay = createMediaRelay({ fetch: Object.assign(async (_input: unknown, init?: RequestInit) => {
    upstreamSignal = init?.signal ?? undefined;
    return new Response(new ReadableStream({ start(stream) { stream.enqueue(new Uint8Array([1])); } }));
  }, { preconnect: fetch.preconnect }) });
  disposals.push(() => relay.close());
  const path = relay.issue('cancel', { source: 'https://example.com/media' }, () => {});
  const response = (await relay.handle(new Request(`http://couch${path}`)))!;
  await response.body!.cancel();
  expect(upstreamSignal?.aborted).toBe(true);
});
