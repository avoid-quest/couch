import type { ForLaterItem } from "../shared/for-later";
import { providerForUrl } from "../shared/providers";

export function savedSourceLabel(item: ForLaterItem) {
  if (item.kind === "radio") return "Radio";
  if (!item.url) return "";
  try {
    const provider = providerForUrl(item.url);
    return provider ? { youtube: "YouTube", twitch: "Twitch", raiplay: "RaiPlay", bandcamp: "Bandcamp", soundcloud: "SoundCloud", streamingcommunity: "StreamingCommunity", movies123: "123MoviesFree", animesaturn: "AnimeSaturn", animeunity: "AnimeUnity" }[provider] : new URL(item.url).hostname.replace(/^www\./, "");
  } catch { return ""; }
}

