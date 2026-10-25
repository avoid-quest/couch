import { randomUUID } from "node:crypto";
import type { RecognizedSong } from "../shared/radio-recognition";
import { generateShazamSignature } from "./shazam-signature";

export class SongRecognitionError extends Error {
  constructor(message: string, readonly status = 502) { super(message); }
}

const providerError = () => new SongRecognitionError("Couldn't identify this song. The recognition service may be unavailable; try again.");
const audioError = () => new SongRecognitionError("Couldn't prepare audio for song recognition.");

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue | undefined => value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : undefined;
const label = (value: unknown) => typeof value === "string" && value.length <= 512 && value.trim() ? value.trim() : undefined;
function httpsUrl(value: unknown, shazam = false) {
  if (typeof value !== "string" || value.length > 2048) return;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password
      && (!shazam || url.hostname === "shazam.com" || url.hostname.endsWith(".shazam.com"))) return url.href;
  } catch {}
}

function parseSong(value: unknown): RecognizedSong | null {
  const result = record(value);
  if (!result || !Array.isArray(result.matches)) throw providerError();
  if (!result.matches.length) return null;
  const track = record(result.track), title = label(track?.title);
  if (!track || !title) throw providerError();
  const song: RecognizedSong = { title, provider: "shazam" };
  const artist = label(track.subtitle);
  if (artist) song.artist = artist;
  if (Array.isArray(track.sections)) for (const section of track.sections) {
    const metadata = record(section)?.metadata;
    if (!Array.isArray(metadata)) continue;
    const album = metadata.map(record).find(item => item?.title === "Album");
    const text = label(album?.text);
    if (text) { song.album = text; break; }
  }
  const images = record(track.images);
  const artworkUrl = httpsUrl(images?.coverarthq) ?? httpsUrl(images?.coverart);
  const url = httpsUrl(track.url, true);
  if (artworkUrl) song.artworkUrl = artworkUrl;
  if (url) song.url = url;
  return song;
}

async function readJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw providerError();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const abort = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > 512 * 1024) throw providerError();
      chunks.push(chunk.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Shazam's unofficial protocol, using only the locally generated fingerprint.
 * Reference: MIT ShazamIO; see vendor/shazam-signature/README.md. */
export async function recognizeSong(pcm: Buffer, signal: AbortSignal,
  request: (url: string, options: RequestInit) => Promise<Response> = fetch,
  beforeRequest: () => void = () => {}): Promise<RecognizedSong | null> {
  signal.throwIfAborted();
  if (pcm.length < 32_000 || pcm.length > 12 * 32_000 || pcm.length % 2) throw audioError();
  const signature = await generateShazamSignature(pcm, signal);
  signal.throwIfAborted();
  if (!signature.peakCount) return null;
  // Fingerprinting yields to Core, so a device may have been revoked since sampling.
  beforeRequest();
  const deadline = AbortSignal.timeout(20_000);
  const cancellation = AbortSignal.any([signal, deadline]);
  try {
    const first = randomUUID().toUpperCase(), second = randomUUID().toUpperCase();
    const response = await request(`https://amp.shazam.com/discovery/v5/en-US/US/iphone/-/tag/${first}/${second}?sync=true&webv3=true&sampling=true&connected=&shazamapiversion=v3&sharehub=true&hubv5minorversion=v5.1&hidelb=true&video=v3`, {
      method: "POST", redirect: "error", signal: cancellation,
      headers: {
        "Content-Type": "application/json", Accept: "application/json", "Accept-Language": "en-US",
        "X-Shazam-Platform": "IPHONE", "X-Shazam-AppVersion": "14.1.0",
        "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 6.0.1; SM-G920F Build/MMB29K)",
      },
      body: JSON.stringify({ timezone: "UTC", signature: { uri: signature.uri, samplems: signature.samplems }, timestamp: Date.now(), context: {}, geolocation: {} }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 429) throw new SongRecognitionError("The recognition service is busy. Try again shortly.", 503);
      throw providerError();
    }
    return parseSong(await readJson(response, cancellation));
  } catch (error) {
    signal.throwIfAborted();
    if (deadline.aborted) throw new SongRecognitionError("Song recognition took too long. Try again.", 504);
    throw error instanceof SongRecognitionError ? error : providerError();
  }
}
