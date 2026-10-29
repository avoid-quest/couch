import { expect, test } from "bun:test";
import { hlsImageTrack, hlsPreview, hlsPreviewVod, parseHlsImages } from "../src/server/hls-preview";
import { createPreviewResolver, previewManifestLimit, vttPreview } from "../src/server/preview-manifest";
import { parseMedia } from "../src/server/web-media";
import { previewAt } from "../src/shared/playback-preview";
import { playbackPreviewResponse, createPreviewImages } from "../src/server/playback-preview";
import { readFileSync } from "node:fs";

const base = "https://media.example/path/master.m3u8";
const declaration = '#EXT-X-IMAGE-STREAM-INF:BANDWIDTH=16460,RESOLUTION=320x180,CODECS="jpeg",URI="images/index.m3u8"';
const master = `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nvideo.m3u8\n${declaration}\n`;
const track = hlsImageTrack(master, base)!.image;
const playlist = (body: string, images = true) => `#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:VOD\n${images ? '#EXT-X-IMAGES-ONLY\n' : ''}${body}#EXT-X-ENDLIST\n`;
const video = playlist("#EXTINF:30.030,\nvideo.ts\n", false);
const images = playlist("#EXTINF:6.006,\none.jpg\n#EXTINF:9.009,\n#EXT-X-TILES:RESOLUTION=160x90,LAYOUT=2x2,DURATION=2.002\ntwo.jpg\n#EXT-X-GAP\n#EXTINF:3.003,\nmissing.jpg\n#EXTINF:3.003,\n#EXT-X-TILES:RESOLUTION=160x90,LAYOUT=2x2,DURATION=2.002\nthree.jpg\n");
const signal = () => new AbortController().signal;

test("declared JPEG tracks alone are eligible; attribute commas, quality selection and redirected bases are respected", () => {
  expect(track).toEqual({ url: "https://media.example/path/images/index.m3u8", width: 320, height: 180 });
  expect(hlsImageTrack(master + declaration.replace('320x180', '160x90').replace('images/index', 'smaller'), base)?.image.width).toBe(160);
  expect(hlsPreview(base, master)?.text).toBe(master);
  for (const body of [master.replace('IMAGE-STREAM', 'I-FRAME-STREAM'), master.replace('CODECS="jpeg"', 'CODECS="jpeg,png"'), master.replace('URI="images/index.m3u8"', 'URI=images/index.m3u8'), master.replace('BANDWIDTH=16460,', ''), master.replace('RESOLUTION=320x180', 'RESOLUTION=9000x180'), master.replace('CODECS="jpeg"', 'CODECS="jpeg",CODECS="png"'), master.replace('jpeg', 'avc1'), master.replace('images/index.m3u8', 'file:///private'), master.replace('images/index.m3u8', 'https://user:password@media.example/private'), master.replace('images/index.m3u8', '{$path}/index.m3u8'), master + (declaration + "\n").repeat(17), master + "\nx".repeat(20001), master + '#'.repeat(previewManifestLimit)]) expect(hlsImageTrack(body, base)).toBeUndefined();
  expect(hlsImageTrack(master + declaration.replace('jpeg', 'png'), base)?.image).toEqual(track);
  expect(hlsImageTrack(master.replace('CODECS="jpeg"', 'CODECS="jpeg",VIDEO="other"'), base)).toBeUndefined();
});

test("single images and row-major tiles preserve fractions, clamp EXTINF, hold the last tile, and keep gaps", () => {
  const source = parseHlsImages(images, track)!;
  expect(source.images).toEqual(['one.jpg', 'two.jpg', 'three.jpg'].map(name => `https://media.example/path/images/${name}`));
  expect(source.metadata.kind).toBe('cues');
  if (source.metadata.kind !== 'cues') throw new Error();
  const cues = source.metadata.cues;
  expect(cues).toHaveLength(7);
  expect(cues[0]).toEqual({ image: 0, startTime: 0, endTime: 6.006 });
  expect(cues[3]?.coords).toEqual({ x: 0, y: 90 });
  expect(cues[4]?.endTime).toBe(6.006 + 9.009); // last tile holds for 3.003, not 2.002
  expect(previewAt(source.metadata, 16)).toBeNull();
  expect(cues[6]?.endTime).toBe(source.metadata.duration); // partially occupied last grid
  expect(cues[6]?.endTime! - cues[6]?.startTime!).toBeCloseTo(1.001, 10);
  const tail = parseHlsImages(playlist('#EXTINF:1,\none.jpg\n#EXT-X-GAP\n#EXTINF:2,\nmissing.jpg\n'), track)!;
  expect(tail.metadata.duration).toBe(3);
  expect(previewAt(tail.metadata, 3)).toBeNull();
  expect(hlsPreviewVod(video)).toBe(true);
  const exact = playlist('#EXT-X-TILES:RESOLUTION=160x90,LAYOUT=2x2,DURATION=2.002\n#EXTINF:6.006,\nthree.jpg\n');
  const fractional = parseHlsImages(exact, track)!.metadata;
  expect(fractional.kind === 'cues' && fractional.cues.length).toBe(3);
  expect(fractional.kind === 'cues' && fractional.cues.at(-1)?.endTime).toBe(6.006);
});

test("unmapped live, sliding, EVENT, discontinuities and unsupported image archive transports are absent", () => {
  for (const body of [images.replace('#EXT-X-ENDLIST', ''), images.replace('MEDIA-SEQUENCE:0', 'MEDIA-SEQUENCE:1'), images.replace('TYPE:VOD', 'TYPE:EVENT'), images.replace('#EXTINF:6.006,', '#EXT-X-DISCONTINUITY\n#EXTINF:6.006,'), images.replace('#EXTINF:6.006,', '#EXT-X-DISCONTINUITY-SEQUENCE:1\n#EXTINF:6.006,'), images.replace('#EXT-X-IMAGES-ONLY\n', ''), images.replace('#EXTINF:6.006,', '#EXT-X-BYTERANGE:200@0\n#EXTINF:6.006,'), images.replace('#EXTINF:6.006,', '#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXTINF:6.006,'), images.replace('#EXTINF:6.006,', '#EXT-X-MAP:URI="init"\n#EXTINF:6.006,'), images.replace('#EXTINF:6.006,', '#EXT-X-SKIP:SKIPPED-SEGMENTS=2\n#EXTINF:6.006,')]) expect(parseHlsImages(body, track)).toBeUndefined();
  for (const body of [video.replace('#EXT-X-ENDLIST', ''), video.replace('MEDIA-SEQUENCE:0', 'MEDIA-SEQUENCE:2'), video.replace('#EXTINF:', '#EXT-X-DISCONTINUITY\n#EXTINF:'), master]) expect(hlsPreviewVod(body)).toBe(false);
});

test("malformed timings, geometry, URLs and duplicate or incomplete segments cannot produce cues", () => {
  for (const body of [images.replace('6.006', '-1'), images.replace('6.006', 'NaN'), images.replace('6.006', '0'), images.replace('6.006', '1e3'), images.replace('6.006,', '6.006'), images.replace('DURATION=2.002', 'DURATION=0'), images.replace('LAYOUT=2x2', 'LAYOUT=0x2'), images.replace('LAYOUT=2x2', 'LAYOUT=100x100'), images.replace('RESOLUTION=160x90', 'RESOLUTION=640x360'), images.replace('one.jpg', 'https://u:p@images.example/a.jpg'), images.replace('one.jpg', 'file:///private'), images.replace('one.jpg', '#EXTINF:1,\none.jpg'), images.replace('#EXT-X-ENDLIST', '#EXTINF:1,\n#EXT-X-ENDLIST'), images.replace('#EXT-X-ENDLIST', '#EXT-X-ENDLIST\n#EXT-X-ENDLIST'), images.replace('#EXT-X-TARGETDURATION:6', '#EXT-X-TARGETDURATION:bad')]) expect(parseHlsImages(body, track)).toBeUndefined();
});

test("image playlists are bounded by 4000 cues, 128 URLs, one day, 4M pixels and 8192 pixels per axis", () => {
  const segments = (count: number, unique: boolean) => playlist(Array.from({ length: count }, (_, i) => `#EXTINF:1,\n${unique ? i : 0}.jpg\n`).join(''));
  expect(parseHlsImages(segments(4000, false), track)?.metadata.kind).toBe('cues');
  expect(parseHlsImages(segments(4001, false), track)).toBeUndefined();
  expect(parseHlsImages(segments(128, true), track)?.images).toHaveLength(128);
  expect(parseHlsImages(segments(129, true), track)).toBeUndefined();
  expect(parseHlsImages(playlist('#EXTINF:86400,\none.jpg\n#EXTINF:1,\ntwo.jpg\n'), track)).toBeUndefined();
  for (const layout of ['52x1', '10x28']) expect(parseHlsImages(playlist(`#EXTINF:100,\n#EXT-X-TILES:RESOLUTION=160x90,LAYOUT=${layout},DURATION=1\none.jpg\n`), track)).toBeUndefined();
});

test("web HLS uses the selected manifest and media without extraction work, behind richer previews", () => {
  const info = { url: 'https://media.example/chosen.m3u8', protocol: 'm3u8_native', manifest_url: base, vcodec: 'avc1', http_headers: { Authorization: 'private', Cookie: 'private' } };
  expect(parseMedia(info, '').preview).toEqual(hlsPreview(base, undefined, { url: info.url }));
  expect(parseMedia({ ...info, couch_preview_vtt: 'https://images.example/track.vtt' }, '').preview).toEqual(vttPreview('https://images.example/track.vtt'));
  expect(parseMedia({ ...info, is_live: true }, '').preview).toBeUndefined();
  expect(parseMedia({ ...info, vcodec: 'none' }, '').preview).toBeUndefined();
  expect(parseMedia({ ...info, protocol: 'https', url: 'https://media.example/video.mp4' }, '').preview).toBeUndefined();
});

test("lazy chains use relative final redirect bases, one track, no credentials, and share completed metadata", async () => {
  const calls: string[] = [];
  const read = createPreviewResolver((async (input, init) => {
    const url = String(input); calls.push(url);
    expect(new Headers(init?.headers).get('user-agent')).toBe('Couch'); expect(init?.credentials).toBe('omit'); expect(init?.redirect).toBe('manual');
    expect([...new Headers(init?.headers).keys()].sort()).toEqual(['accept', 'user-agent']);
    if (url === base) return new Response(null, { status: 302, headers: { location: 'https://cdn.example/redirect/master.m3u8' } });
    if (url.endsWith('master.m3u8')) return new Response(master);
    if (url.endsWith('video.m3u8')) return new Response(video);
    if (url.endsWith('index.m3u8')) return new Response(null, { status: 307, headers: { location: '../final/images.m3u8' } });
    return new Response(images);
  }) as typeof fetch);
  const descriptor = hlsPreview(base)!;
  expect(calls).toHaveLength(0);
  const [first, second] = await Promise.all([read(descriptor, signal()), read(descriptor, signal())]);
  expect(second).toBe(first); expect(calls).toHaveLength(5);
  expect(first?.images[0]).toBe('https://cdn.example/redirect/final/one.jpg');
  expect(JSON.stringify(first?.metadata)).not.toContain('https:');
  await read(descriptor, signal()); expect(calls).toHaveLength(5);
});

test("absence, live timelines and nested image masters stop without guessing or probing other tracks", async () => {
  for (const [root, media, child, expectedCalls] of [[master.replace('IMAGE-STREAM', 'I-FRAME-STREAM'), video, images, 1], [master, video.replace('#EXT-X-ENDLIST', ''), images, 2], [master, video, master, 3], [master, video, '', 3]] as const) {
    let calls = 0;
    const read = createPreviewResolver((async () => new Response([root, media, child][calls++], { status: child === '' && calls === 3 ? 404 : 200 })) as typeof fetch);
    expect(await read(hlsPreview(base), signal())).toBeUndefined(); expect(calls).toBe(expectedCalls);
  }
});

test("reused bytes and downloaded bodies share one 512 KiB budget; all redirects share a three-hop bound", async () => {
  let calls = 0;
  const redirect = createPreviewResolver((async () => { calls++; return new Response(null, { status: 302, headers: { location: base } }); }) as typeof fetch);
  await expect(redirect(hlsPreview(base), signal())).rejects.toThrow('redirected'); expect(calls).toBe(4);
  for (const declared of [true, false]) for (const reuse of [true, false]) {
    let canceled = false;
    const padding = master + '#' + 'a'.repeat(4096) + '\n';
    const bytes = previewManifestLimit - Buffer.byteLength(padding) - Buffer.byteLength(video) + 1;
    const read = createPreviewResolver((async input => {
      if (!reuse && String(input) === base) return new Response(padding);
      if (!reuse && String(input).endsWith('video.m3u8')) return new Response(video);
      return new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(bytes)); }, cancel() { canceled = true; } }), { headers: declared ? { 'content-length': String(bytes) } : {} });
    }) as typeof fetch);
    await expect(read(reuse ? hlsPreview(base, padding, { url: 'https://media.example/video.m3u8', text: video }) : hlsPreview(base), signal())).rejects.toThrow('size limit');
    expect(canceled).toBe(true);
  }
});

test("declared JPEG tracks verify image signatures and keep optional failure timestamp-only", async () => {
  const source = parseHlsImages(images, track)!;
  for (const [file, status] of [['twitch-preview.jpg', 200], ['preview-sheet.png', 204]] as const) {
    const read = createPreviewImages((async () => new Response(readFileSync(new URL(`./fixtures/${file}`, import.meta.url)))) as typeof fetch);
    const result = await playbackPreviewResponse(new Request('https://couch.test/api/playback-preview?image=0'), async () => source, () => {}, read);
    expect(result.status).toBe(status);
  }
});
