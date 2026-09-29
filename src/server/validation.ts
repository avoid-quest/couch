import type { Action, ClientMessage, MediaTrack, PlayerState, QueueEntry } from "../shared/protocol";
import { providerForUrl } from "../shared/providers";

const id = (value: unknown): value is string => typeof value === "string" && /^[\w-]{1,80}$/.test(value);
const number = (value: unknown, max: number): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max;
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const providerIds = new Set(["youtube", "twitch", "raiplay", "bandcamp", "streamingcommunity"]);
const mediaShapes = new Set(["atom", "playlist"]);
const videoQuality = (value: unknown) => value === undefined || ["auto", "best", "1080p", "720p", "480p"].includes(String(value));
const playOptions = (value: Record<string, unknown>) => (value.playNow === undefined || typeof value.playNow === "boolean")
  && (value.fromStart === undefined || value.playNow === true && typeof value.fromStart === "boolean")
  && (value.placement === undefined || value.placement === "next" && value.playNow !== true);
const httpUrl = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length > 4096 || /[\u0000-\u0020\u007f]/.test(value)) return false;
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
};

function validEntry(value: unknown): value is QueueEntry {
  if (!object(value) || !id(value.id) || typeof value.title !== "string" || value.title.length > 200 || !value.title.trim() || typeof value.source !== "string" || value.source.length > 4096) return false;
  if (value.kind !== undefined && (value.kind !== "radio" || !httpUrl(value.source))) return false;
  try {
    const url = new URL(value.source.startsWith("web:") ? value.source.slice(4) : value.source);
    if (url.username || url.password) return false;
    return ["http:", "https:"].includes(url.protocol);
  } catch { return false; }
}

function validAction(value: unknown): value is Action {
  if (!object(value)) return false;
  switch (value.type) {
    case "navigate": return typeof value.key === "string" && ["up", "down", "left", "right", "select", "back", "home", "info"].includes(value.key);
    case "enqueue": return validEntry(value.entry) && playOptions(value);
    case "enqueueRadio": return id(value.stationId) && id(value.entryId) && playOptions(value);
    case "enqueueProvider": return providerIds.has(String(value.provider)) && mediaShapes.has(String(value.shape)) && httpUrl(value.url)
      && playOptions(value) && videoQuality(value.quality)
      && (value.collection === undefined || object(value.collection) && httpUrl(value.collection.url) && providerForUrl(value.collection.url) === value.provider
        && providerForUrl(value.url) === value.provider && typeof value.collection.title === "string" && value.collection.title.length > 0 && value.collection.title.length <= 300
        && !/[\u0000-\u001f\u007f]/.test(value.collection.title) && (value.collection.index === undefined || number(value.collection.index, 499) && Number.isInteger(value.collection.index)))
      && (value.title === undefined || typeof value.title === "string" && value.title.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value.title))
      && (value.thumbnail === undefined || httpUrl(value.thumbnail));
    case "enqueueWeb": return id(value.entryId) && httpUrl(value.url) && playOptions(value)
      && (value.title === undefined || typeof value.title === "string" && value.title.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value.title))
      && (value.thumbnail === undefined || httpUrl(value.thumbnail))
      && (value.quality === undefined || ["auto", "best", "1080p", "720p", "480p"].includes(String(value.quality)));
    case "remove": return id(value.entryId);
    case "restoreRemoved": return id(value.token);
    case "play": return id(value.entryId) && (value.fromStart === undefined || typeof value.fromStart === "boolean");
    case "move": return id(value.entryId) && (value.beforeEntryId === null || id(value.beforeEntryId));
    case "pause": return id(value.playbackId) && typeof value.paused === "boolean";
    case "seek": return id(value.playbackId) && number(value.position, 365 * 24 * 60 * 60);
    case "mute": return typeof value.muted === "boolean";
    case "volume": return number(value.volume, 100);
    case "preferences": return id(value.profileId) && object(value.preferences)
      && Object.keys(value.preferences).some(key => ["audioLanguage", "subtitleLanguage", "subtitles", "speed", "autoplay"].includes(key))
      && (value.preferences.autoplay === undefined || typeof value.preferences.autoplay === "boolean")
      && [value.preferences.audioLanguage, value.preferences.subtitleLanguage].every(language => language === undefined || typeof language === "string" && /^(?:[a-z]{2,3})?$/i.test(language))
      && (value.preferences.subtitles === undefined || typeof value.preferences.subtitles === "string" && ["auto", "off"].includes(value.preferences.subtitles))
      && (value.preferences.speed === undefined || number(value.preferences.speed, 4) && value.preferences.speed >= 0.25);
    case "savePlaybackDefault": return id(value.profileId) && id(value.playbackId) && typeof value.setting === "string" && ["audio", "subtitles", "speed"].includes(value.setting);
    case "track": return id(value.playbackId) && (value.kind === "audio" || value.kind === "subtitle") && typeof value.index === "number" && Number.isInteger(value.index) && value.index >= (value.kind === "subtitle" ? -1 : 0) && value.index <= 1024;
    case "speed": return id(value.playbackId) && number(value.speed, 4) && value.speed >= 0.25;
    case "audioDelay": case "subtitleDelay": return id(value.playbackId) && typeof value.delay === "number" && Number.isFinite(value.delay) && Math.abs(value.delay) <= 60;
    case "videoQuality": return id(value.playbackId) && typeof value.quality === "string" && ["auto", "best", "1080p", "720p", "480p"].includes(value.quality);
    case "next": return id(value.playbackId);
    case "stop": return value.playbackId === undefined || id(value.playbackId);
    case "look": return value.playback === null || id(value.playback);
    case "sendTo": return id(value.deviceId);
    case "output": return id(value.deviceId) && (value.picture === undefined || typeof value.picture === "boolean")
      && (value.level === undefined || value.level === null || number(value.level, 100)) && (value.picture !== undefined || value.level !== undefined);
    default: return false;
  }
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const playerStatuses = ["idle", "loading", "playing", "paused", "ended", "error"];
const mediaTrack = (value: unknown): value is MediaTrack => object(value) && id(value.id) && Number.isInteger(value.index) && ["video", "audio", "subtitle"].includes(value.kind as string)
  && typeof value.label === "string" && typeof value.language === "string" && typeof value.selected === "boolean";
// null when the message is not a valid player report.
export function parsePlayer(message: string): PlayerState | null {
  let value: unknown;
  try { value = JSON.parse(message); } catch { return null; }
  if (!object(value) || value.type !== "player" || !object(value.state)) return null;
  const { playbackId, status, buffering, position, duration, volume, seekable, error, speed, tracks = [], audioDelay = 0, subtitleDelay = 0 } = value.state;
  if (!(playbackId === null || id(playbackId)) || !playerStatuses.includes(status as string) || typeof buffering !== "boolean" || !finite(position) || !(duration === null || finite(duration))
    || !finite(volume) || typeof seekable !== "boolean" || !(error === null || typeof error === "string") || !finite(speed) || !finite(audioDelay) || !finite(subtitleDelay)
    || !Array.isArray(tracks) || tracks.length > 64 || !tracks.every(mediaTrack)) return null;
  return { playbackId, status: status as PlayerState["status"], buffering, position, duration, volume, seekable, error: error?.slice(0, 300) ?? null, speed, tracks: tracks.map(({ id, index, kind, label, language, selected }) => ({ id, index, kind, label: label.slice(0, 120), language: language.slice(0, 35), selected })), audioDelay, subtitleDelay };
}

export function parseCommand(message: string): ClientMessage {
  let value: unknown;
  try { value = JSON.parse(message); } catch { throw new Error("Invalid JSON command."); }
  if (!object(value) || value.type !== "command" || !id(value.requestId) || !validAction(value.action)) throw new Error("Invalid command or unsupported media source.");
  if (value.action.type === "videoQuality") {
    const { playbackId, quality } = value.action;
    return { type: "command", requestId: value.requestId, action: { type: "videoQuality", playbackId, quality } };
  }
  if (value.action.type === "navigate") return { type: "command", requestId: value.requestId, action: { type: "navigate", key: value.action.key } };
  if (value.action.type === "enqueueProvider") {
    const { provider, url, shape, title, thumbnail, playNow, quality, placement, collection } = value.action;
    return { type: "command", requestId: value.requestId, action: { type: "enqueueProvider", provider: provider as typeof provider, url, shape,
      ...(title === undefined ? {} : { title }), ...(thumbnail === undefined ? {} : { thumbnail }),
      ...(collection === undefined ? {} : { collection: { title: collection.title, url: collection.url, ...(collection.index === undefined ? {} : { index: collection.index }) } }),
      ...(playNow === undefined ? {} : { playNow }), ...(quality === undefined ? {} : { quality }), ...(placement === undefined ? {} : { placement }) } };
  }
  if (value.action.type === "enqueue") {
    const { id, title, source, kind } = value.action.entry;
    return { type: "command", requestId: value.requestId, action: { type: "enqueue", entry: { id, title, source, ...(kind ? { kind, live: true } : {}) }, ...(value.action.playNow === undefined ? {} : { playNow: value.action.playNow }), ...(value.action.placement === undefined ? {} : { placement: value.action.placement }) } };
  }
  if (value.action.type === "preferences") {
    const { audioLanguage, subtitleLanguage, subtitles, speed, autoplay } = value.action.preferences;
    return { type: "command", requestId: value.requestId, action: { type: "preferences", profileId: value.action.profileId, preferences: {
      ...(audioLanguage === undefined ? {} : { audioLanguage: audioLanguage.toLowerCase() }),
      ...(subtitleLanguage === undefined ? {} : { subtitleLanguage: subtitleLanguage.toLowerCase() }),
      ...(subtitles === undefined ? {} : { subtitles }), ...(speed === undefined ? {} : { speed }),
      ...(autoplay === undefined ? {} : { autoplay }),
    } } };
  }
  if (value.action.type === "savePlaybackDefault") {
    const { profileId, playbackId, setting } = value.action;
    return { type: "command", requestId: value.requestId, action: { type: "savePlaybackDefault", profileId, playbackId, setting } };
  }
  return value as ClientMessage;
}
