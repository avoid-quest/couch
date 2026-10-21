import type { Action, PlayerState, ProfilePlaybackPreferences } from "./protocol";

/** The speeds the player and Settings offer; a speed saved outside them joins the list where it is shown. */
export const playbackSpeeds = [0.5, 0.75, 1, 1.25, 1.5, 2];

export type PlaybackDefaultSetting = Extract<Action, { type: "savePlaybackDefault" }>["setting"];

export function playbackDefault(player: Pick<PlayerState, "status" | "speed" | "tracks">, setting: PlaybackDefaultSetting): Partial<ProfilePlaybackPreferences> | null {
  if (!["playing", "paused"].includes(player.status)) return null;
  if (setting === "speed") return player.speed !== undefined && Number.isFinite(player.speed) && player.speed >= 0.25 && player.speed <= 4 ? { speed: player.speed } : null;
  const track = player.tracks?.find(track => track.kind === (setting === "audio" ? "audio" : "subtitle") && track.selected);
  if (setting === "subtitles" && !track) return { subtitles: "off" };
  const language = track?.language?.toLowerCase();
  if (!language || !/^[a-z]{2,3}$/.test(language) || language === "und") return null;
  return setting === "audio" ? { audioLanguage: language } : { subtitleLanguage: language, subtitles: "auto" };
}
