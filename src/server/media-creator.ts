import { providerForUrl } from "../shared/providers";
import type { CollectionLink } from "../shared/media";

export function mediaCreator(info: Record<string, unknown>): CollectionLink | undefined {
  const name = info.channel || info.uploader || info.artist;
  const address = info.channel_url || info.uploader_url || info.artist_url;
  if (typeof name !== "string" || typeof address !== "string") return;
  try {
    const url = new URL(address);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || !providerForUrl(url.href)) return;
    const title = name.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 200);
    if (title) return { title, url: url.href };
  } catch { /* Optional relationship metadata. */ }
}
