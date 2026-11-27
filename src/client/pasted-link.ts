import { useQuery } from "@tanstack/react-query";
import { providerPageQuery } from "@/api/providers";
import type { ApiCredentials } from "@/api/client";
import { createId } from "@/session/session";
import type { Action, VideoQuality } from "../shared/protocol";
import type { LinkTarget } from "../shared/providers";

// Couch's queue limit: a longer list queues its first 500.
const queueLimit = 500;
export type LinkVerb = "play" | "queue" | "next";

/**
 * A pasted list, as Play all and its count read it: the list's own page, which Open shows too. The count is the list's
 * length when its source says or the page holds all of it, else unknown.
 */
export function usePastedList(
  credentials: ApiCredentials | null | undefined,
  url: string,
  target: LinkTarget | undefined,
) {
  const page = useQuery({
    ...providerPageQuery(credentials ?? { origin: "", token: "" }, target?.provider ?? "youtube", {
      url,
    }),
    enabled: !!credentials && target?.shape === "playlist",
  }).data;
  const count =
    page?.count ??
    (page && !page.nextCursor
      ? page.items.filter((item) => item.kind === "media").length
      : undefined);
  return { title: page?.title, count };
}

/** "Play all (12)"; over the queue limit, "Play all (4,626)" with the note that the first 500 go. */
export const listLabel = (verb: "Play all" | "Queue all", count?: number) =>
  count === undefined ? verb : `${verb} (${count.toLocaleString()})`;
export const listLimit = (count?: number) =>
  count !== undefined && count > queueLimit ? `first ${queueLimit}` : undefined;

/** A pasted link's verb: a list loads and queues whole (Play all plays its first and keeps the rest to follow). */
export function linkAction(
  url: string,
  target: LinkTarget | undefined,
  verb: LinkVerb,
  quality: VideoQuality,
  list: { title?: string; count?: number } = {},
  deviceId?: string,
): Action {
  const how = {
    ...(verb === "play" ? { playNow: true } : {}),
    ...(verb === "next" ? { placement: "next" as const } : {}),
    ...(deviceId ? { deviceId } : {}),
  };
  if (target?.shape !== "playlist")
    return { type: "enqueueWeb", entryId: createId(), url, quality, ...how };
  const limit = listLimit(list.count);
  const title = list.title && (limit ? `the ${limit} of ${list.title}` : list.title);
  return {
    type: "enqueueProvider",
    provider: target.provider,
    url,
    shape: "playlist",
    quality,
    ...(verb !== "play" && title ? { title: title.slice(0, 200) } : {}),
    ...how,
  };
}
