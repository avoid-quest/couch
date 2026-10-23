import { compareUpdateVersions, type ReleaseHistory, type ReleaseNotes } from "../shared/releases";
import { isUpdateVersion, type UpdateChannel } from "../shared/updates";

const repository = "https://github.com/avoid-quest/couch";
const pageSize = 30;

/** Plain text for React to render. Keep the changes, with the original release one link away. */
export function releaseNoteItems(body: string): string[] {
  const items: string[] = [];
  let skip = false;
  for (const line of body.split(/\r?\n/)) {
    const heading = /^#{1,6}\s+(.+)$/.exec(line.trim());
    if (heading) {
      skip = /^(installing|installation|new contributors|full changelog)\b/i.test(heading[1]!);
      continue;
    }
    if (skip || !/^\s*[-*]\s+/.test(line)) continue;
    const text = line.trim().replace(/^[-*]\s+/, "")
      .replace(/\s+by @\S+ in https:\/\/github\.com\/\S+\s*$/, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]*>/g, "").replace(/[*`]/g, "")
      .replace(/&(amp|lt|gt|quot|#39);/g, (_, entity: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[entity]!)
      .trim();
    if (text) items.push(text);
  }
  return items;
}

/** Share GitHub reads across viewers and channels; history is fetched only when someone opens it. */
export function createReleaseHistory(fetcher: typeof fetch = fetch) {
  const cache = new Map<number, { until: number; releases: ReleaseNotes[]; more: boolean }>();
  const pending = new Map<number, Promise<{ releases: ReleaseNotes[]; more: boolean }>>();
  const page = (number: number) => {
    const saved = cache.get(number);
    if (saved && saved.until > Date.now()) return Promise.resolve(saved);
    let request = pending.get(number);
    if (!request) {
      request = (async () => {
        const response = await fetcher(`https://api.github.com/repos/avoid-quest/couch/releases?per_page=${pageSize}&page=${number}`, {
          headers: { "User-Agent": "Couch", Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error("Couldn't load the release notes. Try again later.");
        const entries: unknown = await response.json();
        if (!Array.isArray(entries)) throw new Error("Couldn't read the release notes.");
        const releases = entries.flatMap((entry): ReleaseNotes[] => {
          if (!entry || typeof entry !== "object" || entry.draft || typeof entry.tag_name !== "string") return [];
          const version = entry.tag_name.replace(/^v/, "");
          if (!isUpdateVersion(version) || typeof entry.published_at !== "string" || !Number.isFinite(Date.parse(entry.published_at))) return [];
          return [{ version, publishedAt: entry.published_at, url: `${repository}/releases/tag/${encodeURIComponent(entry.tag_name)}`,
            items: typeof entry.body === "string" ? releaseNoteItems(entry.body) : [] }];
        }).sort((a, b) => compareUpdateVersions(b.version, a.version));
        const result = { releases, more: entries.length === pageSize };
        cache.set(number, { ...result, until: Date.now() + 5 * 60_000 });
        return result;
      })().finally(() => pending.delete(number));
      pending.set(number, request);
    }
    return request;
  };
  return async (channel: UpdateChannel, number = 1): Promise<ReleaseHistory> => {
    const result = await page(number);
    return { releases: result.releases.filter(release => release.version.includes("-preview.") === (channel === "preview")), more: result.more };
  };
}
