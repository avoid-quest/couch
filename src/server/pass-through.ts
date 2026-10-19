import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { publicFetch, stripCrossOriginHeaders } from "./public-network";
import { boundedBytes } from "./iptv-feeds";
import { serve, type Listener } from "./http";

// Pass-through (#644 Delivery): a Device that can't fetch a source itself because of its
// Origin, CORS or headers gets the bytes through Core. Core asks each source the way the
// Device would and relays only what fails: Twitch's playlists answer 403 to a browser
// User-Agent sent with a LAN Origin, while its segments allow every Origin (#644 ticket 7).
// Playlists are rewritten, other bytes stream through with their Range. Nothing is transcoded.
type Target = { origin: string; userAgent: string };
type Media = { source: string; audioSource?: string; mpegts?: boolean; mpv?: boolean; publicNetwork?: boolean };
// refused: the last error status the source answered, which a browser reports as an unsupported format.
type Relay = { id: string; playbackId: string; credentialOrigin: string; target: Target; headers: Record<string, string>; publicNetwork?: boolean; createdAt: number; segments?: Promise<boolean>; refused?: number };
type Kind = "playlist" | "bytes";

const playlistType = (type: string | null, url: string) => /mpegurl/i.test(type ?? "") || /\.m3u8$/i.test(new URL(url).pathname);
// Tags whose URI is another playlist; every other URI is a segment, key or map.
const playlistTag = /^#EXT-X-(?:MEDIA|I-FRAME-STREAM-INF|RENDITION-REPORT):/;
const forwarded = ["content-type", "content-length", "content-range", "accept-ranges", "cache-control", "last-modified", "etag"];
// Native HLS decoders check segment extensions before reading bytes. Preserve a
// media suffix outside the encoded upstream query (which may end in a token).
const mediaExtension = (url: string) => {
  try { return /\.(aac|ac3|eac3|flac|m4a|m4s|m4v|mp3|mp4|mpeg|mpg|mts|m2ts|ts|ogg|opus|oga|ogv|wav|webm|vtt|srt|key|m3u8)$/i.exec(new URL(url).pathname)?.[1]?.toLowerCase() ?? "ts"; }
  catch { return "ts"; } // Malformed unsigned requests still fail capability validation.
};

// A server can mislabel an extensionless playlist. Inspect a small prefix before
// giving bytes to a decoder, which otherwise may follow the original HLS URIs.
async function sniffPlaylist(response: Response): Promise<{ response: Response; playlist: boolean }> {
  if (!response.body) return { response, playlist: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0, ended = false;
  while (size < 32) {
    const next = await reader.read();
    if (next.done) { ended = true; break; }
    chunks.push(next.value); size += next.value.length;
  }
  const prefix = Buffer.concat(chunks);
  const body = new ReadableStream<Uint8Array>({
    start(controller) { if (prefix.length) controller.enqueue(prefix); if (ended) controller.close(); },
    async pull(controller) { const next = await reader.read(); if (next.done) controller.close(); else controller.enqueue(next.value); },
    cancel(reason) { return reader.cancel(reason); },
  });
  const replay = new Response(body, { status: response.status, headers: response.headers });
  Object.defineProperty(replay, "url", { value: response.url });
  return { response: replay, playlist: /^\uFEFF?#EXTM3U/.test(prefix.toString("utf8")) };
}

// Keep source credentials on their original origin, including when a playlist
// names another host, port or scheme. Provider context may follow CDN children.
const relayHeaders = (relay: Relay, url: string) => {
  const headers = new Headers(relay.headers);
  if (!headers.has("user-agent")) headers.set("user-agent", relay.target.userAgent);
  headers.set("accept-encoding", "identity");
  if (new URL(url).origin !== relay.credentialOrigin) stripCrossOriginHeaders(headers);
  return Object.fromEntries(headers);
};

// Asks as the Device would, with its Origin and User-Agent. hls.js and mpegts.js read with
// CORS, so they also need the source to share it. A source Core can't fetch either stays
// direct, so the Device reports the source's own error. An HTTPS page can't load http://
// media at all (mixed content), so Core relays those whenever it can fetch them (#644 ticket 8).
async function probe(url: string, relay: Relay, cors: boolean, signal: AbortSignal, request: typeof fetch = fetch) {
  const ask = (headers: Record<string, string>) => request(url, { headers, signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) })
    .then(async response => { await response.body?.cancel().catch(() => {}); return response; }, () => null);
  const mixed = relay.target.origin.startsWith("https:") && url.startsWith("http:");
  const response = await ask(mixed ? relayHeaders(relay, url) : { origin: relay.target.origin, "user-agent": relay.target.userAgent });
  const playlist = playlistType(response?.headers.get("content-type") ?? null, url);
  if (!response) return { direct: true, playlist };
  if (mixed) return { direct: !response.ok, playlist };
  if (!response.ok) return { direct: !(await ask(relayHeaders(relay, url)))?.ok, playlist };
  const shared = ["*", relay.target.origin].includes(response.headers.get("access-control-allow-origin") ?? "");
  return { direct: shared || !(cors || playlist), playlist };
}

// Relay addresses are signed for one Playback, so Core relays only what it resolved for the
// current Playback and the playlists it relayed; it is never an open proxy. Only Devices
// that were sent a load command learn them, like subtitle paths.
// `current` says whether a transport still plays, in whichever Playback (#644 ticket 9).
export function createPassThrough(current: (playbackId: string) => boolean, publicRequest: typeof fetch = publicFetch) {
  const key = randomBytes(32);
  const relays = new Map<string, Relay>();
  let internal: Promise<Listener> | undefined;
  let closed = false;
  const sign = (playbackId: string, relayId: string, kind: string, url: string) => `${relayId}-${createHmac("sha256", key).update(`${playbackId}\n${relayId}\n${kind}\n${url}`).digest("base64url")}.${kind === "playlist" ? "m3u8" : mediaExtension(url)}`;
  const link = (relay: Relay, kind: Kind, url: string) => `${relay.target.origin}/api/relay/${relay.playbackId}/${kind}/${sign(relay.playbackId, relay.id, kind, url)}?${new URLSearchParams({ url })}`;

  async function rewrite(text: string, base: string, relay: Relay) {
    const lines = text.split(/\r?\n/);
    const master = lines.some(line => /^#EXT-X-(?:STREAM-INF|MEDIA):/.test(line));
    // Public providers never hand a player an unchecked URI, including keys, maps,
    // low-latency parts and renditions. Variable substitution and content steering
    // can introduce destinations after rewriting, so fail closed on those features.
    if (relay.publicNetwork && (/#EXT-X-(?:DEFINE|CONTENT-STEERING):/.test(text) || text.includes("{$"))) throw new Error("This playlist uses unsupported external destinations.");
    const absolute = (uri: string) => {
      try {
        const url = new URL(uri, base);
        if (/^https?:$/.test(url.protocol) && !url.username && !url.password) return url.href;
      } catch { /* Reject malformed public media references. */ }
      if (relay.publicNetwork) throw new Error("This playlist contains an unsupported destination.");
      return null;
    };
    const first = master ? null : lines.find(line => line.trim() && !line.startsWith("#"));
    // Segments stay direct when the Device may read them (Twitch's allow every Origin).
    if (!relay.publicNetwork && first && absolute(first.trim())) relay.segments ??= probe(absolute(first.trim())!, relay, true, AbortSignal.timeout(5000)).then(answer => answer.direct);
    const segments = relay.publicNetwork ? false : await relay.segments ?? true;
    const to = (uri: string, playlist: boolean) => {
      const url = absolute(uri);
      return !url ? uri : playlist ? link(relay, "playlist", url) : segments ? url : link(relay, "bytes", url);
    };
    return lines.map(raw => {
      const line = raw.trim();
      if (!line.startsWith("#")) return line ? to(line, master) : line;
      if (relay.publicNetwork && /[:,]\s*[\w-]*URI\s*=/.test(line.replace(/([:,]URI=)"[^"]+"/g, ""))) throw new Error("This playlist contains an unsupported destination attribute.");
      return line.replace(/([:,]URI=)"([^"]+)"/g, (_, name: string, uri: string) => `${name}"${to(uri, playlistTag.test(line))}"`);
    }).join("\n");
  }

  const api = {
    // Native decoders always reach a literal loopback address, independently of
    // the UI listener's COUCH_HOST/TLS configuration. This listener serves only
    // the same signed, active playback capabilities as the public relay route.
    async coreOrigin(): Promise<string> {
      if (closed) throw new Error("The media relay is closed.");
      internal ??= serve({ hostname: "127.0.0.1", port: 0, maxRequestBodySize: 0,
        fetch: request => request.method === "GET" && new URL(request.url).pathname.startsWith("/api/relay/") ? api.serve(request) : Promise.resolve(new Response(null, { status: 404 })),
        websocket: { maxPayload: 0, open() {}, message() {}, close() {} },
      });
      const listener = await internal;
      if (closed) throw new Error("The media relay is closed.");
      return `http://127.0.0.1:${listener.port}`;
    },
    async close() { closed = true; relays.clear(); await (await internal)?.stop(); },
    refused: (playbackId: string) => [...relays.values()].find(relay => relay.playbackId === playbackId && relay.refused)?.refused,
    // Chooses Direct or Pass-through for each stream this Device will fetch, and says whether the source is HLS.
    async prepare<T extends Media>(playbackId: string, media: T, headers: Record<string, string>, target: Target | null, signal: AbortSignal): Promise<T> {
      signal.throwIfAborted();
      if (closed) throw new Error("The media relay is closed.");
      if (!target || media.mpv && !media.publicNetwork) {
        if (media.publicNetwork) throw new Error("Public media requires a protected playback route.");
        return media;
      }
      // Core and Devices can prepare the same Playback with different upstream
      // headers. One capability per preparation keeps every child on its route.
      // The single source-header map authorizes only the main source's origin;
      // a separate audio URL or redirected playlist cannot expand that trust.
      const relay: Relay = { id: randomBytes(16).toString("hex"), playbackId, credentialOrigin: new URL(media.source).origin, target, headers, publicNetwork: media.publicNetwork, createdAt: Date.now() };
      const route = async (url: string) => {
        const answer = await probe(url, relay, !!media.mpegts, signal, relay.publicNetwork ? publicRequest : fetch);
        return { url: answer.direct && !relay.publicNetwork ? url : link(relay, answer.playlist ? "playlist" : "bytes", url), playlist: answer.playlist };
      };
      const [main, audio] = await Promise.all([route(media.source), media.audioSource ? route(media.audioSource) : undefined]);
      signal.throwIfAborted();
      if (closed) throw new Error("The media relay is closed.");
      const source = main.url, audioSource = audio?.url;
      // Quality changes prepare a new transport before it becomes current.
      for (const [id, saved] of relays) if (!current(saved.playbackId) && Date.now() - saved.createdAt > 60_000) relays.delete(id);
      if (source !== media.source || audioSource !== media.audioSource) relays.set(relay.id, relay);
      return { ...media, publicNetwork: undefined, source, ...(audioSource ? { audioSource } : {}), ...(main.playlist ? { hls: true } : {}) };
    },
    // GET /api/relay/<playbackId>/<kind>/<signature>?url=<source>
    async serve(request: Request): Promise<Response> {
      const address = new URL(request.url);
      const [playbackId = "", kind = "", signature = ""] = address.pathname.split("/").slice(3);
      const url = address.searchParams.get("url") ?? "";
      const relayId = signature.split("-", 1)[0] ?? "";
      const relay = relays.get(relayId);
      const expected = Buffer.from(sign(playbackId, relayId, kind, url));
      const given = Buffer.from(signature);
      if (!relay || relay.playbackId !== playbackId || !current(playbackId) || given.length !== expected.length || !timingSafeEqual(given, expected)) return new Response(null, { status: 404 });
      const range = request.headers.get("range");
      // The same Playback can have a loopback decoder and multiple browser origins.
      // Keep child links on the origin serving this request, not the last prepared Device.
      const destination = { ...relay, target: { ...relay.target, origin: address.origin } };
      let upstream: Response;
      try {
        upstream = await (relay.publicNetwork ? publicRequest : fetch)(url, { headers: { ...relayHeaders(relay, url), ...(range ? { range } : {}) }, signal: request.signal });
        let playlist = kind === "playlist" || playlistType(upstream.headers.get("content-type"), upstream.url || url);
        if (relay.publicNetwork && upstream.ok && !playlist) {
          const sniffed = await sniffPlaylist(upstream);
          upstream = sniffed.response; playlist = sniffed.playlist;
        }
        if (upstream.ok && playlist) {
          const text = new TextDecoder().decode(await boundedBytes(upstream, 2 * 1024 * 1024, request.signal));
          if (relay.publicNetwork && !/^\uFEFF?#EXTM3U\r?\n/.test(text)) throw new Error("Invalid HLS playlist.");
          return new Response(await rewrite(text, upstream.url || url, destination), { headers: { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store" } });
        }
      } catch { return new Response("The media destination could not be read.", { status: 502 }); }
      if (upstream.status >= 400 && upstream.status !== 416) relay.refused = upstream.status;
      const headers = new Headers();
      for (const name of forwarded) { const value = upstream.headers.get(name); if (value) headers.set(name, value); }
      return new Response(upstream.body, { status: upstream.status, headers });
    },
  };
  return api;
}
