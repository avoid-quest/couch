import { createHash } from "node:crypto";
import type { ProviderId, ProviderItem, ProviderPage } from "../../shared/providers";

export class ProviderError extends Error {
  constructor(message: string, readonly status = 502) { super(message); }
}

export const providerItemId = (provider: ProviderId, url: string) => `${provider}-${createHash("sha256").update(url).digest("hex").slice(0, 32)}`;

/** The browsed target is independently saveable after a direct page load. */
export function withProviderItem(provider: ProviderId, url: string, kind: ProviderItem["kind"], page: ProviderPage): ProviderPage {
  const item = kind === "media" ? page.items.find(item => item.url === url) : undefined;
  return { ...page, item: item ?? { id: providerItemId(provider, url), provider, kind, url, title: (page.title || provider).slice(0, 200), thumbnail: page.thumbnail, description: page.description, subtitle: page.subtitle } };
}

export async function providerJson(url: string, init: RequestInit = {}, request: typeof fetch = globalThis.fetch): Promise<unknown> {
  const signal = AbortSignal.any([...(init.signal ? [init.signal] : []), AbortSignal.timeout(12_000)]);
  const response = await request(url, { ...init, signal, redirect: "error" });
  if (!response.ok) { await response.body?.cancel(); throw new ProviderError(`The provider returned HTTP ${response.status}. Try again shortly.`); }
  const maximum = 4 * 1024 * 1024;
  if (Number(response.headers.get("Content-Length")) > maximum) { await response.body?.cancel(); throw new ProviderError("The provider returned too much data."); }
  if (!response.body) throw new ProviderError("The provider returned no data.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    for (;;) {
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.length;
      if (size > maximum) throw new ProviderError("The provider returned too much data.");
      chunks.push(value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new ProviderError("The provider returned invalid data."); }
  } finally { signal.removeEventListener("abort", abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
