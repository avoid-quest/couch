import { useCallback, useLayoutEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { providerPageQuery } from "@/api/providers";
import { radioSearchQuery } from "@/api/radio";
import type { ApiCredentials } from "@/api/client";
import { createId } from "@/session/session";
import { useOptionalSessionGate } from "@/session/session-context";
import { dismiss, notice, pendingNotice } from "@/toasts";
import type { Action, VideoQuality } from "../shared/protocol";
import { onArchiveSite } from "../shared/archives";
import type { LinkTarget, ProviderId } from "../shared/providers";

// Couch's queue limit: a longer list queues its first 500.
const queueLimit = 500;
// A list Core answers sooner than this starts without a loading notice flashing first.
const loadingDelay = 400;
export type LinkVerb = "play" | "queue" | "next";

// An episode's, a mix's or a Spotify song's page comes over plain HTTP, so it's cheap enough to name what plays.
const titled: ProviderId[] = ["archives", "mixcloud", "spotify"];
/**
 * A pasted list, as Play all and its count read it: the list's own page, which Open shows too. The count is the list's
 * length when its source says or the page holds all of it, else unknown. A single episode, mix or song gives its title.
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
    enabled:
      !!credentials &&
      (target?.shape === "playlist" ||
        (target?.shape === "atom" && titled.includes(target.provider))),
  }).data;
  const count =
    page?.count ??
    (page && !page.nextCursor
      ? page.items.filter((item) => item.kind === "media").length
      : undefined);
  // Queue all can add only what Up next has room for.
  const queued = useOptionalSessionGate()?.state?.queue.length ?? 0;
  return { title: page?.title, count, queued };
}

/** The avoid radio station a pasted station's page plays, as Home does: the one whose stream or logo is on its site. */
export function useLinkStation(
  credentials: ApiCredentials | null | undefined,
  url: string,
  target: LinkTarget | undefined,
) {
  const station = target?.shape === "station";
  const stations = useQuery({
    ...radioSearchQuery(credentials ?? { origin: "", token: "" }, "avoid radio", ""),
    enabled: !!credentials && station,
  }).data?.stations;
  if (!station) return;
  return stations?.find((radio) =>
    [radio.url, radio.logoUrl].some((address) => address && onArchiveSite(url, address)),
  );
}

/**
 * Whether a pasted link's page plays as itself: a Twitch channel does; Mixcloud's list of playlists only opens, and a
 * station's page plays its station instead.
 */
export const linkPlays = (target: LinkTarget | undefined) =>
  !(target?.shape === "page" && target.provider === "mixcloud") && target?.shape !== "station";

/** "Play all (12)"; over the queue limit, "Play all (4,626)" with the note that the first 500 go. */
export const listLabel = (verb: "Play all" | "Queue all", count?: number) =>
  count === undefined ? verb : `${verb} (${count.toLocaleString()})`;
/** Play all keeps up to 500 to follow; Queue all and Play next add what Up next (`queued` long) has room for. */
export function listLimit(count?: number, queued = 0) {
  const room = Math.max(0, Math.min(queueLimit, queueLimit - queued));
  return count !== undefined && count > room ? `first ${room}` : undefined;
}

/** A pasted link's verb: a list loads and queues whole (Play all plays its first and keeps the rest to follow). */
export function linkAction(
  url: string,
  target: LinkTarget | undefined,
  verb: LinkVerb,
  quality: VideoQuality,
  list: { title?: string; count?: number; queued?: number } = {},
  deviceId?: string,
): Action {
  const how = {
    ...(verb === "play" ? { playNow: true } : {}),
    ...(verb === "next" ? { placement: "next" as const } : {}),
    ...(deviceId ? { deviceId } : {}),
  };
  if (target?.shape !== "playlist")
    return { type: "enqueueWeb", entryId: createId(), url, quality, ...how };
  const limit = listLimit(list.count, verb === "play" ? 0 : list.queued);
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

/** What a list holds, by its source: radio shows' episodes, videos, else tracks. */
export const listUnit = (provider: ProviderId, count: number) => {
  const unit = ["archives", "mixcloud"].includes(provider)
    ? "episode"
    : ["youtube", "twitch", "raiplay"].includes(provider)
      ? "video"
      : "track";
  return `${count.toLocaleString()} ${unit}${count === 1 ? "" : "s"}`;
};

/**
 * A pasted list's verb, which can take half a minute while its source loads: "Loading Baile Funk…" shows unless Core
 * answers within `loadingDelay`, and goes when it does. When Play all keeps fewer than the count the list showed, a notice says how many it plays.
 */
export function useListCommand(run: ((action: Action) => Promise<boolean>) | undefined) {
  const autoplay = useOptionalSessionGate()?.state?.autoplay;
  const latest = useRef(autoplay);
  useLayoutEffect(() => {
    latest.current = autoplay;
  });
  return useCallback(
    async (action: Action, list: { title?: string; count?: number }, name: string) => {
      if (!run) return false;
      if (action.type !== "enqueueProvider" || action.shape !== "playlist") return run(action);
      const loading = setTimeout(
        () => pendingNotice(`Loading ${list.title ?? name}…`),
        loadingDelay,
      );
      const ok = await run(action).finally(() => clearTimeout(loading));
      // The snapshot with the list's Autoplay can render just after the reply.
      const answered = latest.current;
      for (let tries = 0; ok && latest.current === answered && tries < 10; tries++)
        await new Promise((resolve) => setTimeout(resolve, 25));
      const total = latest.current?.total;
      const loaded = total !== undefined && total + 1;
      const shown = list.count !== undefined && Math.min(list.count, queueLimit);
      if (ok && action.playNow && loaded && shown && loaded < shown)
        notice(
          `Playing ${loaded.toLocaleString()} of ${listUnit(action.provider, shown)}, some couldn't be read`,
        );
      else dismiss("notice");
      return ok;
    },
    [run],
  );
}
