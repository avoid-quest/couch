import snapshot from "./releases.json";
import { downloadUrl, publicFiles, releasePlatforms, type Channel, type PackageFormat } from "../../../scripts/hosted-policy";

export const formats = ["dmg", "nsis", "appimage", "deb"] as const satisfies readonly PackageFormat[];
export type Release = { version: string; url: string; filename: string };
export type Catalog = Record<Channel, Partial<Record<PackageFormat, Release>>>;
type Versions = Record<Channel, Partial<Record<PackageFormat, string>>>;
// These versions came from the signed, publicly checked release receipts.
// A newer live updater feed wins for its own channel and package format.
const fallback = snapshot as Versions;
const versionPattern = /^\d+\.\d+\.\d+(?:-preview\.\d+)?$/;

export function release(format: PackageFormat, channel: Channel, version: string): Release | null {
  if (!versionPattern.test(version) || (channel === "preview") !== version.includes("-preview.")) return null;
  const filename = publicFiles(version, format)[0]!;
  return { version, filename, url: downloadUrl(filename, channel) };
}

export function newer(first: string, second: string): boolean {
  return first.localeCompare(second, "en", { numeric: true }) > 0;
}

export function catalog(versions: Versions = fallback): Catalog {
  return { stable: Object.fromEntries(formats.flatMap(format => {
    const found = versions.stable[format] && release(format, "stable", versions.stable[format]);
    return found ? [[format, found]] : [];
  })), preview: Object.fromEntries(formats.flatMap(format => {
    const found = versions.preview[format] && release(format, "preview", versions.preview[format]);
    return found ? [[format, found]] : [];
  })) };
}

export async function currentCatalog(fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = fetch): Promise<Catalog> {
  const current = catalog();
  await Promise.all((["stable", "preview"] as const).flatMap(channel => formats.map(async format => {
    const path = releasePlatforms(format).update;
    const endpoint = `https://cdn.crabnebula.app/update/avoid-quest/couch/${path}/0.0.0${channel === "preview" ? "?channel=preview" : ""}`;
    const response = await fetcher(endpoint, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
    if (!response?.ok) return;
    const body = await response.json().catch(() => null);
    const found = body && typeof body.version === "string" && typeof body.url === "string" && release(format, channel, body.version);
    if (found && (!current[channel][format] || newer(found.version, current[channel][format]!.version))) current[channel][format] = found;
  })));
  return current;
}
