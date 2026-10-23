import type { RadioPlaylist, RadioScheduleEntry, RadioStation } from "../shared/radio";
import { GuideError, guideFetch, guideLimits, parseGuidePrograms } from "./iptv-feeds";

/** One bounded, shared guide fetch per source, including failed reads. */
export function createRadioGuides({ fetch: request, signal, now = Date.now }: { fetch: typeof fetch; signal: AbortSignal; now?: () => number }) {
  type Result = { programmes: Map<string, RadioScheduleEntry[]>; retryAt: number };
  const cache = new Map<string, Result>();
  const pending = new Map<string, Promise<Result>>();
  return {
    async get(source: RadioPlaylist, stations: RadioStation[]): Promise<Result> {
      const url = source.guideUrl || source.discoveredGuideUrl;
      if (!url || signal.aborted) return { programmes: new Map(), retryAt: now() + 15 * 60_000 };
      const key = JSON.stringify([source.id, url, source.updatedAt]);
      const cached = cache.get(key);
      if (cached && cached.retryAt > now()) return cached;
      const existing = pending.get(key);
      if (existing) return existing;
      const work = (async () => {
        let result: Result = { programmes: cached?.programmes ?? new Map(), retryAt: now() + 60_000 };
        try {
          const response = await guideFetch(url, guideLimits.xmlBytes, request, AbortSignal.any([signal, AbortSignal.timeout(10_000)]), source.guideUrl ? undefined : new URL(url).origin);
          const rows = parseGuidePrograms(Buffer.from(response.bytes).toString("utf8"), stations.flatMap(station => station.tvgId ? [{ id: station.id, tvgId: station.tvgId }] : []), { partial: true, base: response.url });
          const programmes = new Map<string, RadioScheduleEntry[]>();
          for (const row of rows.sort((a, b) => a.start - b.start)) {
            if (row.end <= now() || row.start > now() + 24 * 60 * 60_000) continue;
            const list = programmes.get(row.channelId) ?? [];
            if (list.length < 48) list.push(row);
            programmes.set(row.channelId, list);
          }
          result = { programmes, retryAt: now() + 15 * 60_000 };
        } catch (error) {
          if (error instanceof GuideError && error.retryMs) result.retryAt = now() + error.retryMs;
        }
        if (!signal.aborted) {
          if (cache.size >= 32) cache.delete(cache.keys().next().value!);
          cache.set(key, result);
        }
        return result;
      })().finally(() => pending.delete(key));
      pending.set(key, work);
      return work;
    },
  };
}
