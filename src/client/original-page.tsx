import type { MenuAction } from "@/components/RowMenu";
import type { QueueEntry } from "../shared/protocol";
import { providerForUrl } from "../shared/providers";
import { animeUnitySiteOrigin } from "../shared/animeunity";

/** Only the entry's webpage reference is a page; source otherwise holds a file, stream or input. */
export const queuePageUrl = (entry: QueueEntry) => !entry.liveSourceId && entry.source.startsWith("web:") ? entry.source.slice(4) : undefined;

/** Turn catalogue-only selectors into the containing public page, never a resolved stream. */
export function originalPageUrl(value?: string | null): string | undefined {
  if (!value || value.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(value)) return;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return;
    if (/\.(?:m3u8?|mpd|mp4|mkv|webm|mov|avi|ts|mp3|m4a|aac|ogg|opus|flac|wav)$/i.test(url.pathname)) return;
    switch (providerForUrl(value)) {
      case "animeunity":
        if (url.hostname === "animeunity.so" || url.hostname === "www.animeunity.so") return `${animeUnitySiteOrigin}${url.pathname}${url.search}${url.hash}`;
        break;
      case "raiplay":
        url.pathname = url.pathname.replace(/\/ContentSet-[a-f0-9-]+\.json$/i, "");
        url.pathname = url.pathname.replace(/\.json$/, url.pathname.startsWith("/video/") ? ".html" : "");
        if (url.search === "?json") url.search = "";
        if (url.hash.startsWith("#block=")) url.hash = "";
        break;
      case "streamingcommunity": url.pathname = url.pathname.replace(/\/season-\d+\/?$/, ""); break;
      case "movies123": url.searchParams.delete("episode"); break;
    }
    return url.href;
  } catch { return; }
}

/** Native anchors keep modified clicks and use Main's existing HTTP(S) window-open handler in the app. */
export function browserActions(pageUrl?: string | null): MenuAction[] {
  const url = originalPageUrl(pageUrl);
  return url ? [{ label: "Open in browser", node: <a href={url} target="_blank" rel="noopener noreferrer" data-tv-local-only>Open in browser</a> }] : [];
}
