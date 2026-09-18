import type { HistoryItem } from "../shared/library";
import type { RadioStation } from "../shared/radio";

// One rule for "Recently played" everywhere: live stations first (recents
// storage keeps them newest-first), then progress-tracked media newest-first.
// Each kind renders its own actions; live offers play only, media offers
// resume and its watching options.
export type RecentEntry =
  | { key: string; kind: "radio"; station: RadioStation }
  | { key: string; kind: "media"; item: HistoryItem };

export function mergeRecent(history: HistoryItem[], stations: RadioStation[] = [], excludeMediaId?: string): RecentEntry[] {
  return [
    ...stations.map(station => ({ key: `radio:${station.id}`, kind: "radio" as const, station })),
    ...history.filter(item => item.mediaId !== excludeMediaId).map(item => ({ key: item.mediaId, kind: "media" as const, item })),
  ];
}
