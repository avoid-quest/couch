// Resolves ticket 1's sources through Core's own resolvers and prints them as JSON for spike/main.mjs.
// Usage: bun spike/resolve.ts > sources.json
import { streamingCommunityOrigin } from "../src/shared/streamingcommunity";
import { browseTwitch } from "../src/server/providers/twitch";
import { resolveWebMedia } from "../src/server/web-media";
import { runYtDlp } from "../src/server/yt-dlp";

type Source = { name: string; kind: "video" | "audio"; delivery: "native" | "hls" | "mpegts" | "mse"; url: string; audioUrl?: string; mime?: string; audioMime?: string; note?: string; cors?: boolean; host?: string };
// yt-dlp reports HLS media playlists as m3u8 URLs, or as vixcloud /playlist/ URLs for StreamingCommunity.
const hls = (url: string) => /\.m3u8(\?|$)|\/playlist\//.test(url) ? "hls" : "native";
const sources: Source[] = [];
const add = async (name: string, make: () => Promise<Source>) => {
  try { sources.push(await make()); } catch (error) { sources.push({ name, kind: "video", delivery: "native", url: "", note: `resolve failed: ${(error as Error).message}` }); }
};

// YouTube 1080p60: Couch's selector (bv*[height<=1080]+ba, sorted res,fps,vcodec:vp9) and one run per codec Chromium might pick.
const youtube = "https://www.youtube.com/watch?v=aqz-KE-bpKQ";
for (const [label, format, sort] of [
  ["couch", "bv*[height<=1080]+ba/b[height<=1080]", "res,fps,vcodec:vp9"],
  ["avc1", "bv*[height<=1080][vcodec^=avc1]+ba[acodec^=mp4a]", "res,fps"],
  ["av01", "bv*[height<=1080][vcodec^=av01]+ba[acodec=opus]", "res,fps"],
] as const) {
  await add(`YouTube 1080p60 (${label})`, async () => {
    const info = JSON.parse(await runYtDlp(["--no-playlist", "--dump-single-json", "--format", format, "--format-sort", sort, "--", youtube]));
    const [video, audio] = info.requested_formats;
    const mime = (f: { ext: string; vcodec?: string }, codec: string) => `${f.vcodec === "none" ? "audio" : "video"}/${f.ext === "webm" ? "webm" : "mp4"}; codecs="${codec}"`;
    // googlevideo answers CORS only for https://www.youtube.com, so the spike adds the header; browsers need pass-through (ticket 7).
    return { name: `YouTube 1080p60 (${label})`, kind: "video", delivery: "mse", url: video.url, audioUrl: audio.url, mime: mime(video, video.vcodec), audioMime: mime(audio, audio.acodec), cors: true,
      note: `${video.format_id} ${video.vcodec} ${video.width}x${video.height}@${video.fps} + ${audio.format_id} ${audio.acodec}` };
  });
}

await add("Twitch HLS", async () => {
  const page = await browseTwitch({});
  const live = page.items.find(item => item.kind === "media" && item.live);
  if (!live) throw new Error("no live channel");
  const media = await resolveWebMedia(live.url);
  return { name: "Twitch HLS", kind: "video", delivery: hls(media.source), url: media.source, note: live.url };
});
// Twitch's playlist host answers 403 to Origins other than twitch.tv and localhost: play it again from a localhost page.
const twitch = sources.at(-1)!;
if (twitch.url) sources.push({ ...twitch, name: "Twitch HLS (page on localhost)", host: "localhost" });

await add("RaiPlay live", async () => {
  const media = await resolveWebMedia("https://www.raiplay.it/dirette/rai1");
  return { name: "RaiPlay live", kind: "video", delivery: hls(media.source), url: media.source, note: "https://www.raiplay.it/dirette/rai1" };
});

await add("StreamingCommunity", async () => {
  const page = `${streamingCommunityOrigin}/it/watch/1955?e=17208`;
  const media = await resolveWebMedia(page, undefined, "auto", streamingCommunityOrigin);
  return { name: "StreamingCommunity", kind: "video", delivery: hls(media.source), url: media.source, audioUrl: media.audioSource, note: page };
});

await add("Bandcamp", async () => {
  const media = await resolveWebMedia("https://c418.bandcamp.com/track/sweden");
  return { name: "Bandcamp", kind: "audio", delivery: "native", url: media.source, note: "https://c418.bandcamp.com/track/sweden" };
});

// Radio: avoid radio's MP3 Icecast and HLS stations, and Radio Paradise's AAC stream from Radio Browser.
sources.push(
  { name: "Radio MP3 Icecast (Sygma, avoid radio)", kind: "audio", delivery: "native", url: "https://radio.syg.ma/audio.mp3" },
  { name: "Radio HLS (HKCR, avoid radio)", kind: "audio", delivery: "hls", url: "https://stream-test.hkcr.live/hls/main.m3u8" },
  { name: "Radio AAC Icecast (Radio Paradise, Radio Browser)", kind: "audio", delivery: "native", url: "https://stream.radioparadise.com/aac-320" },
);

// IPTV MPEG-TS: spike/main.mjs encodes live test channels with the codec pairs DVB IPTV carries.
for (const variant of ["h264-aac", "h264-mp2", "h264-ac3", "hevc-aac", "mpeg2-mp2", "mpeg2-ac3"]) sources.push({ name: `IPTV MPEG-TS ${variant}`, kind: "video", delivery: "mpegts", url: `/ts/${variant}` });
// And a public IPTV HLS channel from iptv-org's Italy list.
sources.push({ name: "IPTV HLS (7 RadioVisione, iptv-org)", kind: "video", delivery: "hls", url: "https://stream10.xdevel.com/video1s976543-1932/stream/playlist.m3u8" });

console.log(JSON.stringify(sources, null, 2));
