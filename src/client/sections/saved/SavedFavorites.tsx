import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ProviderItem } from "../../../shared/providers";
import type { RadioStation } from "../../../shared/radio";
import { MediaArtwork } from "@/components/MediaArtwork";
import { DurationBar } from "@/components/DurationBar";
import { MediaList, MediaRow } from "@/components/MediaRow";
import { usePlayOn } from "@/components/PlayOn";
import { BrowseActions } from "@/sections/find/SearchPanel";
import { applyIdOrder, reorderedIds, SortableRow, useDndSensors } from "@/lib/dnd";
import { useOptionalSessionGate } from "@/session/session-context";
import type { Credentials } from "../../session/session";
import { providerFavoritesQuery } from "@/api/providers";
import { radioFavoritesListQuery } from "@/api/radio";
import { apiSend } from "@/api/client";
import { SavedEmpty, SavedError, SavedStatus, useRemovalFocus } from "./SavedStatus";
import { savedNotice } from "@/copy";

export type SavedFavoriteActions = {
  onEnqueueProvider: (item: ProviderItem, playNow: boolean) => Promise<boolean>;
  onEnqueueRadio: (station: RadioStation, playNow: boolean) => Promise<boolean>;
  onOpenProvider: (item: ProviderItem) => void;
};
type Favorite = { kind: "provider"; item: ProviderItem } | { kind: "radio"; item: RadioStation };
const providers = { youtube: "YouTube", raiplay: "RaiPlay", twitch: "Twitch", bandcamp: "Bandcamp", streamingcommunity: "StreamingCommunity" };
const title = (favorite: Favorite) => favorite.kind === "provider" ? favorite.item.title : favorite.item.name;
const key = (favorite: Favorite) => `${favorite.kind}:${favorite.item.id}`;
const store = (kind: Favorite["kind"]) => kind === "provider" ? "providers" : "radio";
const meta = (favorite: Favorite) => (favorite.kind === "provider"
  ? [providers[favorite.item.provider], favorite.item.kind === "channel" ? "Channel" : favorite.item.kind === "collection" ? favorite.item.provider === "bandcamp" ? "Album" : "Playlist" : "", favorite.item.subtitle]
  : ["Radio", favorite.item.groupTitle || favorite.item.countryCode]).filter(Boolean).join(" · ");

// The gesture for one drop, per kind: favorites live in the provider and radio
// stores, so a drop reorders its own kind and a cross-kind drop does nothing.
export function reorderFavorites(favorites: Favorite[], kind: Favorite["kind"], activeId: string, overId: string): { kind: Favorite["kind"]; order: string[] } | null {
  const next = reorderedIds(favorites.filter(favorite => favorite.kind === kind), favorite => favorite.item.id, activeId, overId);
  return next && { kind, order: next.map(favorite => favorite.item.id) };
}

export function SavedFavorites({ origin, token, connected, canPlay, onEnqueueProvider, onEnqueueRadio, onOpenProvider, onFind }: Credentials & SavedFavoriteActions & {
  connected: boolean; canPlay: boolean; onFind?: () => void;
}) {
  // The session invalidates ["providers"] and ["radio"] whenever any remote
  // changes favorites. Enqueue and play stay on the WebSocket session.
  const session = useOptionalSessionGate();
  const queryClient = useQueryClient();
  const credentials = { origin, token };
  const online = useQuery({ ...providerFavoritesQuery(credentials), enabled: connected });
  const radio = useQuery({ ...radioFavoritesListQuery(credentials), enabled: connected });
  const loading = connected && (online.isPending || radio.isPending);
  const favoritesKey = (kind: Favorite["kind"]) => kind === "provider" ? providerFavoritesQuery(credentials).queryKey : radioFavoritesListQuery(credentials).queryKey;
  const saveOrder = (kind: Favorite["kind"], order: string[]) => apiSend(credentials, `/api/${store(kind)}/favorites/reorder`, { order }, "POST", 10_000);
  const reorder = useMutation({
    mutationFn: ({ kind, order }: { kind: Favorite["kind"]; order: string[] }) => saveOrder(kind, order),
    onSettled: (_, __, { kind }) => queryClient.invalidateQueries({ queryKey: favoritesKey(kind) }),
  });
  const remove = useMutation({
    mutationFn: (favorite: Favorite) => apiSend(credentials, `/api/${store(favorite.kind)}/favorites/${encodeURIComponent(favorite.item.id)}`, undefined, "DELETE"),
    onSuccess: async (_, favorite) => {
      // Undo saves the item again, then puts its store back in the old order.
      const order = favorites.filter(item => item.kind === favorite.kind).map(item => item.item.id);
      const text = savedNotice(title(favorite), false);
      if (session) session.offerUndo(text, async () => {
        await apiSend(credentials, `/api/${store(favorite.kind)}/favorites`, favorite.kind === "provider" ? { item: favorite.item } : { station: favorite.item });
        await saveOrder(favorite.kind, order);
        await queryClient.invalidateQueries({ queryKey: favoritesKey(favorite.kind) });
      });
      await queryClient.invalidateQueries({ queryKey: favoritesKey(favorite.kind) });
    },
  });
  // Each store keeps its own persisted order; the merged list shows online
  // favorites first, then stations. A pending drop renders its order.
  const order = (kind: Favorite["kind"]) => reorder.isPending && reorder.variables.kind === kind ? reorder.variables.order : undefined;
  const favorites = connected ? [
    ...applyIdOrder(online.data?.favorites ?? [], order("provider"), item => item.id).map((item: ProviderItem): Favorite => ({ kind: "provider", item })),
    ...applyIdOrder(radio.data?.favorites ?? [], order("radio"), item => item.id).map((item: RadioStation): Favorite => ({ kind: "radio", item })),
  ] : [];
  const loadError = connected ? [online.error, radio.error].filter(error => error !== null).map(error => error.message).join(" ") : "";
  const failure = remove.error ? remove.error.message || "Couldn't remove this." : reorder.error ? reorder.error.message || "Couldn't save the order." : "";
  // Play and Queue run on the session, which reports its own errors.
  const [enqueueing, setEnqueueing] = useState(false);
  const pending = enqueueing || remove.isPending;
  const list = useRef<HTMLUListElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const sensors = useDndSensors();
  const section = useRef<HTMLElement>(null);
  const removing = useRemovalFocus(favorites.map(key), !pending, list, () => section.current?.querySelector<HTMLElement>("button:not(:disabled)") ?? heading.current);
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const favorite = favorites.find(item => item.item.id === active.id);
    const plan = over && favorite && reorderFavorites(favorites, favorite.kind, String(active.id), String(over.id));
    if (plan) reorder.mutate(plan);
  };
  const { play } = usePlayOn();
  const enqueue = async (favorite: Favorite, playNow: boolean, deviceId?: string) => {
    if (!connected || pending) return;
    setEnqueueing(true);
    try {
      const work = () => favorite.kind === "provider" ? onEnqueueProvider(favorite.item, playNow) : onEnqueueRadio(favorite.item, playNow);
      await (playNow ? play(work, deviceId) : work());
    } finally { setEnqueueing(false); }
  };

  const row = (favorite: Favorite, index: number) => {
    const itemTitle = title(favorite);
    const browse = favorite.kind === "provider" && favorite.item.kind !== "media";
    return <SortableRow key={key(favorite)} id={favorite.item.id} label={`Reorder ${itemTitle}`}>{drag => <MediaRow ref={drag.setNodeRef} style={drag.style}
      art={<MediaArtwork key={(favorite.kind === "provider" ? favorite.item.thumbnail : favorite.item.logoUrl) || favorite.item.id} thumbnail={favorite.kind === "provider" ? favorite.item.thumbnail : favorite.item.logoUrl} title={itemTitle} collection={favorite.kind === "provider" && favorite.item.kind !== "media"} />}
      title={itemTitle}
      meta={meta(favorite)}
      primary={browse
        ? { label: "Open", onClick: () => onOpenProvider(favorite.item as ProviderItem), disabled: !connected || pending }
        : { label: "Play", onClick: () => void enqueue(favorite, true), disabled: !connected || !canPlay || pending }}
      actions={<>
        <BrowseActions title={itemTitle} actions={[
          { label: "Play", disabled: !connected || !canPlay || pending, run: () => void enqueue(favorite, true) },
          { label: "Play on", disabled: !connected || !canPlay || pending, playOn: deviceId => void enqueue(favorite, true, deviceId) },
          { label: "Queue", disabled: !connected || pending, run: () => void enqueue(favorite, false) },
          { label: "Remove", disabled: !connected || pending, run: () => { if (!connected || pending) return; removing(key(favorite), index); remove.mutate(favorite); } },
        ]} />
        {drag.handle}
      </>}>
      {favorite.kind === "radio" ? <DurationBar live /> : favorite.item.kind === "media" && (favorite.item.duration != null || favorite.item.live) && <DurationBar duration={favorite.item.duration} live={favorite.item.live} />}
    </MediaRow>}</SortableRow>;
  };
  const kinds = (["provider", "radio"] as const).map(kind => favorites.filter(favorite => favorite.kind === kind));

  return <section ref={section} aria-labelledby="saved-favorites-heading">
    <h2 ref={heading} id="saved-favorites-heading" tabIndex={-1} className="sr-only">Channels &amp; stations</h2>
    <SavedStatus connected={connected} loading={loading} />
    {loadError && <SavedError message={loadError} onRetry={() => { void online.refetch(); void radio.refetch(); }} />}
    {connected && failure && <SavedError message={failure} />}
    {connected && !loading && !loadError && !favorites.length && <SavedEmpty action={onFind && <Button variant="outline" onClick={onFind}>Find</Button>}>Nothing saved yet. Save a channel, playlist or station in Find.</SavedEmpty>}
    {!!favorites.length && <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <MediaList ref={list} aria-label="Channels & stations">
        {kinds.map((group, groupIndex) => <SortableContext key={groupIndex} items={group.map(favorite => favorite.item.id)} strategy={verticalListSortingStrategy}>
          {group.map(favorite => row(favorite, favorites.indexOf(favorite)))}
        </SortableContext>)}
      </MediaList>
    </DndContext>}
  </section>;
}
