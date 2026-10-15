import type { LiveFailedMessage, LiveSignalMessage, LiveUploadFailedMessage } from "../shared/live-input";
import type { Action, ClientMessage, MediaTrack, PlayerState, QueueEntry } from "../shared/protocol";
import { providerForUrl } from "../shared/providers";
import { isDeviceSharing } from "../shared/device-sharing";
import { safePlaybackError } from "./playback-log";

const id = (value: unknown): value is string => typeof value === "string" && /^[\w-]{1,80}$/.test(value);
const number = (value: unknown, max: number): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max;
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const providerIds = new Set(["youtube", "twitch", "raiplay", "bandcamp", "soundcloud", "streamingcommunity", "movies123"]);
const mediaShapes = new Set(["atom", "playlist"]);
const videoQuality = (value: unknown) => value === undefined || ["auto", "best", "1080p", "720p", "480p"].includes(String(value));
const playOptions = (value: Record<string, unknown>) => (value.playNow === undefined || typeof value.playNow === "boolean")
  && (value.fromStart === undefined || value.playNow === true && typeof value.fromStart === "boolean")
  && (value.placement === undefined || value.placement === "next" && value.playNow !== true)
  && (value.deviceId === undefined || value.playNow === true && id(value.deviceId));
const httpUrl = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length > 4096 || /[\u0000-\u0020\u007f]/.test(value)) return false;
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
};
const collectionLink = (value: unknown, provider: unknown) => object(value) && httpUrl(value.url) && providerForUrl(value.url) === provider
  && typeof value.title === "string" && value.title.length > 0 && value.title.length <= 300 && !/[\u0000-\u001f\u007f]/.test(value.title);

function validEntry(value: unknown): value is QueueEntry {
  if (!object(value) || value.liveSourceId !== undefined || !id(value.id) || typeof value.title !== "string" || value.title.length > 200 || !value.title.trim() || typeof value.source !== "string" || value.source.length > 4096) return false;
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
    case "publishLive": return id(value.sourceId) && typeof value.uploadToken === "string" && /^[a-f0-9]{64}$/.test(value.uploadToken) && typeof value.kind === "string" && ["microphone", "system-audio", "screen"].includes(value.kind)
      && typeof value.audio === "boolean" && typeof value.video === "boolean"
      && (value.kind === "screen" ? value.video === true : value.audio === true && value.video === false)
      && (value.name === undefined || typeof value.name === "string" && value.name.trim().length > 0 && value.name.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value.name));
    case "endLive": return id(value.sourceId);
    case "playLive": return id(value.sourceId) && playOptions({ ...value, playNow: value.playNow === undefined ? true : value.playNow });
    case "inSync": return typeof value.inSync === "boolean";
    case "control": return id(value.deviceId);
    case "text": return id(value.deviceId) && id(value.token) && typeof value.text === "string" && value.text.length <= 4096 && !/[\u0000-\u001f\u007f]/.test(value.text) && (value.submit === undefined || typeof value.submit === "boolean");
    case "navigate": return (value.deviceId === undefined || id(value.deviceId)) && typeof value.key === "string" && ["up", "down", "left", "right", "select", "back", "home", "info"].includes(value.key);
    case "enqueue": return validEntry(value.entry) && playOptions(value);
    case "enqueueRadio": return id(value.stationId) && id(value.entryId) && playOptions(value);
    case "enqueueProvider": return providerIds.has(String(value.provider)) && mediaShapes.has(String(value.shape)) && httpUrl(value.url)
      && playOptions(value) && videoQuality(value.quality)
      && (value.collection === undefined || object(value.collection) && collectionLink(value.collection, value.provider) && providerForUrl(value.url) === value.provider
        && (value.collection.parent === undefined || collectionLink(value.collection.parent, value.provider))
        && (value.collection.index === undefined || number(value.collection.index, 499) && Number.isInteger(value.collection.index)))
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
    case "mute": return typeof value.muted === "boolean" && (value.deviceId === undefined || id(value.deviceId));
    case "volume": return number(value.volume, 100) && (value.deviceId === undefined || id(value.deviceId));
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
    case "sharing": return isDeviceSharing(value.sharing);
    case "solo": return id(value.deviceId);
    case "allSpeakers": return number(value.level, 100) && Number.isInteger(value.level);
    case "output": return id(value.deviceId) && (value.picture === undefined || typeof value.picture === "boolean")
      && (value.level === undefined || number(value.level, 100)) &&(value.delay === undefined || number(value.delay, 5000))
      && (value.picture !== undefined || value.level !== undefined || value.delay !== undefined);
    default: return false;
  }
}

export function parseLiveSignal(message: string): LiveSignalMessage | null {
  let value: unknown;
  try { value = JSON.parse(message); } catch { return null; }
  if (!object(value) || value.type !== "liveSignal" || !id(value.peerId) || !object(value.signal)) return null;
  const { description, candidate } = value.signal;
  if ((description === undefined) === (candidate === undefined)) return null;
  if (description !== undefined && (!object(description) || typeof description.type !== "string" || !["offer", "answer"].includes(description.type) || typeof description.sdp !== "string" || description.sdp.length > 32_768)) return null;
  if (candidate !== undefined && candidate !== null && (!object(candidate) || typeof candidate.candidate !== "string" || candidate.candidate.length > 4096
    || candidate.sdpMid !== undefined && candidate.sdpMid !== null && (typeof candidate.sdpMid !== "string" || candidate.sdpMid.length > 256)
    || candidate.sdpMLineIndex !== undefined && candidate.sdpMLineIndex !== null && (!number(candidate.sdpMLineIndex, 255) || !Number.isInteger(candidate.sdpMLineIndex))
    || candidate.usernameFragment !== undefined && candidate.usernameFragment !== null && (typeof candidate.usernameFragment !== "string" || candidate.usernameFragment.length > 256))) return null;
  // Rebuild the envelope so unvalidated sibling fields are never forwarded.
  const signal = description !== undefined ? { description: { type: description.type as "offer" | "answer", sdp: description.sdp as string } }
    : { candidate: candidate === null ? null : { candidate: candidate!.candidate as string, ...(candidate!.sdpMid !== undefined ? { sdpMid: candidate!.sdpMid as string | null } : {}), ...(candidate!.sdpMLineIndex !== undefined ? { sdpMLineIndex: candidate!.sdpMLineIndex as number | null } : {}), ...(candidate!.usernameFragment !== undefined ? { usernameFragment: candidate!.usernameFragment as string | null } : {}) } };
  return { type: "liveSignal", peerId: value.peerId, signal };
}

export function parseLiveFailed(message: string): LiveFailedMessage | null {
  let value: unknown;
  try { value = JSON.parse(message); } catch { return null; }
  if (!object(value) || value.type !== "liveFailed" || !id(value.peerId) || typeof value.error !== "string") return null;
  return { type: "liveFailed", peerId: value.peerId, error: safePlaybackError(value.error) };
}

export function parseLiveUploadFailed(message: string): LiveUploadFailedMessage | null {
  let value: unknown;
  try { value = JSON.parse(message); } catch { return null; }
  if (!object(value) || value.type !== "liveUploadFailed" || !id(value.sourceId) || typeof value.error !== "string") return null;
  return { type: "liveUploadFailed", sourceId: value.sourceId, error: safePlaybackError(value.error) };
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
  const { playbackId, status, buffering, position, duration, volume, seekable, error, speed, tracks = [], audioDelay, subtitleDelay = 0 } = value.state;
  if (!(playbackId === null || id(playbackId)) || !playerStatuses.includes(status as string) || typeof buffering !== "boolean" || !finite(position) || !(duration === null || finite(duration))
    || !finite(volume) || typeof seekable !== "boolean" || !(error === null || typeof error === "string") || !finite(speed) || audioDelay !== undefined && !finite(audioDelay) || !finite(subtitleDelay)
    || !Array.isArray(tracks) || tracks.length > 64 || !tracks.every(mediaTrack)) return null;
  return { playbackId, status: status as PlayerState["status"], buffering, position, duration, volume, seekable, error: error === null ? null : safePlaybackError(error), speed, tracks: tracks.map(({ id, index, kind, label, language, selected }) => ({ id, index, kind, label: label.slice(0, 120), language: language.slice(0, 35), selected })), audioDelay, subtitleDelay };
}

export function parseCommand(message: string): ClientMessage {
  let value: unknown;
  try { value = JSON.parse(message); } catch { throw new Error("Invalid JSON command."); }
  if (!object(value) || value.type !== "command" || !id(value.requestId) || !validAction(value.action) || !(value.targetDeviceId === undefined || id(value.targetDeviceId))) throw new Error("Invalid command or unsupported media source.");
  const guard = value.targetDeviceId === undefined ? {} : { targetDeviceId: value.targetDeviceId };
  if (value.action.type === "videoQuality") {
    const { playbackId, quality } = value.action;
    return { type: "command", requestId: value.requestId, ...guard, action: { type: "videoQuality", playbackId, quality } };
  }
  if (value.action.type === "navigate") return { type: "command", requestId: value.requestId, ...guard, action: { type: "navigate", key: value.action.key, ...(value.action.deviceId === undefined ? {} : { deviceId: value.action.deviceId }) } };
  if (value.action.type === "enqueueProvider") {
    const { provider, url, shape, title, thumbnail, playNow, quality, placement, collection, deviceId } = value.action;
    return { type: "command", requestId: value.requestId, ...guard, action: { type: "enqueueProvider", provider: provider as typeof provider, url, shape,
      ...(title === undefined ? {} : { title }), ...(thumbnail === undefined ? {} : { thumbnail }),
      ...(collection === undefined ? {} : { collection: { title: collection.title, url: collection.url, ...(collection.index === undefined ? {} : { index: collection.index }), ...(collection.parent ? { parent: { title: collection.parent.title, url: collection.parent.url } } : {}) } }),
      ...(playNow === undefined ? {} : { playNow }), ...(quality === undefined ? {} : { quality }), ...(placement === undefined ? {} : { placement }), ...(deviceId === undefined ? {} : { deviceId }) } };
  }
  if (value.action.type === "enqueue") {
    const { id, title, source, kind } = value.action.entry;
    return { type: "command", requestId: value.requestId, ...guard, action: { type: "enqueue", entry: { id, title, source, ...(kind ? { kind, live: true } : {}) }, ...(value.action.playNow === undefined ? {} : { playNow: value.action.playNow }), ...(value.action.placement === undefined ? {} : { placement: value.action.placement }), ...(value.action.deviceId === undefined ? {} : { deviceId: value.action.deviceId }) } };
  }
  if (value.action.type === "preferences") {
    const { audioLanguage, subtitleLanguage, subtitles, speed, autoplay } = value.action.preferences;
    return { type: "command", requestId: value.requestId, ...guard, action: { type: "preferences", profileId: value.action.profileId, preferences: {
      ...(audioLanguage === undefined ? {} : { audioLanguage: audioLanguage.toLowerCase() }),
      ...(subtitleLanguage === undefined ? {} : { subtitleLanguage: subtitleLanguage.toLowerCase() }),
      ...(subtitles === undefined ? {} : { subtitles }), ...(speed === undefined ? {} : { speed }),
      ...(autoplay === undefined ? {} : { autoplay }),
    } } };
  }
  if (value.action.type === "savePlaybackDefault") {
    const { profileId, playbackId, setting } = value.action;
    return { type: "command", requestId: value.requestId, ...guard, action: { type: "savePlaybackDefault", profileId, playbackId, setting } };
  }
  return value as ClientMessage;
}
