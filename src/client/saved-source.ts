import type { ForLaterItem } from "../shared/for-later";
import { providerForUrl, providerNames } from "../shared/providers";

export function savedSourceLabel(item: ForLaterItem) {
  if (item.kind === "radio") return "Radio";
  if (!item.url) return "";
  try {
    const provider = providerForUrl(item.url);
    return provider ? providerNames[provider] : new URL(item.url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
