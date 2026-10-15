import type { MediaTrack, PlaybackSummary, QueueEntry } from "../../../shared/protocol";
import { isRadio } from "../../../shared/radio";

export function isAudioOnly(playback: PlaybackSummary | undefined, current: QueueEntry | null | undefined, tracks: MediaTrack[] | undefined): boolean {
  // A live receiver reports only its requested tracks, not every track in the source.
  if (playback?.liveSourceId) return !!playback.audioOnly;
  return !!playback?.audioOnly || isRadio(current) || !!tracks?.some(track => track.kind === "audio") && !tracks.some(track => track.kind === "video" && track.selected);
}
