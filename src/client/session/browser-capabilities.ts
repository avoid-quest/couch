import type { BrowserMediaCapabilities } from "../../shared/protocol";

export async function browserMediaCapabilities(): Promise<BrowserMediaCapabilities> {
  const supported = async (configuration: MediaDecodingConfiguration) => {
    try { return (await navigator.mediaCapabilities?.decodingInfo(configuration))?.supported === true; }
    catch { return false; }
  };
  const [mp4H264Aac, mp3] = await Promise.all([
    supported({ type: "file", video: { contentType: 'video/mp4; codecs="avc1.640028"', width: 1920, height: 1080, bitrate: 20_000_000, framerate: 30 }, audio: { contentType: 'audio/mp4; codecs="mp4a.40.2"', channels: "2", samplerate: 48_000, bitrate: 192_000 } }),
    supported({ type: "file", audio: { contentType: "audio/mpeg", channels: "2", samplerate: 48_000, bitrate: 320_000 } }),
  ]);
  return { mp4H264Aac, mp3 };
}
