import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { MediaArtwork } from "@/components/MediaArtwork";
import { DurationBar } from "@/components/DurationBar";
import { itemLocation, useDetailNavigation } from "@/detail-navigation";
import { savedSourceLabel } from "@/saved-source";
import { MediaList, MediaRow } from "@/components/MediaRow";
import { playOnQuery, usePlayOn } from "@/components/PlayOn";
import { BrowseActions } from "@/sections/find/SearchPanel";
import { applyIdOrder, reorderedIds, SortableRow, useDndSensors } from "@/lib/dnd";
import { useOptionalSessionGate } from "@/session/session-context";
import type { ForLaterItem } from "../../../shared/for-later";
import { forLaterQuery } from "@/api/for-later";
import { apiSend } from "@/api/client";
import { SavedEmpty, SavedError, SavedStatus, useRemovalFocus } from "./SavedStatus";
import { savedNotice } from "@/copy";

// The gesture for one drop, as the ordered ids the server persists.
export function forLaterOrder(items: ForLaterItem[], activeId: string, overId: string): string[] | null {
  const next = reorderedIds(items, item => item.id, activeId, overId);
  return next && next.map(item => item.id);
}

type Mode = "play" | "append" | "remove";

export function ForLaterSection({ origin, token, connected, canPlay, onFind, showHeading = true, mediaOnly = false, limit }: {
  origin: string; token: string; connected: boolean; canPlay: boolean;
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
      const send = (on?: string) => apiSend<{ notice?: string; undoToken?: string } | undefined>(credentials, mode === "remove" ? path : `${path}/load${playOnQuery(on)}`, mode === "remove" ? undefined : { mode }, mode === "remove" ? "DELETE" : "POST", 30_000);
      return mode === "play" ? play(send, deviceId) : mode === "append" && session ? session.queue(item.title, send) : send();
    },
    onSuccess: async (body, { item, mode }) => {
      if (mode !== "remove") {
        if (body && body.notice) toast(body.notice);
        return;
      }
      const text = savedNotice(item.title, false);
      const undoToken = body && body.undoToken;
      if (undoToken && session) session.offerUndo(text, async () => {
        await apiSend(credentials, "/api/for-later/restore", { token: undoToken }, "POST", 10_000);
        await refresh();
      });
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
  const act = (item: ForLaterItem, mode: Mode, index: number, deviceId?: string) => {
    if (!connected || pending) return;
    if (mode === "remove") removing(item.id, index);
    action.mutate({ item, mode, deviceId });
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
            const art = <MediaArtwork key={item.thumbnail || item.id} thumbnail={item.thumbnail} title={item.title} />;
            const meta = [item.subtitle, savedSourceLabel(item)].filter(Boolean).join(" · ");
            const inspect = () => details.open(itemLocation("saved", item.id));
            return <SortableRow key={item.id} id={item.id} label={`Reorder ${item.title}`}>{drag => <MediaRow data-saved-details={item.id} ref={drag.setNodeRef} style={drag.style}
              art={<Button variant="ghost" className="h-auto p-0" aria-label={`Artwork details for ${item.title}`} onClick={inspect}>{art}</Button>}
              artFit="contain"
              title={item.title}
              meta={meta}
              description={item.description}
              primary={{ label: "Details", onClick: inspect }}
              actions={<>
                <BrowseActions title={item.title} actions={[
                  { label: "Play", disabled: !connected || !canPlay || pending, run: () => act(item, "play", index) },
                  { label: "Play on", disabled: !connected || !canPlay || pending, playOn: deviceId => act(item, "play", index, deviceId) },
                  { label: "Queue", disabled: !connected || pending, run: () => act(item, "append", index) },
                  { label: "Remove", disabled: !connected || pending, run: () => act(item, "remove", index) },
                ]} />
                {drag.handle}
              </>}>
              {(item.duration != null || item.live) && <DurationBar duration={item.duration} live={item.live} />}
            </MediaRow>}</SortableRow>;
          })}
        </SortableContext>
      </MediaList>}
    </DndContext>
  </section>;
}
