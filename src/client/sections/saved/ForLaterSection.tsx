import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AuthArtwork } from "@/components/AuthArtwork";
import { MediaArtwork } from "@/components/MediaArtwork";
import { DurationBar } from "@/components/DurationBar";
import { collectionTarget } from "@/collection-target";
import { MediaDetails } from "@/components/MediaDetails";
import { providerForUrl, type ProviderItem } from "../../../shared/providers";
import { MediaList, MediaRow } from "@/components/MediaRow";
import { applyIdOrder, reorderedIds, SortableRow, useDndSensors } from "@/lib/dnd";
import { useOptionalSessionGate } from "@/session/session-context";
import type { ForLaterItem } from "../../../shared/for-later";
import { forLaterQuery } from "@/api/for-later";
import { apiSend } from "@/api/client";
import { SavedEmpty, SavedError, SavedStatus, useRemovalFocus } from "./SavedStatus";
import { playNotice, savedNotice } from "@/copy";

// The gesture for one drop, as the ordered ids the server persists.
export function forLaterOrder(items: ForLaterItem[], activeId: string, overId: string): string[] | null {
  const next = reorderedIds(items, item => item.id, activeId, overId);
  return next && next.map(item => item.id);
}

function sourceLabel(item: ForLaterItem) {
  if (item.kind === "radio") return "Radio";
  if (!item.url) return "";
  try {
    const provider = providerForUrl(item.url);
    return provider ? { youtube: "YouTube", twitch: "Twitch", raiplay: "RaiPlay", bandcamp: "Bandcamp", streamingcommunity: "StreamingCommunity" }[provider] : new URL(item.url).hostname.replace(/^www\./, "");
  } catch { return ""; }
}

type Mode = "play" | "append" | "remove";

export function ForLaterSection({ origin, token, connected, canPlay, onFind, onOpenProvider, showHeading = true, mediaOnly = false, limit }: {
  origin: string; token: string; connected: boolean; canPlay: boolean;
  onOpenProvider?: (item: ProviderItem, returnFocusLabel?: string) => void;
  /** Shown as the empty state's next step. */
  onFind?: () => void;
  /** A visible section title (Find). Saved titles the tab with its PageHeader. */
  showHeading?: boolean;
  /** Only video and music, for Home. */
  mediaOnly?: boolean;
  /** Show only the first items, for Home. */
  limit?: number;
}) {
  // The session invalidates ["for-later"] whenever any remote changes the list.
  const session = useOptionalSessionGate();
  const queryClient = useQueryClient();
  const credentials = { origin, token };
  const refresh = () => queryClient.invalidateQueries({ queryKey: forLaterQuery(credentials).queryKey });
  const { data, isPending, error: loadError, refetch } = useQuery({ ...forLaterQuery(credentials), enabled: connected });
  const reorder = useMutation({
    mutationFn: (order: string[]) => apiSend(credentials, "/api/for-later/reorder", { order }, "POST", 10_000),
    onSettled: refresh,
  });
  const action = useMutation({
    mutationFn: ({ item, mode }: { item: ForLaterItem; mode: Mode }) => {
      const path = `/api/for-later/${encodeURIComponent(item.id)}`;
      return apiSend<{ notice?: string; undoToken?: string } | undefined>(credentials, mode === "remove" ? path : `${path}/load`, mode === "remove" ? undefined : { mode }, mode === "remove" ? "DELETE" : "POST", 30_000);
    },
    onSuccess: async (body, { item, mode }) => {
      if (mode !== "remove") {
        if (body?.notice) toast(body.notice);
        else if (mode === "append") toast(playNotice(item.title, "queue"));
        return;
      }
      const text = savedNotice(item.title, false);
      const undoToken = body?.undoToken;
      if (undoToken && session) session.offerUndo(text, async () => {
        await apiSend(credentials, "/api/for-later/restore", { token: undoToken }, "POST", 10_000);
        await refresh();
      });
      else toast(text);
      await refresh();
    },
  });
  // A pending reorder renders its order so the drop shows immediately.
  const all = applyIdOrder(connected ? (data?.items ?? []).filter(item => !mediaOnly || item.kind !== "radio" && !item.live) : [], reorder.isPending ? reorder.variables : undefined, item => item.id);
  const items = all.slice(0, limit);
  const loading = connected && isPending;
  const pending = action.isPending;
  const section = useRef<HTMLElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const sensors = useDndSensors();
  const removing = useRemovalFocus(items.map(item => item.id), !pending, list, () => section.current?.querySelector<HTMLElement>("button:not(:disabled)") ?? heading.current);
  const act = (item: ForLaterItem, mode: Mode, index: number) => {
    if (!connected || pending) return;
    if (mode === "remove") removing(item.id, index);
    action.mutate({ item, mode });
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const order = over && forLaterOrder(all, String(active.id), String(over.id));
    if (order) reorder.mutate(order);
  };
  const failure = action.error ? action.error.message || "Couldn't use this item." : reorder.error ? reorder.error.message || "Couldn't save the order." : "";

  return <section ref={section} aria-labelledby="for-later-title">
    <h2 ref={heading} tabIndex={-1} id="for-later-title" className={showHeading ? "mb-2 text-base font-medium outline-none" : "sr-only"}>For later</h2>
    <SavedStatus connected={connected} loading={loading} />
    {connected && loadError && <SavedError message={loadError.message || "Couldn't load For later."} onRetry={() => void refetch()} />}
    {connected && failure && <SavedError message={failure} />}
    {connected && !loading && !loadError && !items.length && <SavedEmpty action={onFind && <Button variant="outline" onClick={onFind}>Find</Button>}>Nothing saved yet. Use Save on anything in Find.</SavedEmpty>}
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      {!!items.length && <MediaList ref={list} aria-label="For later">
        <SortableContext items={items.map(item => item.id)} strategy={verticalListSortingStrategy}>
          {items.map((item, index) => {
            const art = item.artworkId ? <AuthArtwork origin={origin} token={token} id={item.artworkId} video={item.kind !== "radio"} className="size-full rounded-none" /> : <MediaArtwork key={item.thumbnail || item.id} thumbnail={item.thumbnail} title={item.title} />;
            const meta = [item.subtitle, sourceLabel(item)].filter(Boolean).join(" · ");
            const collection = collectionTarget(item.collection);
            const play = <Button variant="ghost" disabled={!connected || !canPlay || pending} aria-label={`Play ${item.title}`} onClick={() => act(item, "play", index)}>Play</Button>;
            return <SortableRow key={item.id} id={item.id} label={`Reorder ${item.title}`}>{drag => <MediaDetails title={item.title} meta={meta} description={item.description} art={art} actions={<>
              {action.error && action.variables?.item.id === item.id && <SavedError message={action.error.message || "Couldn't use this item."} />}
              {play}
              {collection && onOpenProvider && <Button variant="ghost" aria-label={`Browse ${collection.title}`} onClick={() => onOpenProvider(collection, `Details ${item.title}`)}>Browse</Button>}
            </>}>{inspect => <MediaRow ref={drag.setNodeRef} style={drag.style}
              art={<Button variant="ghost" className="h-auto p-0 touch:h-auto" aria-label={`Artwork details for ${item.title}`} onClick={inspect}>{art}</Button>}
              artFit="contain"
              title={item.title}
              meta={meta}
              description={item.description}
              primary={{ label: "Details", onClick: inspect }}
              actions={<>
                {play}
                <Button variant="ghost" disabled={!connected || pending} aria-label={`Queue ${item.title}`} onClick={() => act(item, "append", index)}>Queue</Button>
                <Button variant="ghost" disabled={!connected || pending} aria-label={`Remove ${item.title}`} onClick={() => act(item, "remove", index)}>Remove</Button>
                {drag.handle}
              </>}>
              {(item.duration != null || item.live) && <DurationBar duration={item.duration} live={item.live} />}
            </MediaRow>}</MediaDetails>}</SortableRow>;
          })}
        </SortableContext>
      </MediaList>}
    </DndContext>
  </section>;
}
