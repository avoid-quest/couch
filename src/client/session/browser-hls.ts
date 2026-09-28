import type Hls from "hls.js";
import type { DashPlayer } from "./browser-dash";

// hls.js supplies software AES for ordinary LAN HTTP pages, where WebCrypto is unavailable.
export async function createHlsPlayer(video: HTMLVideoElement): Promise<DashPlayer> {
  const { default: HlsLibrary } = await import("hls.js");
  const hls: Hls | null = HlsLibrary.isSupported() ? new HlsLibrary() : null;
  if (!hls && !video.canPlayType("application/vnd.apple.mpegurl")) throw new Error("HLS is unavailable in this browser.");
  if (!hls) delete video.dataset.sourcePtsTimeline;
  hls?.on(HlsLibrary.Events.INIT_PTS_FOUND, (_event, data) => {
    if (data.id !== "main" || !Number.isFinite(data.initPTS) || !Number.isFinite(data.timescale) || !data.timescale) return;
    // hls.js has already subtracted frag.start when computing initPTS.
    video.dataset.sourcePtsOffset = String(data.initPTS / data.timescale);
  });
  let maxHeight: number | undefined;
  let preferredAudio = "";
  let preferredText = "";
  let pendingReject: ((error: Error) => void) | null = null;
  const track = (item: { id: number; name: string; lang?: string }, index: number, active: boolean) => ({ id: index, label: item.name, language: item.lang ?? "", active });
  const selectPreferences = () => {
    if (!hls) return;
    if (maxHeight) {
      const cap = hls.levels.reduce((last, level, index) => level.height <= maxHeight! ? index : last, -1);
      if (cap < 0) throw new Error("No video quality fits this browser's limit.");
      hls.autoLevelCapping = cap;
    }
    if (preferredAudio) hls.setAudioOption({ lang: preferredAudio });
    if (preferredText) hls.setSubtitleOption({ lang: preferredText });
  };
  return {
    async attach() { hls?.attachMedia(video); },
    async load(source, startTime) {
      if (!hls) { video.src = source; video.load(); return; }
      await new Promise<void>((resolve, reject) => {
        pendingReject = reject;
        const parsed = () => { cleanup(); try { selectPreferences(); resolve(); } catch (error) { reject(error as Error); } };
        const failed = (_event: unknown, error: { fatal: boolean; details: string }) => { if (error.fatal) { cleanup(); reject(new Error(error.details)); } };
        const cleanup = () => { hls.off(HlsLibrary.Events.MANIFEST_PARSED, parsed); hls.off(HlsLibrary.Events.ERROR, failed); };
        hls.on(HlsLibrary.Events.MANIFEST_PARSED, parsed);
        hls.on(HlsLibrary.Events.ERROR, failed);
        hls.loadSource(source);
        if (startTime !== undefined) hls.startLoad(startTime);
      }).finally(() => { pendingReject = null; });
    },
    configure(config) {
      maxHeight = (config.restrictions as { maxHeight?: number } | undefined)?.maxHeight;
      preferredAudio = (config.preferredAudio as { language?: string }[] | undefined)?.[0]?.language ?? "";
      preferredText = (config.preferredText as { language?: string }[] | undefined)?.[0]?.language ?? "";
    },
    addEventListener(type, listener) {
      if (!hls) return;
      if (type === "error") hls.on(HlsLibrary.Events.ERROR, (_event, error) => { if (error.fatal) listener({ detail: { severity: 2, code: error.details } }); });
      else {
        const events = {
          trackschanged: [HlsLibrary.Events.MANIFEST_PARSED],
          audiotrackschanged: [HlsLibrary.Events.AUDIO_TRACKS_UPDATED, HlsLibrary.Events.AUDIO_TRACK_SWITCHED],
          adaptation: [HlsLibrary.Events.LEVEL_SWITCHED],
          variantchanged: [HlsLibrary.Events.LEVEL_SWITCHED],
          textchanged: [HlsLibrary.Events.SUBTITLE_TRACKS_UPDATED, HlsLibrary.Events.SUBTITLE_TRACK_SWITCH],
          manifestupdated: [HlsLibrary.Events.LEVEL_LOADED],
        }[type as "trackschanged" | "audiotrackschanged" | "adaptation" | "variantchanged" | "textchanged" | "manifestupdated"] ?? [];
        for (const event of events) hls.on(event, () => listener({}));
      }
    },
    trickPlay(rate) { video.playbackRate = rate; },
    getAudioTracks() { return hls?.audioTracks.map((item, index) => track(item, index, index === hls.audioTrack)) as ReturnType<DashPlayer["getAudioTracks"]> ?? []; },
    getTextTracks() { return hls?.subtitleTracks.map((item, index) => track(item, index, index === hls.subtitleTrack)) as ReturnType<DashPlayer["getTextTracks"]> ?? []; },
    selectAudioTrack(item) { if (hls) hls.audioTrack = Number(item.id); },
    selectTextTrack(item) { if (hls) hls.subtitleTrack = item ? Number(item.id) : -1; },
    seekRange() { const ranges = video.seekable; return ranges.length ? { start: ranges.start(0), end: ranges.end(ranges.length - 1) } : { start: 0, end: 0 }; },
    isLive() { return hls ? !!hls.levels[Math.max(0, hls.currentLevel, hls.loadLevel)]?.details?.live : video.duration === Infinity; },
    isInProgress() { return false; },
    async destroy() { pendingReject?.(new Error("HLS playback stopped.")); hls?.destroy(); delete video.dataset.sourcePtsOffset; delete video.dataset.sourcePtsTimeline; if (!hls) { video.removeAttribute("src"); video.load(); } },
  };
}
