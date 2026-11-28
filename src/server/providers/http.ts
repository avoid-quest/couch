import { createHash } from "node:crypto";
import type { ProviderId, ProviderItem, ProviderPage } from "../../shared/providers";
import { publicFetch } from "../public-network";

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
  }
}

/** A JSON object a site returned, as opposed to an array, null or a scalar. */
export const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
/** A site's text on one line, without control characters, at most `limit` long. */
export const label = (value: unknown, limit = 200) =>
  typeof value === "string"
    ? value
        .replace(/[\s\u0000-\u001f\u007f]+/g, " ")
        .trim()
        .slice(0, limit) || undefined
    : undefined;

/** Catalogue requests leave through Core's public network boundary; tests put their own site in its place. */
export const catalogueTransport: { fetch: typeof fetch } = { fetch: publicFetch };

export const providerItemId = (provider: ProviderId, url: string) =>
  `${provider}-${createHash("sha256").update(url).digest("hex").slice(0, 32)}`;

/** The browsed target is independently saveable after a direct page load. */
export function withProviderItem(
  provider: ProviderId,
  url: string,
  kind: ProviderItem["kind"],
  page: ProviderPage,
): ProviderPage {
  const item = kind === "media" ? page.items.find((item) => item.url === url) : undefined;
  return {
    ...page,
    item: item ?? {
      id: providerItemId(provider, url),
      provider,
      kind,
      url,
      title: (page.title || provider).slice(0, 200),
      thumbnail: page.thumbnail,
      description: page.description,
      subtitle: page.subtitle,
      ...(page.parent ? { collection: page.parent } : {}),
    },
  };
}

export async function readProviderText(
  response: Response,
  maximum: number,
  signal: AbortSignal,
  invalid: Error,
): Promise<string> {
  if (Number(response.headers.get("Content-Length")) > maximum) {
    await response.body?.cancel().catch(() => {});
    throw invalid;
  }
  const reader = response.body?.getReader();
  if (!reader) throw invalid;
  const chunks: Uint8Array[] = [];
  let size = 0;
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    for (;;) {
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.length;
      if (size > maximum) throw invalid;
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function providerJson(
  url: string,
  init: RequestInit = {},
  request: typeof fetch = globalThis.fetch,
): Promise<unknown> {
  return (await providerJsonResponse(url, init, request)).value;
}

/** A provider's JSON and the headers it came with (WordPress counts a collection's pages in one). */
export async function providerJsonResponse(
  url: string,
  init: RequestInit = {},
  request: typeof fetch = globalThis.fetch,
): Promise<{ value: unknown; headers: Headers }> {
  const signal = AbortSignal.any([
    ...(init.signal ? [init.signal] : []),
    AbortSignal.timeout(12_000),
  ]);
  const response = await request(url, { ...init, signal, redirect: "error" });
  if (!response.ok) {
    await response.body?.cancel();
    throw new ProviderError(`The provider returned HTTP ${response.status}. Try again shortly.`);
  }
  if (!response.body) throw new ProviderError("The provider returned no data.");
  const text = await readProviderText(
    response,
    4 * 1024 * 1024,
    signal,
    new ProviderError("The provider returned too much data."),
  );
  try {
    return { value: JSON.parse(text), headers: response.headers };
  } catch {
    throw new ProviderError("The provider returned invalid data.");
  }
}
