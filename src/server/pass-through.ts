import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { publicFetch, publicResponseContext, stripCrossOriginHeaders } from "./public-network";
import { boundedBytes } from "./iptv-feeds";
import { serve, type Listener } from "./http";
import { logMediaDiagnostic, mediaAddress, mediaHeaders } from "./media-diagnostics";
import type { WebMediaSource } from "./web-media";
import type { AudioManifest } from "./source-preparation";

// Pass-through (#644 Delivery): a Device that can't fetch a source itself because of its
// Origin, CORS or headers gets the bytes through Core. Every source is probed for the
// destination's access; a web provider's playlists always go through Core, and its files
// and segments go direct only over HTTPS on the public internet. `relay` sends everything
// through Core: Core's own decoder, or a Device that failed on a direct address.
// Playlists are rewritten, other bytes stream through with their Range. Nothing is transcoded.
type Target = { origin: string; userAgent: string; relay?: boolean };
type Media = {
  source: string;
  audioSource?: string;
  audioManifest?: AudioManifest;
  credentialOrigin?: string;
  hls?: boolean;
  hlsSelection?: WebMediaSource["hlsSelection"];
  hlsMaxHeight?: number;
  mpegts?: boolean;
  mpv?: boolean;
  publicNetwork?: boolean;
  renewal?: WebMediaSource["renewal"];
};
// refused: the last error status the source answered, which a browser reports as an unsupported format.
type Relay = {
  id: string;
  playbackId: string;
  credentialOrigin: string;
  target: Target;
  headers: Record<string, string>;
  publicNetwork?: boolean;
  audioCors?: boolean;
  audioManifest?: AudioManifest;
  createdAt: number;
  // Shared by every request on this route: one probe of the first segment decides them all.
  // origin: the probed segment's, the only one a web provider's segments may be read from directly.
  segments: { direct?: Promise<boolean>; origin?: string; answered?: boolean };
  refused?: number;
  source: string;
  audioSource?: string;
  hlsSelection?: Media["hlsSelection"];
  hlsMaxHeight?: number;
  renewal?: Media["renewal"];
  logged: Set<string>;
};
type Kind = "playlist" | "bytes";
// One upstream read of a playlist, shared by every route of its Playback: Core's sound decoder and
// every screen get the same text, so one provider session serves them all (Twitch: the same ads).
// text: the playlist, when the source answered one.
type Read = {
  playbackId: string;
  at: number;
  maxAge: number;
  answer: Promise<{ status: number; url: string; response: Response; text?: string }>;
};

// A master, or a media playlist that won't change (VOD, ENDLIST), is read once for the item. An
// endless one at most every half target duration: a client that reloads and sees no change asks
// again after half the target duration (RFC 8216 §6.3.4), so a screen waits no longer for news.
const playlistAge = (text: string) => {
  if (/^#EXT-X-(?:STREAM-INF:|MEDIA:|ENDLIST|PLAYLIST-TYPE:VOD)/m.test(text)) return Infinity;
  const target = Number(/^#EXT-X-TARGETDURATION:(\d+(?:\.\d+)?)/m.exec(text)?.[1]);
  return target > 0 ? target * 500 : 0;
};
// A refused address may be a link that expired, so Core resolves the item again once.
const refusal = (status: number) => [401, 403, 404, 410].includes(status);
// The expiry a link names, in ms: googlevideo's expire= (or /expire/<s>/ in its playlists'
// paths), or "expires" in a token parameter (Twitch's usher).
const linkExpiry = (url: string) => {
  const address = URL.parse(url);
  if (!address) return undefined;
  const named = [
    address.searchParams.get("expire"),
    address.searchParams.get("expires"),
    /\/expire\/(\d+)(?:\/|$)/.exec(address.pathname)?.[1],
    ...[...address.searchParams.values()].map((value) => /"expires"\s*:\s*(\d+)/.exec(value)?.[1]),
  ].find((value) => !!value && /^\d{9,11}$/.test(value));
  return named ? Number(named) * 1000 : undefined;
};
// Core renews this long before a link's expiry: a yt-dlp run takes seconds, and a hung one gives
// up after 30 s (the resolution's own timeout), so a second try still fits before the link fails.
const renewAhead = 60_000;
// The masters' variants and renditions, each with what identifies it across two resolutions of
// one item: its tag without its address and bandwidth, which a provider may re-measure.
const variantsOf = (text: string, base: string) => {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  return lines.flatMap((line, index) => {
    const tag = /^#EXT-X-(STREAM-INF|MEDIA|I-FRAME-STREAM-INF):/.exec(line)?.[1];
    const uri =
      tag === "STREAM-INF"
        ? lines[index + 1] && !lines[index + 1]!.startsWith("#")
          ? lines[index + 1]
          : undefined
        : /[:,]URI="([^"]+)"/.exec(line)?.[1];
    const url = uri && URL.parse(uri, base)?.href;
    return tag && url
      ? [
          {
            tag,
            key: line.replace(/([:,])(?:URI|BANDWIDTH|AVERAGE-BANDWIDTH)=("[^"]*"|[^,]*)/g, "$1"),
            url,
          },
        ]
      : [];
  });
};

const playlistType = (type: string | null, url: string) =>
  /mpegurl/i.test(type ?? "") || /\.m3u8$/i.test(new URL(url).pathname);
// Tags whose URI is another playlist; every other URI is a segment, key or map.
const playlistTag = /^#EXT-X-(?:MEDIA|I-FRAME-STREAM-INF|RENDITION-REPORT):/;
const forwarded = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "cache-control",
  "last-modified",
  "etag",
];
// Native HLS decoders check segment extensions before reading bytes. Preserve a
// media suffix outside the encoded upstream query (which may end in a token).
const mediaExtension = (url: string) => {
  try {
    return (
      /\.(aac|ac3|eac3|flac|m4a|m4s|m4v|mp3|mp4|mpeg|mpg|mts|m2ts|ts|ogg|opus|oga|ogv|wav|webm|vtt|srt|key|m3u8)$/i
        .exec(new URL(url).pathname)?.[1]
        ?.toLowerCase() ?? "ts"
    );
  } catch {
    return "ts";
  } // Malformed unsigned requests still fail capability validation.
};

// Variants taller than the chosen quality leave the master; those without a RESOLUTION
// (audio only) stay, and a master with nothing at or below it stays whole.
const capVariants = (lines: string[], maxHeight: number) => {
  const height = (line: string) => Number(/RESOLUTION=\d+x(\d+)/.exec(line)?.[1] ?? 0);
  const variants = lines.filter((line) => line.startsWith("#EXT-X-STREAM-INF:"));
  if (!variants.some((line) => height(line) && height(line) <= maxHeight)) return lines;
  let dropping = false;
  return lines.filter((line) => {
    if (line.startsWith("#EXT-X-STREAM-INF:")) dropping = height(line) > maxHeight;
    else if (dropping && line.trim() && !line.startsWith("#")) {
      dropping = false;
      return false;
    }
    return !dropping;
  });
};

// A server can mislabel an extensionless playlist. Inspect a small prefix before
// giving bytes to a decoder, which otherwise may follow the original HLS URIs.
async function sniffPlaylist(
  response: Response,
): Promise<{ response: Response; playlist: boolean }> {
  if (!response.body) return { response, playlist: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0,
    ended = false;
  while (size < 32) {
    const next = await reader.read();
    if (next.done) {
      ended = true;
      break;
    }
    chunks.push(next.value);
    size += next.value.length;
  }
  const prefix = Buffer.concat(chunks);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      if (prefix.length) controller.enqueue(prefix);
      if (ended) controller.close();
    },
    async pull(controller) {
      const next = await reader.read();
      if (next.done) controller.close();
      else controller.enqueue(next.value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
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
async function probe(
  url: string,
  relay: Relay,
  cors: boolean,
  signal: AbortSignal,
  publicRequest: typeof fetch,
) {
  if (relay.publicNetwork) return probePublic(url, relay, cors, signal, publicRequest);
  const ask = (headers: Record<string, string>) =>
    fetch(url, { headers, signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) }).then(
      async (response) => {
        await response.body?.cancel().catch(() => {});
        return response;
      },
      () => null,
    );
  const mixed = relay.target.origin.startsWith("https:") && url.startsWith("http:");
  const response = await ask(
    mixed
      ? relayHeaders(relay, url)
      : { origin: relay.target.origin, "user-agent": relay.target.userAgent },
  );
  const playlist = playlistType(response?.headers.get("content-type") ?? null, url);
  if (!response) return { direct: !relay.audioCors, playlist };
  if (mixed) return { direct: !relay.audioCors && !response.ok, playlist };
  if (!response.ok)
    return { direct: !relay.audioCors && !(await ask(relayHeaders(relay, url)))?.ok, playlist };
  const sameOrigin =
    new URL(url).origin === relay.target.origin &&
    (!response.url || new URL(response.url).origin === relay.target.origin);
  const shared = ["*", relay.target.origin].includes(
    response.headers.get("access-control-allow-origin") ?? "",
  );
  return { direct: sameOrigin || shared || !(cors || playlist), playlist };
}

// A web provider's file is direct only over HTTPS, when Core's pinned request, asking as the
// Device would, reached a public address that answered and allows the Device to read it.
// Its playlists never are: Core reads each one and checks every address in it. A provider
// that needs Core's headers or cookies refuses this request, so it stays relayed.
async function probePublic(
  url: string,
  relay: Relay,
  cors: boolean,
  signal: AbortSignal,
  publicRequest: typeof fetch,
) {
  const named = playlistType(null, url);
  // Core follows each redirect itself: publicFetch upgrades a googlevideo hop to http://, which
  // the Device would follow as it is and then block as mixed content. Every hop must be HTTPS.
  const timeout = AbortSignal.any([signal, AbortSignal.timeout(5000)]);
  let address: string | undefined = url,
    response: Response | null = null;
  for (let hops = 0; address?.startsWith("https:") && hops <= 20; hops++) {
    response = await publicRequest(address, {
      headers: { origin: relay.target.origin, "user-agent": relay.target.userAgent },
      signal: timeout,
      redirect: "manual",
    }).catch(() => null);
    const location: string | null | undefined = response?.headers.get("location");
    if (!response || ![301, 302, 303, 307, 308].includes(response.status) || !location) break;
    await response.body?.cancel().catch(() => {});
    address = URL.parse(location, address)?.href;
    response = null;
  }
  if (!response?.ok || !address) {
    await response?.body?.cancel().catch(() => {});
    return { direct: false, playlist: named };
  }
  // A mislabelled playlist is found by its first bytes, as the relay does.
  const sniffed = await sniffPlaylist(response).catch(() => null);
  await sniffed?.response.body?.cancel().catch(() => {});
  const playlist =
    !!sniffed?.playlist || playlistType(response.headers.get("content-type"), address);
  const shared = ["*", relay.target.origin].includes(
    response.headers.get("access-control-allow-origin") ?? "",
  );
  return {
    direct: !!sniffed && !playlist && (shared || !cors),
    playlist,
  };
}

// Relay addresses are signed for one Playback, so Core relays only what it resolved for the
// current Playback and the playlists it relayed; it is never an open proxy. Only Devices
// that were sent a load command learn them, like subtitle paths.
// `current` says whether a transport still plays, in whichever Playback (#644 ticket 9).
export function createPassThrough(
  current: (playbackId: string) => boolean,
  publicRequest: typeof fetch = publicFetch,
) {
  const key = randomBytes(32);
  const relays = new Map<string, Relay>();
  let internal: Promise<Listener> | undefined;
  let closed = false;
  const sign = (playbackId: string, relayId: string, kind: string, url: string) =>
    `${relayId}-${createHmac("sha256", key).update(`${playbackId}\n${relayId}\n${kind}\n${url}`).digest("base64url")}.${kind === "playlist" ? "m3u8" : mediaExtension(url)}`;
  const link = (relay: Relay, kind: Kind, url: string) =>
    `${relay.target.origin}/api/relay/${relay.playbackId}/${kind}/${sign(relay.playbackId, relay.id, kind, url)}?${new URLSearchParams({ url })}`;
  const relayOf = (playbackId: string, source: string) => {
    const relayId = URL.parse(source)?.pathname.split("/")[5]?.split("-", 1)[0];
    const relay = relayId ? relays.get(relayId) : undefined;
    return relay?.playbackId === playbackId ? relay : undefined;
  };
  const reads = new Map<string, Read>();
  // Upstream addresses a renewal replaced, per Playback: every link Core gave keeps working.
  const renewed = new Map<string, Map<string, string>>();
  const renewedAddress = (playbackId: string, url: string) => {
    const aliases = renewed.get(playbackId);
    for (let hops = 0; aliases?.has(url) && hops < 64; hops++) url = aliases.get(url)!;
    return url;
  };
  const forget = () => {
    for (const [key, read] of reads)
      if (
        (!current(read.playbackId) && Date.now() - read.at > 60_000) ||
        Date.now() - read.at > read.maxAge + 60_000
      )
        reads.delete(key);
    for (const playbackId of renewed.keys()) if (!current(playbackId)) renewed.delete(playbackId);
  };
  // hls.js gives up on a playlist that hasn't answered in 10 s (its playlistLoadPolicy), so one
  // slow read never holds every screen's reload longer than that.
  const shared = (
    playbackId: string,
    url: string,
    publicNetwork: boolean | undefined,
    headers: Record<string, string>,
    expiring?: () => void,
  ) => {
    const key = `${playbackId}\n${url}`;
    const saved = reads.get(key);
    if (saved && Date.now() - saved.at < saved.maxAge) return saved.answer;
    forget();
    const read: Read = {
      playbackId,
      at: Date.now(),
      maxAge: Infinity, // Until it answers, every request waits for this one read.
      answer: (async () => {
        const expiry = linkExpiry(url);
        if (expiry !== undefined && expiry - Date.now() < renewAhead) expiring?.();
        const signal = AbortSignal.timeout(10_000);
        const response = await (publicNetwork ? publicRequest : fetch)(url, { headers, signal });
        const answer = { status: response.status, url: response.url || url, response };
        if (!response.ok) {
          await response.body?.cancel().catch(() => {});
          return answer;
        }
        const sniffed = await sniffPlaylist(response);
        if (!sniffed.playlist && !playlistType(response.headers.get("content-type"), answer.url)) {
          await sniffed.response.body?.cancel().catch(() => {});
          return answer;
        }
        const text = new TextDecoder().decode(
          await boundedBytes(sniffed.response, 2 * 1024 * 1024, signal),
        );
        return { ...answer, text };
      })(),
    };
    reads.set(key, read);
    read.answer.then(
      (answer) => {
        read.at = Date.now();
        read.maxAge = answer.text === undefined ? 0 : playlistAge(answer.text);
      },
      () => {
        if (reads.get(key) === read) reads.delete(key);
      },
    );
    return read.answer;
  };
  // Core resolves the item again, once at a time for every route of its resolution, and maps each
  // old address (the master, its variants and renditions, a file) onto the new one.
  const renew = (relay: Relay): Promise<boolean> => {
    const renewal = relay.renewal;
    if (!renewal || renewal.spent) return Promise.resolve(false);
    renewal.pending ??= (async () => {
      const previous = renewal.current;
      const fresh = await renewal.renew(AbortSignal.timeout(30_000));
      const aliases = renewed.get(relay.playbackId) ?? new Map<string, string>();
      const pairs: Array<[string | undefined, string | undefined]> = [
        [previous.source, fresh.source],
        [previous.audioSource, fresh.audioSource],
        [previous.hlsSelection?.video, fresh.hlsSelection?.video],
        [previous.hlsSelection?.audio, fresh.hlsSelection?.audio],
      ];
      const before = await reads
        .get(`${relay.playbackId}\n${previous.source}`)
        ?.answer.catch(() => undefined);
      const after = before?.text
        ? await shared(
            relay.playbackId,
            fresh.source,
            relay.publicNetwork,
            relayHeaders(relay, fresh.source),
          ).catch(() => undefined)
        : undefined;
      if (before?.text && after?.text) {
        const old = variantsOf(before.text, before.url),
          next = variantsOf(after.text, after.url);
        for (const variant of old) {
          const same = next.filter((item) => item.tag === variant.tag);
          const position = old.filter((item) => item.tag === variant.tag).indexOf(variant);
          pairs.push([
            variant.url,
            (same.find((item) => item.key === variant.key) ?? same[position])?.url,
          ]);
        }
      }
      for (const [from, to] of pairs) if (from && to && from !== to) aliases.set(from, to);
      renewed.set(relay.playbackId, aliases);
      renewal.current = {
        source: fresh.source,
        audioSource: fresh.audioSource,
        hlsSelection: fresh.hlsSelection,
      };
      // A link that would expire again at once is not worth another resolution.
      if ((linkExpiry(fresh.source) ?? Infinity) - Date.now() < renewAhead) renewal.spent = true;
      return true;
    })()
      .catch(() => {
        renewal.spent = true;
        return false;
      })
      .finally(() => (renewal.pending = undefined));
    return renewal.pending;
  };
  // A playlist through the shared read; a refusal renews the link once and reads again.
  const playlistOf = async (relay: Relay, url: string) => {
    const read = () => {
      const address = renewedAddress(relay.playbackId, url);
      return shared(
        relay.playbackId,
        address,
        relay.publicNetwork,
        relayHeaders(relay, address),
        () => void renew(relay),
      );
    };
    let answer = await read();
    if (refusal(answer.status) && (await renew(relay))) {
      answer = await read();
      if (refusal(answer.status) && relay.renewal) relay.renewal.spent = true;
    }
    return answer;
  };

  async function rewrite(text: string, base: string, relay: Relay) {
    let lines = text.split(/\r?\n/);
    const master = lines.some((line) => /^#EXT-X-(?:STREAM-INF|MEDIA):/.test(line));
    if (master && relay.hlsMaxHeight) lines = capVariants(lines, relay.hlsMaxHeight);
    // Public providers never hand a player an unchecked URI, including keys, maps,
    // low-latency parts and renditions. Variable substitution and content steering
    // can introduce destinations after rewriting, so fail closed on those features.
    if (
      relay.publicNetwork &&
      (/#EXT-X-(?:DEFINE|CONTENT-STEERING):/.test(text) || text.includes("{$"))
    )
      throw new Error("This playlist uses unsupported external destinations.");
    const absolute = (uri: string) => {
      try {
        const url = new URL(uri, base);
        if (/^https?:$/.test(url.protocol) && !url.username && !url.password) return url.href;
      } catch {
        /* Reject malformed public media references. */
      }
      if (relay.publicNetwork)
        throw new Error("This playlist contains an unsupported destination.");
      return null;
    };
    const first = master ? null : lines.find((line) => line.trim() && !line.startsWith("#"));
    const relayed = relay.audioCors || relay.target.relay;
    // Segments stay direct when the Device may read them (Twitch's allow every Origin).
    if (!relayed && first && absolute(first.trim()) && !relay.segments.direct) {
      const url = absolute(first.trim())!;
      relay.segments.origin = new URL(url).origin;
      relay.segments.direct = probe(
        url,
        relay,
        true,
        AbortSignal.timeout(5000),
        publicRequest,
      ).then((answer) => (relay.segments.answered = answer.direct));
    }
    const segments = relayed ? false : ((await relay.segments.direct) ?? !relay.publicNetwork);
    // A web provider's segments elsewhere than the probed origin stay relayed.
    const direct = (url: string) =>
      segments && (!relay.publicNetwork || new URL(url).origin === relay.segments.origin);
    const to = (uri: string, playlist: boolean) => {
      const url = absolute(uri);
      return !url
        ? uri
        : playlist
          ? link(relay, "playlist", url)
          : direct(url)
            ? url
            : link(relay, "bytes", url);
    };
    return lines
      .map((raw) => {
        const line = raw.trim();
        if (!line.startsWith("#")) return line ? to(line, master) : line;
        if (
          relay.publicNetwork &&
          /[:,]\s*[\w-]*URI\s*=/.test(line.replace(/([:,]URI=)"[^"]+"/g, ""))
        )
          throw new Error("This playlist contains an unsupported destination attribute.");
        return line.replace(
          /([:,]URI=)"([^"]+)"/g,
          (_, name: string, uri: string) => `${name}"${to(uri, playlistTag.test(line))}"`,
        );
      })
      .join("\n");
  }

  const api = {
    // Native decoders always reach a literal loopback address, independently of
    // the UI listener's COUCH_HOST/TLS configuration. This listener serves only
    // the same signed, active playback capabilities as the public relay route.
    async coreOrigin(): Promise<string> {
      if (closed) throw new Error("The media relay is closed.");
      internal ??= serve({
        hostname: "127.0.0.1",
        port: 0,
        maxRequestBodySize: 0,
        fetch: (request) =>
          request.method === "GET" && new URL(request.url).pathname.startsWith("/api/relay/")
            ? api.serve(request)
            : Promise.resolve(new Response(null, { status: 404 })),
        websocket: { maxPayload: 0, open() {}, message() {}, close() {} },
      });
      const listener = await internal;
      if (closed) throw new Error("The media relay is closed.");
      return `http://127.0.0.1:${listener.port}`;
    },
    async close() {
      closed = true;
      relays.clear();
      await (await internal)?.stop();
    },
    // Core's own playlist reads while it prepares a Playback (the master its sound is chosen from)
    // share the relay's reads, so Core and the screens start from one provider session.
    reader:
      (playbackId: string) =>
      (url: string, headers: Record<string, string>, publicNetwork: boolean) =>
        shared(playbackId, renewedAddress(playbackId, url), publicNetwork, headers).then(
          ({ status, url: answered, text, response: { ok } }) => {
            // An answer that isn't a playlist reads as one Core can't use (415).
            const response =
              text === undefined
                ? new Response(null, { status: ok ? 415 : status })
                : new Response(text, {
                    status,
                    headers: { "content-type": "application/vnd.apple.mpegurl" },
                  });
            Object.defineProperty(response, "url", { value: answered });
            return response;
          },
        ),
    // The reporting window names its loaded capability, not another Core or screen relay.
    refused(playbackId: string, source: string) {
      const relay = relayOf(playbackId, source);
      return relay?.playbackId === playbackId ? relay.refused : undefined;
    },
    // Whether a Device's load reads anything straight from its source: a source or audio
    // address of its own, or a relayed playlist whose segments it reads directly.
    direct(playbackId: string, sources: Array<string | undefined>) {
      return sources.some((source) => {
        const address = source ? URL.parse(source) : null;
        if (!address || !/^https?:$/.test(address.protocol)) return false;
        if (!address.pathname.startsWith("/api/relay/")) return true;
        return !!relayOf(playbackId, source!)?.segments.answered;
      });
    },
    // Chooses Direct or Pass-through for each stream this Device will fetch, and says whether the source is HLS.
    async prepare<T extends Media>(
      playbackId: string,
      media: T,
      headers: Record<string, string>,
      target: Target | null,
      signal: AbortSignal,
      audioCors = false,
    ): Promise<T> {
      signal.throwIfAborted();
      if (closed) throw new Error("The media relay is closed.");
      if (media.audioManifest && !target)
        target = { origin: await api.coreOrigin(), userAgent: "Couch", relay: true };
      if (!target || (media.mpv && !media.publicNetwork && !media.audioManifest)) {
        if (media.publicNetwork)
          throw new Error("Public media requires a protected playback route.");
        return media;
      }
      // Core and Devices can prepare the same Playback with different upstream
      // headers. One capability per preparation keeps every child on its route.
      // The single source-header map authorizes only the main source's origin;
      // a separate audio URL or redirected playlist cannot expand that trust.
      const relay: Relay = {
        id: randomBytes(16).toString("hex"),
        playbackId,
        credentialOrigin: new URL(media.credentialOrigin ?? media.source).origin,
        // A native player (mpv) would fetch outside Core's pinned request, so it reads only the relay.
        target: media.mpv && media.publicNetwork ? { ...target, relay: true } : target,
        headers,
        publicNetwork: media.publicNetwork,
        audioCors,
        audioManifest: media.audioManifest,
        createdAt: Date.now(),
        segments: {},
        source: media.source,
        audioSource: media.audioSource,
        hlsSelection: media.hlsSelection,
        hlsMaxHeight: media.hlsMaxHeight,
        renewal: media.renewal,
        logged: new Set(),
      };
      const route = async (resolved: string) => {
        // A renewed item's late preparation reads its current address.
        const url = renewedAddress(playbackId, resolved);
        // A web provider's playlist always goes through Core, and its extractor already knows
        // the transport; nothing at all is probed for a target the relay must serve.
        const named =
          (resolved === media.source && !!(media.hls || media.hlsSelection)) ||
          playlistType(null, url);
        const answer =
          relay.publicNetwork && (named || relay.target.relay)
            ? { direct: false, playlist: named }
            : await probe(url, relay, !!media.mpegts || audioCors, signal, publicRequest);
        // Web Audio needs readable audio, including every HLS child; a native media element alone does not.
        return {
          url:
            answer.direct && !relay.target.relay && !(audioCors && answer.playlist)
              ? url
              : link(relay, answer.playlist ? "playlist" : "bytes", resolved),
          playlist: answer.playlist,
        };
      };
      const [main, audio] = await Promise.all([
        media.audioManifest
          ? { url: link(relay, "playlist", media.source), playlist: true }
          : route(media.source),
        media.audioSource ? route(media.audioSource) : undefined,
      ]);
      signal.throwIfAborted();
      if (closed) throw new Error("The media relay is closed.");
      const source = main.url,
        audioSource = audio?.url;
      // Quality changes prepare a new transport before it becomes current.
      for (const [id, saved] of relays)
        if (!current(saved.playbackId) && Date.now() - saved.createdAt > 60_000) relays.delete(id);
      if (source !== media.source || audioSource !== media.audioSource) relays.set(relay.id, relay);
      return {
        ...media,
        audioManifest: undefined,
        publicNetwork: undefined,
        renewal: undefined,
        hlsSelection: undefined,
        hlsMaxHeight: undefined,
        source,
        ...(audioSource ? { audioSource } : {}),
        ...(main.playlist ? { hls: true } : {}),
      };
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
      if (
        !relay ||
        relay.playbackId !== playbackId ||
        !current(playbackId) ||
        given.length !== expected.length ||
        !timingSafeEqual(given, expected)
      )
        return new Response(null, { status: 404 });
      const range = request.headers.get("range");
      // The same Playback can have a loopback decoder and multiple browser origins.
      // Keep child links on the origin serving this request, not the last prepared Device.
      const destination = { ...relay, target: { ...relay.target, origin: address.origin } };
      if (kind === "playlist" && url === relay.source && relay.audioManifest) {
        try {
          return new Response(
            await rewrite(relay.audioManifest.text, relay.audioManifest.url, destination),
            {
              headers: {
                "Content-Type": "application/vnd.apple.mpegurl",
                "Cache-Control": "no-store",
              },
            },
          );
        } catch {
          return new Response("The media destination could not be read.", { status: 502 });
        }
      }
      const sentHeaders = { ...relayHeaders(relay, url), ...(range ? { range } : {}) };
      const diagnostic = (status: number, response?: Response, failure = false) => {
        const stream =
          url === relay.source ? "main" : url === relay.audioSource ? "audio" : "child";
        const entry = `${stream}:${status}:${failure}`;
        // First answer and distinct failures, bounded per route; never log every range or HLS segment.
        if (
          (stream === "child" && status < 400) ||
          relay.logged.has(entry) ||
          relay.logged.size >= 12
        )
          return;
        relay.logged.add(entry);
        const context = response && publicResponseContext(response);
        const sentRange = (context?.headers ?? sentHeaders).range ?? null;
        logMediaDiagnostic("response", playbackId, {
          route: relay.id.slice(0, 8),
          fetcher: "Core",
          consumer: relay.target.userAgent === "Couch" ? "Core" : "Device",
          stream,
          status,
          outcome: failure ? "transport-or-playlist-error" : "upstream",
          routeAgeSeconds: Math.round((Date.now() - relay.createdAt) / 1000),
          ...mediaAddress(url),
          responseHost: mediaAddress(response?.url || url).host,
          connectionIpFamily: context?.ipFamily ?? null,
          range:
            sentRange === null
              ? null
              : /^bytes=\d{0,16}-\d{0,16}$/.test(sentRange)
                ? sentRange
                : "other",
          headers: mediaHeaders(context?.headers ?? sentHeaders),
        });
      };
      // The last answer stands: a refusal is forgotten once the source answers again.
      const answered = (status: number) =>
        (relay.refused = status >= 400 && status <= 599 && status !== 416 ? status : undefined);
      const playlistResponse = async (text: string, base: string) => {
        // YouTube refreshes child signatures on each master request. Build one
        // standard HLS variant from the exact pair yt-dlp checked, retaining
        // its quality and language without comparing fresh signed URLs.
        const selection = url === relay.source ? relay.hlsSelection : undefined;
        if (selection)
          text = `#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Audio",DEFAULT=YES,AUTOSELECT=YES,URI="${selection.audio}"\n#EXT-X-STREAM-INF:BANDWIDTH=${selection.bandwidth},AUDIO="audio"\n${selection.video}\n`;
        if (relay.publicNetwork && !/^\uFEFF?#EXTM3U\r?\n/.test(text))
          throw new Error("Invalid HLS playlist.");
        return new Response(await rewrite(text, base, destination), {
          headers: {
            "Content-Type": "application/vnd.apple.mpegurl",
            "Cache-Control": "no-store",
          },
        });
      };
      let upstream: Response;
      try {
        if (kind === "playlist") {
          const answer = await playlistOf(relay, url);
          diagnostic(answer.status, answer.response);
          answered(answer.status);
          if (!answer.response.ok) return new Response(null, { status: answer.status });
          if (answer.text === undefined) throw new Error("Invalid HLS playlist.");
          return await playlistResponse(answer.text, answer.url);
        }
        // A file of the item itself (not a segment) renews like a playlist when it is refused.
        const file = url === relay.source || url === relay.audioSource;
        const read = () => {
          const address = file ? renewedAddress(playbackId, url) : url;
          const expiry = file ? linkExpiry(address) : undefined;
          if (expiry !== undefined && expiry - Date.now() < renewAhead) void renew(relay);
          return (relay.publicNetwork ? publicRequest : fetch)(address, {
            headers: { ...relayHeaders(relay, address), ...(range ? { range } : {}) },
            signal: request.signal,
          });
        };
        upstream = await read();
        if (file && refusal(upstream.status) && (await renew(relay))) {
          await upstream.body?.cancel().catch(() => {});
          upstream = await read();
        }
        diagnostic(upstream.status, upstream);
        answered(upstream.status);
        let playlist = playlistType(upstream.headers.get("content-type"), upstream.url || url);
        if (relay.publicNetwork && upstream.ok && !playlist) {
          const sniffed = await sniffPlaylist(upstream);
          upstream = sniffed.response;
          playlist = sniffed.playlist;
        }
        if (upstream.ok && playlist)
          return await playlistResponse(
            new TextDecoder().decode(await boundedBytes(upstream, 2 * 1024 * 1024, request.signal)),
            upstream.url || url,
          );
      } catch {
        if (!request.signal.aborted) diagnostic(502, undefined, true);
        return new Response("The media destination could not be read.", { status: 502 });
      }
      const headers = new Headers();
      for (const name of forwarded) {
        const value = upstream.headers.get(name);
        if (value) headers.set(name, value);
      }
      return new Response(upstream.body, { status: upstream.status, headers });
    },
  };
  return api;
}
