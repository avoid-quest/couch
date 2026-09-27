import { fileURLToPath } from "node:url";
import type { Action, ClientMessage, QueueEntry } from "../shared/protocol";
import { providerForUrl } from "../shared/providers";

const id = (value: unknown): value is string => typeof value === "string" && /^[\w-]{1,80}$/.test(value);
const memberId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 128 && !/[\u0000-\u0020\u007f]/.test(value);
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

function validEntry(value: unknown, trusted: boolean): value is QueueEntry {
  if (!object(value) || !id(value.id) || typeof value.title !== "string" || value.title.length > 200 || !value.title.trim() || typeof value.source !== "string" || value.source.length > 4096) return false;
  if (value.kind !== undefined && (value.kind !== "radio" || !httpUrl(value.source))) return false;
  try {
    const url = new URL(value.source.startsWith("web:") ? value.source.slice(4) : value.source);
    if (url.username || url.password) return false;
    if (["http:", "https:"].includes(url.protocol)) return true;
    if (value.source.startsWith("web:")) return false;
    return trusted && url.protocol === "file:" && !fileURLToPath(url).includes("\0");
  } catch { return false; }
}

function validAction(value: unknown, trusted: boolean): value is Action {
  if (!object(value)) return false;
  switch (value.type) {
    case "navigate": return typeof value.key === "string" && ["up", "down", "left", "right", "select", "back", "home", "info"].includes(value.key);
    case "enqueue": return validEntry(value.entry, trusted) && playOptions(value);
    case "enqueueLibrary": case "enqueueJellyfin": return id(value.itemId) && id(value.entryId) && playOptions(value);
    case "enqueueRadio": return id(value.stationId) && id(value.entryId) && playOptions(value);
    case "enqueueAlbum": return id(value.albumId) && playOptions(value);
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
    case "selectTarget": case "groupReconnect": return id(value.targetId);
    case "groupMembers": return id(value.targetId) && Array.isArray(value.memberIds) && value.memberIds.length > 0 && value.memberIds.length <= 32 && value.memberIds.every(memberId) && new Set(value.memberIds).size === value.memberIds.length;
    case "groupVolume": return id(value.targetId) && memberId(value.memberId) && number(value.volume, 100) && typeof value.muted === "boolean";
    case "pause": return id(value.playbackId) && typeof value.paused === "boolean";
    case "seek": return id(value.playbackId) && number(value.position, 365 * 24 * 60 * 60);
    case "mute": return typeof value.muted === "boolean";
    case "volume": return number(value.volume, 100);
    case "preferences": return id(value.profileId) && object(value.preferences)
      && Object.keys(value.preferences).some(key => ["audioLanguage", "subtitleLanguage", "subtitles", "speed", "replayGain", "autoplay"].includes(key))
      && (value.preferences.autoplay === undefined || typeof value.preferences.autoplay === "boolean")
      && [value.preferences.audioLanguage, value.preferences.subtitleLanguage].every(language => language === undefined || typeof language === "string" && /^(?:[a-z]{2,3})?$/i.test(language))
      && (value.preferences.subtitles === undefined || typeof value.preferences.subtitles === "string" && ["auto", "off"].includes(value.preferences.subtitles))
      && (value.preferences.speed === undefined || number(value.preferences.speed, 4) && value.preferences.speed >= 0.25)
      && (value.preferences.replayGain === undefined || typeof value.preferences.replayGain === "string" && ["off", "track", "album"].includes(value.preferences.replayGain));
    case "savePlaybackDefault": return id(value.profileId) && id(value.playbackId) && typeof value.setting === "string" && ["audio", "subtitles", "speed", "replayGain"].includes(value.setting);
    case "track": return id(value.playbackId) && (value.kind === "audio" || value.kind === "subtitle") && typeof value.index === "number" && Number.isInteger(value.index) && value.index >= (value.kind === "subtitle" ? -1 : 0) && value.index <= 1024;
    case "speed": return id(value.playbackId) && number(value.speed, 4) && value.speed >= 0.25;
    case "replayGain": return id(value.playbackId) && typeof value.mode === "string" && ["off", "track", "album"].includes(value.mode);
    case "audioDelay": case "subtitleDelay": return id(value.playbackId) && typeof value.delay === "number" && Number.isFinite(value.delay) && Math.abs(value.delay) <= 60;
    case "videoQuality": return id(value.playbackId) && typeof value.quality === "string" && ["auto", "best", "1080p", "720p", "480p"].includes(value.quality);
    case "goLive": case "next": return id(value.playbackId);
    case "stop": return value.playbackId === undefined || id(value.playbackId);
    default: return false;
  }
}

export function parseCommand(message: string, trusted: boolean): ClientMessage {
  let value: unknown;
  try { value = JSON.parse(message); } catch { throw new Error("Invalid JSON command."); }
  if (!object(value) || value.type !== "command" || !id(value.requestId) || !validAction(value.action, trusted)) throw new Error("Invalid command or unsupported media source.");
  if (value.action.type === "videoQuality") {
    const { playbackId, quality } = value.action;
    return { type: "command", requestId: value.requestId, action: { type: "videoQuality", playbackId, quality } };
  }
  if (value.action.type === "goLive") return { type: "command", requestId: value.requestId, action: { type: "goLive", playbackId: value.action.playbackId } };
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
    const { audioLanguage, subtitleLanguage, subtitles, speed, replayGain, autoplay } = value.action.preferences;
    return { type: "command", requestId: value.requestId, action: { type: "preferences", profileId: value.action.profileId, preferences: {
      ...(audioLanguage === undefined ? {} : { audioLanguage: audioLanguage.toLowerCase() }),
      ...(subtitleLanguage === undefined ? {} : { subtitleLanguage: subtitleLanguage.toLowerCase() }),
      ...(subtitles === undefined ? {} : { subtitles }), ...(speed === undefined ? {} : { speed }),
      ...(replayGain === undefined ? {} : { replayGain }),
      ...(autoplay === undefined ? {} : { autoplay }),
    } } };
  }
  if (value.action.type === "savePlaybackDefault") {
    const { profileId, playbackId, setting } = value.action;
    return { type: "command", requestId: value.requestId, action: { type: "savePlaybackDefault", profileId, playbackId, setting } };
  }
  if (value.action.type === "replayGain") {
    const { playbackId, mode } = value.action;
    return { type: "command", requestId: value.requestId, action: { type: "replayGain", playbackId, mode } };
  }
  return value as ClientMessage;
}
