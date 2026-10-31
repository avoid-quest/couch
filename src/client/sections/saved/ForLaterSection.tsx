import { browserActions } from "@/original-page";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, type CSSProperties, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { MediaTile } from "@/components/MediaTile";
import { useArtRatio } from "@/components/MediaArtwork";
import { shapeRatio } from "@/components/Stage";
import { metaLine, mediaCaption } from "@/media-caption";
import { formatRuntime } from "@/time-format";
import { itemLocation, useDetailNavigation } from "@/detail-navigation";
import { savedShape } from "@/art-shape";
import { savedSourceLabel } from "@/saved-source";
import { playOnQuery, usePlayOn } from "@/components/PlayOn";
import { applyIdOrder, reorderedIds } from "@/lib/dnd";
import { useOptionalSessionGate } from "@/session/session-context";
import type { ForLaterItem } from "../../../shared/for-later";
import { forLaterQuery } from "@/api/for-later";
import { apiSend } from "@/api/client";
import { SavedEmpty, SavedError, SavedStatus, useRemovalFocus } from "./SavedStatus";
import { savedNotice } from "@/copy";

type Mode = "play" | "append" | "remove";

export function ForLaterSection({ origin, token, connected, canPlay, onFind, showHeading = true }: {
  origin: string; token: string; connected: boolean; canPlay: boolean;
  /** Shown as the empty state's next step. */
  onFind?: () => void;
  /** A visible section title. Saved titles the tab with its PageHeader. */
  showHeading?: boolean;
}) {
  // The session invalidates ["for-later"] whenever any remote changes the list.
  const session = useOptionalSessionGate();
  const details = useDetailNavigation();
  const queryClient = useQueryClient();
  const credentials = { origin, token };
  const refresh = () => queryClient.invalidateQueries({ queryKey: forLaterQuery(credentials).queryKey });
  const { data, isPending, error: loadError, refetch } = useQuery({ ...forLaterQuery(credentials), enabled: connected });
  const reorder = useMutation({
    mutationFn: (order: string[]) => apiSend(credentials, "/api/for-later/reorder", { order }, "POST", 10_000),
    onSettled: refresh,
  });
  const { play } = usePlayOn();
  const action = useMutation({
    mutationFn: ({ item, mode, deviceId }: { item: ForLaterItem; mode: Mode; deviceId?: string }) => {
      const path = `/api/for-later/${encodeURIComponent(item.id)}`;
      const send = (on?: string) => apiSend<{ undoToken?: string } | undefined>(credentials, mode === "remove" ? path : `${path}/load${playOnQuery(on)}`, mode === "remove" ? undefined : { mode }, mode === "remove" ? "DELETE" : "POST", 30_000);
      return mode === "play" ? play(send, deviceId) : mode === "append" && session ? session.queue(item.title, send) : send();
    },
    onSuccess: async (body, { item, mode }) => {
      if (mode !== "remove") return;
      const text = savedNotice(item.title, false);
      const undoToken = body && body.undoToken;
      if (undoToken && session) session.offerUndo(text, async () => {
        await apiSend(credentials, "/api/for-later/restore", { token: undoToken }, "POST", 10_000);
        await refresh();
      });
      await refresh();
    },
  });
  // A pending reorder renders its order so a move shows immediately.
  const items = applyIdOrder(connected ? data?.items ?? [] : [], reorder.isPending ? reorder.variables : undefined, item => item.id);
  const loading = connected && isPending;
  const pending = action.isPending;
  const section = useRef<HTMLElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const shapes = items.map(savedShape);
  const shape = shapes.every(value => value === shapes[0]) ? shapes[0] ?? "video" : "square";
  const removing = useRemovalFocus(items.map(item => item.id), !pending, list, () => section.current?.querySelector<HTMLElement>("button:not(:disabled)") ?? heading.current);
  const act = (item: ForLaterItem, mode: Mode, index: number, deviceId?: string) => {
    if (!connected || pending) return;
    if (mode === "remove") removing(item.id, index);
    action.mutate({ item, mode, deviceId });
  };
  // Move up and Move down, as the ordered ids the server persists.
  const order = (index: number, offset: number) => reorderedIds(items, item => item.id, items[index]!.id, items[index + offset]?.id ?? "")?.map(item => item.id);
  const failure = action.error ? action.error.message || "Couldn't use this item." : reorder.error ? reorder.error.message || "Couldn't save the order." : "";

  return <section ref={section} aria-labelledby="for-later-title">
    <h2 ref={heading} tabIndex={-1} id="for-later-title" className={showHeading ? "mb-2 text-base font-medium outline-none" : "sr-only"}>For later</h2>
    <SavedStatus connected={connected} loading={loading} />
    {connected && loadError && <SavedError message={loadError.message || "Couldn't load For later."} onRetry={() => void refetch()} />}
    {connected && failure && <SavedError message={failure} />}
    {connected && !loading && !loadError && !items.length && <SavedEmpty title="Nothing saved for later" action={onFind && <Button onClick={onFind}>Search</Button>}>Choose Save on a film, video or track to find it here.</SavedEmpty>}
    {!!items.length && <ul ref={list} data-nav-row aria-label="For later" className="saved-media-grid">
      {items.map((item, index) => {
        const inspect = () => details.open(itemLocation("saved", item.id));
        const blocked = !connected || pending || reorder.isPending;
        const move = (offset: number) => { const next = order(index, offset); if (next && !blocked) reorder.mutate(next); };
        const caption = mediaCaption(item);
        // Artwork leads a saved collection; the existing menu keeps its playback, ordering and removal verbs.
        return <SavedItem key={item.id} item={item}><MediaTile natural data-saved-details={item.id} source={item.url} related={{ collection: item.collection, creator: item.creator }}
          thumbnail={item.thumbnail} shape={shape} own={savedShape(item)}
          title={caption.title}
          meta={metaLine(caption.lead, item.creator?.title ?? caption.subtitle, savedSourceLabel(item), !item.live && item.duration != null && formatRuntime(item.duration))}
          aria-label={`Details ${caption.title}`} href={itemLocation("saved", item.id)} onClick={inspect}
          menu={[
            { label: "Play", disabled: !connected || !canPlay || pending, run: () => act(item, "play", index) },
            { label: "Play on", disabled: !connected || !canPlay || pending, playOn: deviceId => act(item, "play", index, deviceId) },
            { label: "Queue", disabled: !connected || pending, run: () => act(item, "append", index) },
            ...browserActions(item.url),
            { label: "Move up", disabled: blocked || index === 0, run: () => move(-1) },
            { label: "Move down", disabled: blocked || index === items.length - 1, run: () => move(1) },
            { label: "Remove", disabled: !connected || pending, run: () => act(item, "remove", index) },
          ]} /></SavedItem>;
      })}
    </ul>}
  </section>;
}

/** A justified row's item grows by its picture's proportions, read as its tile reads them, so the row shares one height. */
function SavedItem({ item, children }: { item: ForLaterItem; children: ReactNode }) {
  const [ref, ratio] = useArtRatio(item.thumbnail, shapeRatio[savedShape(item)]);
  return <li ref={ref} style={{ "--tile-ratio": ratio } as CSSProperties}>{children}</li>;
}
