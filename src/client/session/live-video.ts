import type { LiveVideoFrameRate, LiveVideoQuality } from "../../shared/live-input";

const pictureSize = (track: MediaStreamTrack, quality: LiveVideoQuality) => {
  const { width = 1920, height = 1080 } = track.getSettings();
  const scale = quality === "original" ? 1 : Math.min(1, (quality === "720p" ? 1280 : 1920) / width, (quality === "720p" ? 720 : 1080) / height);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
};

/** A per-receiver ceiling, not a reservation; WebRTC still controls congestion. */
export async function configureLiveVideo(sender: RTCRtpSender, quality: LiveVideoQuality, frameRate: LiveVideoFrameRate) {
  const { width, height } = pictureSize(sender.track!, quality);
  const parameters = sender.getParameters();
  const maxBitrate = Math.min(40_000_000, Math.round((quality === "720p" ? 4_000_000 : 8_000_000 * width * height / (1920 * 1080)) * frameRate / 60));
  for (const encoding of parameters.encodings) Object.assign(encoding, { maxBitrate, maxFramerate: frameRate });
  // Keep text readable when congestion requires adaptation.
  parameters.degradationPreference = "maintain-resolution";
  await sender.setParameters(parameters);
}

/** Codec support alone says nothing about hardware. Keep all negotiated fallbacks. */
export async function preferLiveVideoCodec(transceiver: RTCRtpTransceiver, quality: LiveVideoQuality, frameRate: LiveVideoFrameRate) {
  if (!transceiver.setCodecPreferences || !navigator.mediaCapabilities?.encodingInfo) return;
  const codecs = RTCRtpSender.getCapabilities("video")?.codecs ?? [];
  const size = pictureSize(transceiver.sender.track!, quality);
  for (const codec of codecs.filter(codec => codec.mimeType.toLowerCase() === "video/h264")) {
    try {
      const info = await navigator.mediaCapabilities.encodingInfo({ type: "webrtc", video: {
        contentType: `${codec.mimeType}${codec.sdpFmtpLine ? `;${codec.sdpFmtpLine}` : ""}`,
        ...size, bitrate: transceiver.sender.getParameters().encodings[0]?.maxBitrate ?? 8_000_000, framerate: frameRate,
      } });
      if (info.supported && info.smooth && info.powerEfficient) {
        transceiver.setCodecPreferences([codec, ...codecs.filter(other => other !== codec)]);
        return;
      }
    } catch { /* Unsupported queries keep the browser's codec order. */ }
  }
}
