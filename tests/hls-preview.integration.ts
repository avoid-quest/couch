// Real Hub/Session and IPTV resolution; only upstream HTTP is a deterministic fixture.
import assert from "node:assert/strict";
import { test } from "node:test";
import https from "node:https";
import { PassThrough, Readable } from "node:stream";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { createHub } from "../src/server/hub";
import { openStore } from "../src/server/store";
import { createGuide } from "../src/server/iptv";
import { createPreviewResolver } from "../src/server/preview-manifest";
import { playbackPreviewResponse } from "../src/server/playback-preview";
import type { Action, ServerMessage, SessionState } from "../src/shared/protocol";

const declaration = '#EXT-X-IMAGE-STREAM-INF:BANDWIDTH=10,RESOLUTION=160x90,CODECS="jpeg",URI="images.m3u8"\n';
const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nvideo.m3u8\n' + declaration;
const media = '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6.006,\nsegment.ts\n#EXT-X-ENDLIST\n';
const images = '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-IMAGES-ONLY\n#EXTINF:6.006,\n#EXT-X-TILES:RESOLUTION=160x90,LAYOUT=2x2,DURATION=2.002\npreview.jpg\n#EXT-X-ENDLIST\n';
const until = async (check: () => boolean) => {
  const end = Date.now() + 5000;
  while (!check()) { assert.ok(Date.now() < end, 'State did not arrive'); await new Promise(resolve => setTimeout(resolve, 10)); }
};

for (const mode of ['vod', 'live', 'absent', 'discontinuous', 'missing-image']) test(`direct HTTP HLS ${mode} uses existing probe bytes and keeps preview optional`, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'couch-hls-direct-'));
  const databasePath = join(directory, 'couch.sqlite'), deviceId = 'd'.repeat(43);
  const store = openStore(databasePath, true), token = store.pair(deviceId, 'Screen'); store.close();
  const fetcher = globalThis.fetch, upstream: string[] = [], preview: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith('https://source.example/')) return fetcher(input, init);
    upstream.push(url);
    const text = url.endsWith('master.m3u8') ? mode === 'absent' ? master.replace(declaration, '') : master
      : mode === 'live' ? media.replace('#EXT-X-ENDLIST\n', '') : mode === 'discontinuous' ? media.replace('#EXTINF:', '#EXT-X-DISCONTINUITY\n#EXTINF:') : media;
    const response = new Response(text, { headers: { 'Content-Type': 'application/vnd.apple.mpegurl' } });
    Object.defineProperty(response, 'url', { value: url.replace('/original/', '/redirected/') });
    return response;
  });
  const nativeRequest = https.request;
  t.mock.method(https, 'request', (url: URL, options: import('node:http').RequestOptions, callback: (response: import('node:http').IncomingMessage) => void) => {
    if (url.hostname !== 'source.example') return nativeRequest(url, options, callback);
    preview.push(url.href);
    assert.equal((options.headers as Record<string, string>)['user-agent'], 'Couch');
    assert.equal((options.headers as Record<string, string>).authorization, undefined);
    const request = new PassThrough({ autoDestroy: false });
    request.once('finish', () => {
      const response = Readable.from([Buffer.from(images)]) as import('node:http').IncomingMessage;
      response.statusCode = mode === 'missing-image' ? 404 : 200; response.rawHeaders = []; response.headers = {};
      Object.defineProperty(response, 'socket', { value: { remoteAddress: '93.184.216.34' } });
      callback(response);
    });
    return request;
  });
  const hub = await createHub({ databasePath, hostToken: 'h'.repeat(64), hostname: '127.0.0.1', port: 0 });
  const socket = new WebSocket(`${hub.origin.replace('http:', 'ws:')}/api/ws?token=${token}&device=${deviceId}&audio=1&video=1`, { headers: { Origin: hub.origin } });
  t.after(async () => { socket.terminate(); await hub.close(); rmSync(directory, { recursive: true, force: true }); });
  const messages: ServerMessage[] = [];
  let state: SessionState | undefined;
  socket.on('message', data => { const message = JSON.parse(String(data)) as ServerMessage; messages.push(message); if (message.type === 'state') state = message.state; });
  await until(() => !!state);
  const action: Action = { type: 'enqueue', entry: { id: 'hls', title: 'HLS', source: 'https://source.example/original/master.m3u8' }, playNow: true, deviceId };
  socket.send(JSON.stringify({ type: 'command', requestId: 'play', action }));
  await until(() => messages.some(message => message.type === 'player' && message.command.type === 'load'));
  assert.equal(state!.player.error, null);
  assert.deepEqual(upstream.slice(0, 2), ['https://source.example/original/master.m3u8', 'https://source.example/redirected/video.m3u8']);
  assert.equal(preview.length, 0, 'No preview request on playback startup');
  const url = `${hub.origin}/api/playback-preview?playbackId=${state!.player.playbackId}`;
  assert.equal((await fetch(url)).status, 401);
  assert.equal(preview.length, 0);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(response.status, mode === 'vod' ? 200 : 204);
  assert.deepEqual(preview, ['vod', 'missing-image'].includes(mode) ? ['https://source.example/redirected/images.m3u8'] : []);
  assert.ok(!JSON.stringify(messages).includes('images.m3u8'), 'Session strips the Core-only descriptor');
  assert.ok(!JSON.stringify(messages).includes('#EXTM3U'), 'Reused manifest bodies stay private');
  if (mode === 'vod') {
    const metadata = await response.json() as { duration: number; cues: unknown[] };
    assert.equal(metadata.duration, 6.006); assert.equal(metadata.cues.length, 3);
    assert.ok(!JSON.stringify(metadata).includes('source.example'));
  }
});

for (const mode of ['vod', 'live', 'absent', 'malformed', 'child-404']) test(`IPTV ${mode} reuses its redirected master and discovers previews only on demand`, async () => {
  const requests: string[] = [], previews: string[] = [];
  const guide = createGuide({ databasePath: ':memory:', fetch: (async input => {
    const url = String(input); requests.push(url);
    if (url.endsWith('/channels.m3u')) return new Response('#EXTM3U\n#EXTINF:-1 tvg-id="one",Channel\nhttps://source.example/master.m3u8\n');
    if (url.endsWith('/master.m3u8') && !url.includes('/final/')) return new Response(null, { status: 302, headers: { location: '/final/master.m3u8' } });
    return new Response(mode === 'absent' ? master.replace(declaration, '') : master);
  }) as typeof fetch });
  const call = (path: string, body?: unknown) => guide.handle(new Request(`https://couch.test/api/iptv${path}`, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), () => ({ device: null, authority: 'host', claimAvailable: false }));
  try {
    assert.equal((await call('/sources', { name: 'HLS', playlistUrl: 'https://source.example/channels.m3u' })).status, 201);
    const { channels } = await (await call('/guide')).json() as { channels: { id: string }[] };
    const playable = await guide.getPlayable(channels[0]!.id, new AbortController().signal, false);
    assert.equal(playable.source, 'https://source.example/master.m3u8');
    assert.equal(requests.length, 3, 'Only the existing guide and redirected master reads');
    const resolver = createPreviewResolver((async input => {
      const url = String(input); previews.push(url);
      if (url.endsWith('/video.m3u8')) return new Response(mode === 'live' ? media.replace('#EXT-X-ENDLIST\n', '') : media);
      return new Response(mode === 'malformed' ? images.replace('DURATION=2.002', 'DURATION=0') : images, { status: mode === 'child-404' ? 404 : 200 });
    }) as typeof fetch);
    const result = await playbackPreviewResponse(new Request('https://couch.test/api/playback-preview'), async () => playable.preview, () => {}, undefined, resolver);
    assert.equal(result.status, mode === 'vod' ? 200 : 204);
    assert.deepEqual(previews, mode === 'absent' ? [] : mode === 'live' ? ['https://source.example/final/video.m3u8'] : ['https://source.example/final/video.m3u8', 'https://source.example/final/images.m3u8']);
    assert.equal(requests.length, 3, 'Preview never rereads the guide or its master');
  } finally { guide.close(); }
});
