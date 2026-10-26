import { publicFetch, stripCrossOriginHeaders } from "./public-network";
import { boundedBytes } from "./iptv-feeds";
import type { AudioSelection } from "../shared/protocol";

export type SelectedChannels = { picture: boolean; sound: boolean };
export type AudioManifest = { url: string; text: string };
type Media = { source: string; audioSource?: string; audioManifest?: AudioManifest; hlsSelection?: { audio: string }; credentialOrigin?: string; publicNetwork?: boolean; headers?: Record<string, string>; hls?: boolean; audioOnly?: boolean; mpegts?: boolean };
export type AudioSelectionContext = { audioSelection?: AudioSelection; audioTrack?: number; audioLanguage?: string };
type AudioInput = { source: string; hls: boolean; audioManifest?: AudioManifest; audioSelection?: NonNullable<AudioSelectionContext["audioSelection"]>; audioStream?: number };
type Playlist = { url: string; lines: string[] };
type ManifestReads = Map<string, Promise<Playlist | null>>;

// Read only the manifest, never its media. Public-provider preparation uses the
// same destination/redirect checks as the byte relay; private URL media retains
// its existing LAN access. No signed URL or fetch result outlives this load.
async function playlist(url: string, headers: Record<string, string>, signal: AbortSignal, publicNetwork = false, reads?: ManifestReads): Promise<Playlist | null> {
  if (reads) {
    const key = JSON.stringify([url, publicNetwork, Object.entries(headers).sort()]);
    let read = reads.get(key);
    if (!read) { read = playlist(url, headers, signal, publicNetwork); reads.set(key, read); }
    return read;
  }
  signal = AbortSignal.any([signal, AbortSignal.timeout(5000)]);
  signal.throwIfAborted();
  const response = await (publicNetwork ? publicFetch : fetch)(url, { headers, signal }).catch(() => {
    signal.throwIfAborted();
    return null;
  });
  if (!response?.ok || !/mpegurl/i.test(response.headers.get("content-type") ?? "") && !/\.m3u8$/i.test(new URL(response.url || url).pathname)) {
    await response?.body?.cancel().catch(() => {});
    return null;
  }
  const text = new TextDecoder().decode(await boundedBytes(response, 2 * 1024 * 1024, signal));
  return { url: response.url || url, lines: text.split(/\r?\n/).map(line => line.trim()) };
}

const attribute = (line: string, name: string) => new RegExp(`(?:[:,])${name}=(?:"([^"]*)"|([^,]*))`).exec(line)?.slice(1).find(value => value !== undefined);
const audioCodec = (codec: string) => /^(?:mp4a(?:\.|$)|ac-3$|ec-3$|opus$|flac$|vorbis$)/i.test(codec.trim());
const reference = (uri: string, base: string) => {
  const url = new URL(uri, base);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error("This playlist contains an unsupported destination.");
  return url.href;
};

// Shared selection for Direct sound-only and the URL audio decoder. Direct keeps
// a muxed master when no audio rendition exists; a decoder may use its smallest
// video variant as before. Resolving/relaying these bytes does not transcode them.
export async function audioInput(url: string, headers: Record<string, string>, signal: AbortSignal, publicNetwork = false, smallestFallback = true, reads?: ManifestReads, selection?: AudioSelectionContext): Promise<AudioInput> {
  const master = await playlist(url, headers, signal, publicNetwork, reads);
  const selectedIndex = selection?.audioSelection?.index ?? selection?.audioTrack;
  const audioStream = Number.isInteger(selectedIndex) && selectedIndex! >= 0 ? selectedIndex : 0;
  if (!master?.lines.some(line => line.startsWith("#EXT-X-STREAM-INF:"))) return { source: url, hls: !!master,
    ...(selection ? { audioStream: master ? 0 : audioStream, audioSelection: selection.audioSelection } : {}) };
  const { lines } = master;
  const variants = lines.flatMap((line, index) => line.startsWith("#EXT-X-STREAM-INF:") && lines[index + 1] && !lines[index + 1]!.startsWith("#") ? [{ info: line, uri: lines[index + 1]! }] : []);
  const audioLines = lines.filter(line => line.startsWith("#EXT-X-MEDIA:") && attribute(line, "TYPE") === "AUDIO");
  const groups = [...new Set(variants.map(variant => attribute(variant.info, "AUDIO")).filter((id): id is string => !!id))];
  const renditions = audioLines.filter(line => (!groups.length || groups.includes(attribute(line, "GROUP-ID") ?? "")) && attribute(line, "URI"));
  // An in-band alternative still needs its video playlist. Dropping it would
  // silently remove a language; retain the usable master in that case.
  if (!smallestFallback && renditions.length && groups.some(group => {
    const choices = audioLines.filter(line => attribute(line, "GROUP-ID") === group);
    return !choices.length || choices.some(line => !attribute(line, "URI"));
  })) return { source: url, hls: true };
  // RFC 8216 §8.6: an audio-only Variant Stream can retain its alternative
  // AUDIO renditions. Keep their order/identity for current track and language
  // preferences instead of replacing all choices with the default language.
  if (!smallestFallback && renditions.length > 1) {
    if (!groups.length || /#EXT-X-(?:DEFINE|CONTENT-STEERING):|\{\$/.test(lines.join("\n"))) return { source: url, hls: true };
    const streams: string[] = [];
    for (const group of groups) {
      const choices = audioLines.filter(line => attribute(line, "GROUP-ID") === group);
      for (const choice of choices) reference(attribute(choice, "URI")!, master.url);
      const variant = variants.find(variant => attribute(variant.info, "AUDIO") === group)!;
      const bandwidth = attribute(variant.info, "BANDWIDTH");
      if (!bandwidth || !/^\d+$/.test(bandwidth)) return { source: url, hls: true };
      const codecs = attribute(variant.info, "CODECS")?.split(",").filter(audioCodec).join(",");
      const main = choices.find(line => attribute(line, "DEFAULT") === "YES") ?? choices[0]!;
      // Preserve the upstream bandwidth bound; deriving a new peak would require
      // fetching media. Only encoded audio appears in the resulting playlist.
      streams.push(`#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth}${codecs ? `,CODECS="${codecs}"` : ""},AUDIO="${group}"`, attribute(main, "URI")!);
    }
    const globals = lines.filter(line => /^#EXT-X-(?:VERSION:|INDEPENDENT-SEGMENTS$|SESSION-KEY:)/.test(line));
    return { source: url, hls: true, audioManifest: { url: master.url, text: ["#EXTM3U", ...globals, ...renditions, ...streams, ""].join("\n") } };
  }
  // hls.js indices are local to the active audio group, not all codec groups.
  // Name/language carry the logical choice when renditions reorder on reload.
  const available = audioLines.filter(line => !groups.length || groups.includes(attribute(line, "GROUP-ID") ?? ""));
  const matchesLanguage = (line: string, wanted = "") => !!wanted && (attribute(line, "LANGUAGE") ?? "").toLowerCase().startsWith(wanted.toLowerCase().slice(0, 2));
  const selected = selection?.audioSelection;
  const identity = selected && (available.find(line => !!selected.label && attribute(line, "NAME") === selected.label && (!selected.language || matchesLanguage(line, selected.language)))
    ?? available.find(line => matchesLanguage(line, selected.language)));
  const preferred = selectedIndex === undefined ? available.find(line => matchesLanguage(line, selection?.audioLanguage)) : undefined;
  const group = attribute(identity ?? preferred ?? "", "GROUP-ID") ?? groups[0];
  const choices = available.filter(line => !group || attribute(line, "GROUP-ID") === group);
  const explicit = identity ?? (selectedIndex !== undefined ? choices[selectedIndex] : undefined);
  const audio = explicit ?? choices.find(line => matchesLanguage(line, selection?.audioLanguage))
    ?? choices.find(line => attribute(line, "DEFAULT") === "YES") ?? choices.find(line => attribute(line, "AUTOSELECT") === "YES") ?? choices[0];
  const usableVariants = variants.filter(variant => !group || attribute(variant.info, "AUDIO") === group);
  const only = usableVariants.find(variant => {
    const codecs = attribute(variant.info, "CODECS")?.split(",");
    return codecs?.length && codecs.every(audioCodec);
  });
  const bandwidth = (info: string) => Number(attribute(info, "BANDWIDTH") ?? Infinity);
  const smallest = smallestFallback ? usableVariants.sort((a, b) => bandwidth(a.info) - bandwidth(b.info))[0]?.uri : undefined;
  const rendition = audio && attribute(audio, "URI");
  const uri = rendition || only?.uri || smallest;
  // A separate rendition has its own first stream; never apply its master index
  // to that one-stream input. In-band audio maps within the selected variant.
  const inBand = choices.filter(line => !attribute(line, "URI"));
  return { source: uri ? reference(uri, master.url) : url, hls: true,
    ...(selection ? { audioStream: rendition ? 0 : audio ? Math.max(0, inBand.indexOf(audio)) : audioStream,
      audioSelection: audio ? { index: choices.indexOf(audio), label: attribute(audio, "NAME") ?? "Audio", language: attribute(audio, "LANGUAGE") ?? "" } : selected } : {}) };
}

export async function audioRendition(url: string, headers: Record<string, string>, signal: AbortSignal) {
  return (await audioInput(url, headers, signal)).source;
}

type ClassificationContext = Pick<Media, "headers" | "publicNetwork" | "credentialOrigin" | "audioManifest">;
export async function liveHls(url: string, signal: AbortSignal, reads?: ManifestReads, context: ClassificationContext = {}) {
  signal.throwIfAborted();
  const read = (source: string) => {
    const headers = new Headers(context.headers);
    if (new URL(source).origin !== new URL(context.credentialOrigin ?? url).origin) stripCrossOriginHeaders(headers);
    return playlist(source, Object.fromEntries(headers), signal, context.publicNetwork, reads);
  };
  // Keep the original master in the read cache for later selection in this
  // load, but classify the selected audio stream without fetching any video.
  let media = context.audioManifest ? { url: context.audioManifest.url, lines: context.audioManifest.text.split(/\r?\n/).map(line => line.trim()) } : await read(url);
  const variant = media?.lines.find((_line, index) => index > 0 && media!.lines[index - 1]!.startsWith("#EXT-X-STREAM-INF:"));
  if (variant) media = await read(reference(variant, media!.url));
  return !!media?.lines.some(line => line.startsWith("#EXTINF:")) && !media.lines.some(line => line.startsWith("#EXT-X-ENDLIST"));
}

export async function prepareSource<T extends Media>(media: T, output: SelectedChannels, signal: AbortSignal, reads?: ManifestReads): Promise<T & Media> {
  signal.throwIfAborted();
  if (output.picture || !output.sound) return output.sound ? media : { ...media, audioSource: undefined };
  // YouTube's checked original-audio rendition, not the master's first (possibly dubbed) one.
  const separate = media.audioSource ?? media.hlsSelection?.audio;
  if (separate) return { ...media, credentialOrigin: media.credentialOrigin ?? media.source, source: separate, audioSource: undefined, hlsSelection: undefined, mpegts: undefined, hls: /\.m3u8(?:[?#]|$)/i.test(separate) || undefined };
  if (!/^https?:/.test(media.source)) return media;
  const audio = await audioInput(media.source, media.headers ?? {}, signal, media.publicNetwork, false, reads);
  signal.throwIfAborted();
  return { ...media, credentialOrigin: media.credentialOrigin ?? media.source, ...audio };
}

// Selection precedes live classification, even when the HLS URL has no suffix.
// Reuse those bounded reads only while preparing this load, never across loads.
export function createSourcePreparation(signal: AbortSignal) {
  const reads: ManifestReads = new Map();
  return {
    select: <T extends Media>(media: T, output: SelectedChannels) => prepareSource(media, output, signal, reads),
    live: (url: string, context?: ClassificationContext) => liveHls(url, signal, reads, context),
  };
}
