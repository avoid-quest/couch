import type { Action, PlayerState, ProfilePlaybackPreferences } from "./protocol";

export type PlaybackDefaultSetting = Extract<Action, { type: "savePlaybackDefault" }>["setting"];

export function playbackDefault(player: PlayerState, setting: PlaybackDefaultSetting): Partial<ProfilePlaybackPreferences> | null {
  if (!["playing", "paused"].includes(player.status)) return null;
  if (setting === "speed") return player.speed !== undefined && Number.isFinite(player.speed) && player.speed >= 0.25 && player.speed <= 4 ? { speed: player.speed } : null;
  const track = player.tracks?.find(track => track.kind === (setting === "audio" ? "audio" : "subtitle") && track.selected);
  if (setting === "subtitles" && !track) return { subtitles: "off" };
  const language = track?.language?.toLowerCase();
  if (!language || !/^[a-z]{2,3}$/.test(language) || language === "und") return null;
  return setting === "audio" ? { audioLanguage: language } : { subtitleLanguage: language, subtitles: "auto" };
}
