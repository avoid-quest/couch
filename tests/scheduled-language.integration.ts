import { test } from 'node:test';
import { executableName, nodeExecutables } from "./executable.fixture";
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AudioCodec, Identity, Roles, SendspinClient } from '@sonn-audio/node-sendspin';
import { createSendspin, type SyncedLoad } from '../src/server/sendspin';
import { prepareSource } from '../src/server/source-preparation';
import type { PlayerState } from '../src/shared/protocol';

const ffmpeg = process.env.COUCH_TEST_FFMPEG ?? 'ffmpeg';
const until = async (check: () => boolean, label: string) => { const end = Date.now() + 6000; while (!check()) { if (Date.now() > end) throw new Error(label); await new Promise(resolve => setTimeout(resolve, 10)); } };
const cases = [
  { name: 'carried Italian identity overrides English preference and stale index', audioSelection: { index: 0, label: 'Italian', language: 'it' }, audioTrack: 0, language: 'en', expected: 'it' },
  { name: 'explicit English index overrides Italian preference', audioTrack: 0, language: 'it', expected: 'en' },
  { name: 'initial Italian profile preference chooses the non-default rendition', language: 'it', expected: 'it' },
  { name: 'broadcast HLS preserves carried Italian with standalone stream zero', audioSelection: { index: 1, label: 'Italian', language: 'it' }, audioTrack: 1, language: 'en', expected: 'it', live: true },
  { name: 'standalone Italian rendition retains logical index one but decodes stream zero', audioSelection: { index: 1, label: 'Italian', language: 'it' }, audioTrack: 1, language: 'en', expected: 'it', standalone: true },
  { name: 'muxed input maps the explicitly selected second audio stream', audioSelection: { index: 1, label: 'Italian', language: 'it' }, audioTrack: 1, language: 'en', expected: 'it', muxed: true },
];
for (const choice of cases) test(choice.name, { timeout: 15000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'couch-language-'));
  for (const [language, frequency] of [['en', 440], ['it', 880]] as const) execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=${frequency}:sample_rate=48000`, '-t', '6', '-ac', '2', '-c:a', 'aac', '-f', 'adts', join(directory, `${language}.aac`)]);
  if (choice.muxed) execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000', '-t', '6', '-map', '0:a', '-map', '1:a', '-c:a', 'pcm_s16le', '-metadata:s:a:0', 'language=eng', '-metadata:s:a:1', 'language=ita', join(directory, 'movie.mka')]);
  const decoder = join(directory, executableName('decode')), launches = join(directory, 'launches');
  // The worker launches the real codec directly; this observer records its PID/arguments.
  const codecs = nodeExecutables(directory, { workers: true, native: { path: decoder, target: ffmpeg, log: launches } });
  writeFileSync(decoder, "fixture", { mode: 0o755 });
  const startedDecoders = () => readFileSync(launches, 'utf8').trim().split('\n');
  const requested: string[] = [];
  const master = '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="English",LANGUAGE="en",DEFAULT=YES,URI="en.m3u8"\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="Italian",LANGUAGE="it",DEFAULT=NO,URI="it.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=900000,AUDIO="a",CODECS="avc1.640028,mp4a.40.2"\npicture.m3u8\n';
  let audioMaster = '';
  const server = createServer((request, response) => {
    const path = request.url!; requested.push(path);
    if (path === '/master.m3u8' || path === '/audio-master.m3u8') { response.setHeader('Content-Type', 'application/vnd.apple.mpegurl'); response.end(path === '/master.m3u8' ? master : audioMaster); }
    else if (/^\/(en|it)\.m3u8$/.test(path)) { response.setHeader('Content-Type', 'application/vnd.apple.mpegurl'); response.end(`#EXTM3U\n#EXT-X-TARGETDURATION:7\n#EXTINF:6,\n${path.slice(1, 3)}.aac\n${choice.live ? '' : '#EXT-X-ENDLIST\n'}`); }
    else if (/^\/(en|it)\.aac$/.test(path) || path === '/movie.mka') { response.setHeader('Content-Type', path.endsWith('aac') ? 'audio/aac' : 'audio/x-matroska'); response.end(readFileSync(join(directory, path.slice(1)))); }
    else response.writeHead(404).end();
  });
  const identity = Identity.generate(), states: PlayerState[] = [], chunks: Buffer[] = [];
  const core = createSendspin({ name: 'Language fixture', admit: id => id === identity.peerId, changed() {}, ffmpeg: async () => decoder });
  server.on('upgrade', (request, socket, head) => core.upgrade(request, socket as import('node:net').Socket, head));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const prepared = await prepareSource({ source: `${origin}/master.m3u8` }, { picture: false, sound: true }, AbortSignal.timeout(3000));
  assert.ok(prepared.audioManifest); audioMaster = prepared.audioManifest.text;
  const client = new SendspinClient(identity.peerId, 'Software listener', [Roles.PLAYER], { playerSupport: { supported_formats: [{ codec: AudioCodec.PCM, sample_rate: 48000, channels: 2, bit_depth: 16 }], buffer_capacity: 512 * 1024, supported_commands: [] } });
  client.addAudioChunkListener((_timestamp, data) => chunks.push(Buffer.from(data)));
  const group = core.group('language', state => states.push(state));
  t.after(async () => { group.close(); core.close(); await client.disconnect(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await codecs.close(); rmSync(directory, { recursive: true, force: true }); });
  await client.connect(origin.replace('http:', 'ws:'), { timeoutMs: 3000 });
  group.members([{ deviceId: identity.peerId, level: 100 }]);
  const load: SyncedLoad = { type: 'load', playbackId: 'language', source: `${origin}/${choice.muxed ? 'movie.mka' : choice.standalone ? 'it.m3u8' : 'audio-master.m3u8'}`, live: choice.live, audioSelection: choice.audioSelection, audioTrack: choice.audioTrack, preferences: { audioLanguage: choice.language, subtitleLanguage: '', subtitles: 'off', speed: 1, audioDelay: 0 } };
  group.send(load);
  await until(() => chunks.length >= 8 || states.at(-1)?.status === 'error', 'no decoded PCM');
  assert.notEqual(states.at(-1)?.status, 'error', states.at(-1)?.error ?? undefined);
  const energy = (frequency: number, bytes: Buffer) => {
    let re = 0, im = 0;
    for (let i = 0; i < bytes.length / 4; i++) { const sample = bytes.readInt16LE(i * 4) / 32768; re += sample * Math.cos(2 * Math.PI * frequency * i / 48000); im += sample * Math.sin(2 * Math.PI * frequency * i / 48000); }
    return re * re + im * im;
  };
  const assertLanguage = () => {
    const bytes = Buffer.concat(chunks.slice(0, 8)), english = energy(440, bytes), italian = energy(880, bytes);
    assert.ok(choice.expected === 'it' ? italian > english * 100 : english > italian * 100, `decoded wrong tone: en=${english}, it=${italian}`);
    const selected = states.at(-1)?.tracks?.find(track => track.kind === 'audio' && track.selected);
    assert.equal(selected?.language, choice.expected);
    assert.equal(selected?.index, choice.expected === 'it' ? 1 : 0);
  };
  assertLanguage();
  if (!choice.muxed) {
    assert.ok(requested.includes(`/${choice.expected}.aac`));
    assert.ok(!requested.includes(`/${choice.expected === 'it' ? 'en' : 'it'}.aac`));
    assert.ok(!requested.includes('/picture.m3u8'));
  }
  // Explicit seek restarts decoding but keeps this load's selected input.
  if (choice.live) return; // Broadcasts do not offer a source seek timeline.
  const beforeSeek = startedDecoders();
  chunks.length = 0; group.send({ type: 'seek', playbackId: 'language', position: 1 });
  await until(() => chunks.length >= 8, 'no PCM after seek'); assertLanguage();
  const afterSeek = startedDecoders();
  assert.equal(afterSeek.length, beforeSeek.length + 1, 'seek starts exactly one new decoder');
  assert.notEqual(afterSeek.at(-1)!.split('|')[0], beforeSeek.at(-1)!.split('|')[0], 'the previous decoder was replaced');
  assert.match(afterSeek.at(-1)!, / -ss 1 -i /, 'the new decoder seeks in source time');
});
