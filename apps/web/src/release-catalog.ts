import snapshot from "./releases.json";
import { downloadUrl, publicFiles, releasePlatforms, type Channel, type PackageFormat } from "./release-policy";

export const formats = ["dmg", "nsis", "appimage", "deb"] as const satisfies readonly PackageFormat[];
export type Release = { version: string; url: string; filename: string };
export type Catalog = Record<Channel, Partial<Record<PackageFormat, Release>>>;
// These installers came from the signed, publicly checked release receipts.
// A newer live updater feed wins for its own channel and package format.
const fallback = snapshot as Catalog;
const versionPattern = /^\d+\.\d+\.\d+(?:-preview\.\d+)?$/;

export function release(format: PackageFormat, channel: Channel, version: string): Release | null {
  if (!versionPattern.test(version) || (channel === "preview") !== version.includes("-preview.")) return null;
  const filename = publicFiles(version, format)[0]!;
  return { version, filename, url: downloadUrl(filename, channel) };
}

export function newer(first: string, second: string): boolean {
  return first.localeCompare(second, "en", { numeric: true }) > 0;
}

export function catalog(source: Catalog = fallback): Catalog {
  return { stable: { ...source.stable }, preview: { ...source.preview } };
}

export async function currentCatalog(fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = fetch, base: Catalog = fallback): Promise<Catalog> {
  const current = catalog(base);
  await Promise.all((["stable", "preview"] as const).flatMap(channel => formats.map(async format => {
    const path = releasePlatforms(format).update;
    const endpoint = `https://cdn.crabnebula.app/update/avoid-quest/couch/${path}/0.0.0${channel === "preview" ? "?channel=preview" : ""}`;
    // Cloudflare keeps each feed answer for a minute.
    const response = await fetcher(endpoint, { signal: AbortSignal.timeout(10_000), cf: { cacheTtl: 60, cacheEverything: true } } as RequestInit).catch(() => null);
    if (!response?.ok) return;
    const body = await response.json().catch(() => null);
    const found = body && typeof body.version === "string" && typeof body.url === "string" && release(format, channel, body.version);
    if (found && (!current[channel][format] || newer(found.version, current[channel][format]!.version))) current[channel][format] = found;
  })));
  return current;
}

