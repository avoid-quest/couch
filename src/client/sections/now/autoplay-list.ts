import { useInfiniteQuery } from "@tanstack/react-query";
import { apiJson, type ApiCredentials } from "@/api/client";
import type { QueueEntry, SessionState } from "../../../shared/protocol";

type Page = { entries: QueueEntry[]; total: number };

/**
 * Autoplay's whole list for Up next: its first entries come with the state, the rest a page at a time
 * when `more` is called, as Up next scrolls. A changed list (another pick, another collection) starts over.
 */
export function useAutoplayList(
  credentials: ApiCredentials,
  playbackId: string | null | undefined,
  autoplay: SessionState["autoplay"],
) {
  const upcoming = autoplay?.enabled ? autoplay.upcoming : [];
  const total = autoplay?.enabled ? (autoplay.total ?? upcoming.length) : 0;
  const pages = useInfiniteQuery({
    queryKey: ["autoplay", credentials.origin, playbackId, upcoming[0]?.id, total],
    queryFn: ({ pageParam, signal }) =>
      apiJson<Page>(
        credentials,
        `/api/autoplay?playback=${encodeURIComponent(playbackId ?? "")}&offset=${pageParam}`,
        { signal },
      ),
    initialPageParam: upcoming.length,
    getNextPageParam: (last, all) => {
      const loaded = upcoming.length + all.reduce((count, page) => count + page.entries.length, 0);
      return last.entries.length && loaded < last.total ? loaded : undefined;
    },
    enabled: false,
  });
  const entries = [...upcoming, ...(pages.data?.pages.flatMap((page) => page.entries) ?? [])];
  const hasMore = !!playbackId && entries.length < total && !pages.isError;
  return {
    entries,
    hasMore,
    more: () => {
      if (hasMore && !pages.isFetching) void pages.fetchNextPage();
    },
  };
}
