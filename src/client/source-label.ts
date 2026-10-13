import { providerForUrl } from "../shared/providers";
import { providerNames } from "@/sections/find/SearchOnlineResults";

/** Where an item comes from, as people know it: the provider's name ("Twitch"), Live TV or Radio, never a hostname. */
export function sourceLabel(source: string) {
  try {
    const url = new URL(source.replace(/^web:/, ""));
    if (url.protocol === "iptv:") return "Live TV";
    if (url.protocol === "radio:") return "Radio";
    if (url.protocol === "live:") return "Shared source";
    const provider = providerForUrl(url.href);
    return provider ? providerNames[provider] : url.hostname.replace(/^www\./, "") || "Media";
  } catch { return "Media"; }
}
