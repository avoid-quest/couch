import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Pass-through (#644 Delivery): a Device that can't fetch a source itself because of its
// Origin, CORS or headers gets the bytes through Core. Core asks each source the way the
// Device would and relays only what fails: Twitch's playlists answer 403 to a browser
// User-Agent sent with a LAN Origin, while its segments allow every Origin (#644 ticket 7).
// Playlists are rewritten, other bytes stream through with their Range. Nothing is transcoded.
type Target = { origin: string; userAgent: string };
type Media = { source: string; audioSource?: string; mpegts?: boolean; mpv?: boolean };
type Relay = { target: Target; headers: Record<string, string>; segments?: Promise<boolean> };
type Kind = "playlist" | "bytes";

const playlistType = (type: string | null, url: string) => /mpegurl/i.test(type ?? "") || /\.m3u8$/i.test(new URL(url).pathname);
// Tags whose URI is another playlist; every other URI is a segment, key or map.
const playlistTag = /^#EXT-X-(?:MEDIA|I-FRAME-STREAM-INF|RENDITION-REPORT):/;
const forwarded = ["content-type", "content-length", "content-range", "accept-ranges", "cache-control", "last-modified", "etag"];

// Core asks as the Device would, minus its Origin, plus the headers yt-dlp needs (their names are lower case).
const relayHeaders = (relay: Relay) => ({ "user-agent": relay.target.userAgent, ...relay.headers, "accept-encoding": "identity" });

// Asks as the Device would, with its Origin and User-Agent. hls.js and mpegts.js read with
// CORS, so they also need the source to share it. A source Core can't fetch either stays
// direct, so the Device reports the source's own error. An HTTPS page can't load http://
// media at all (mixed content), so Core relays those whenever it can fetch them (#644 ticket 8).
async function probe(url: string, relay: Relay, cors: boolean, signal: AbortSignal) {
  const ask = (headers: Record<string, string>) => fetch(url, { headers, signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) })
    .then(async response => { await response.body?.cancel().catch(() => {}); return response; }, () => null);
  const mixed = relay.target.origin.startsWith("https:") && url.startsWith("http:");
  const response = await ask(mixed ? relayHeaders(relay) : { origin: relay.target.origin, "user-agent": relay.target.userAgent });
  const playlist = playlistType(response?.headers.get("content-type") ?? null, url);
  if (!response) return { direct: true, playlist };
  if (mixed) return { direct: !response.ok, playlist };
  if (!response.ok) return { direct: !(await ask(relayHeaders(relay)))?.ok, playlist };
  const shared = ["*", relay.target.origin].includes(response.headers.get("access-control-allow-origin") ?? "");
  return { direct: shared || !(cors || playlist), playlist };
}

// Relay addresses are signed for one Playback, so Core relays only what it resolved for the
// current Playback and the playlists it relayed; it is never an open proxy. Only Devices
// that were sent a load command learn them, like subtitle paths.
// `current` says whether a transport still plays, in whichever Playback (#644 ticket 9).
export function createPassThrough(current: (playbackId: string) => boolean) {
  const key = randomBytes(32);
  const relays = new Map<string, Relay>();
  const sign = (playbackId: string, kind: string, url: string) => createHmac("sha256", key).update(`${playbackId}\n${kind}\n${url}`).digest("base64url");
  const link = (playbackId: string, relay: Relay, kind: Kind, url: string) => `${relay.target.origin}/api/relay/${playbackId}/${kind}/${sign(playbackId, kind, url)}?${new URLSearchParams({ url })}`;

  async function rewrite(text: string, base: string, playbackId: string, relay: Relay) {
    const lines = text.split(/\r?\n/);
    const master = lines.some(line => /^#EXT-X-(?:STREAM-INF|MEDIA):/.test(line));
    const absolute = (uri: string) => { try { const url = new URL(uri, base); return /^https?:$/.test(url.protocol) ? url.href : null; } catch { return null; } };
    const first = master ? null : lines.find(line => line.trim() && !line.startsWith("#"));
    // Segments stay direct when the Device may read them (Twitch's allow every Origin).
    if (first && absolute(first.trim())) relay.segments ??= probe(absolute(first.trim())!, relay, true, AbortSignal.timeout(5000)).then(answer => answer.direct);
    const segments = await relay.segments ?? true;
    const to = (uri: string, playlist: boolean) => {
      const url = absolute(uri);
      return !url ? uri : playlist ? link(playbackId, relay, "playlist", url) : segments ? url : link(playbackId, relay, "bytes", url);
    };
    return lines.map(line => line.startsWith("#")
      ? line.replace(/([:,]URI=)"([^"]+)"/g, (_, name: string, uri: string) => `${name}"${to(uri, playlistTag.test(line))}"`)
      : line.trim() ? to(line.trim(), master) : line).join("\n");
  }

  return {
    // Chooses Direct or Pass-through for each stream this Device will fetch.
    async prepare<T extends Media>(playbackId: string, media: T, headers: Record<string, string>, target: Target | null, signal: AbortSignal): Promise<T> {
      if (!target || media.mpv) return media;
      const relay: Relay = { target, headers };
      const route = async (url: string) => {
        const answer = await probe(url, relay, !!media.mpegts, signal);
        return answer.direct ? url : link(playbackId, relay, answer.playlist ? "playlist" : "bytes", url);
      };
      const [source, audioSource] = await Promise.all([route(media.source), media.audioSource && route(media.audioSource)]);
      for (const id of relays.keys()) if (!current(id)) relays.delete(id);
      if (source !== media.source || audioSource !== media.audioSource) relays.set(playbackId, relay);
      return { ...media, source, ...(audioSource ? { audioSource } : {}) };
    },
    // GET /api/relay/<playbackId>/<kind>/<signature>?url=<source>
    async serve(request: Request) {
      const address = new URL(request.url);
      const [playbackId = "", kind = "", signature = ""] = address.pathname.split("/").slice(3);
      const url = address.searchParams.get("url") ?? "";
      const relay = relays.get(playbackId);
      const expected = Buffer.from(sign(playbackId, kind, url));
      const given = Buffer.from(signature);
      if (!relay || !current(playbackId) || given.length !== expected.length || !timingSafeEqual(given, expected)) return new Response(null, { status: 404 });
      const range = request.headers.get("range");
      const upstream = await fetch(url, { headers: { ...relayHeaders(relay), ...(range ? { range } : {}) }, signal: request.signal });
      if (kind === "playlist" && upstream.ok) return new Response(await rewrite(await upstream.text(), upstream.url, playbackId, relay), { headers: { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store" } });
      const headers = new Headers();
      for (const name of forwarded) { const value = upstream.headers.get(name); if (value) headers.set(name, value); }
      return new Response(upstream.body, { status: upstream.status, headers });
    },
  };
}
