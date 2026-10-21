import { providerForUrl } from "../shared/providers";
import type { CollectionLink } from "../shared/media";

export function mediaCreator(info: Record<string, unknown>): CollectionLink | undefined {
  for (const kind of ["channel", "uploader", "artist"]) {
    const name = info[kind], address = info[`${kind}_url`];
    if (typeof name !== "string" || typeof address !== "string") continue;
    try {
      const url = new URL(address);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || !providerForUrl(url.href)) continue;
      const title = name.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 200);
      if (title) return { title, url: url.href };
    } catch { /* Optional relationship metadata. */ }
  }
}
