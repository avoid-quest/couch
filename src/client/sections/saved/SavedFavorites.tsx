import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useRef, useState } from "react";
import { ArrowUpRight, Play, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Item } from "@/components/ui/item";
import type { ProviderItem } from "../../../shared/providers";
import type { RadioStation } from "../../../shared/radio";
import { MediaArtwork } from "@/components/MediaArtwork";
import { DurationBar } from "@/components/DurationBar";
import { applyIdOrder, reorderedIds, SortableRow, useDndSensors, type RowDrag } from "@/lib/dnd";
import type { Credentials } from "../../session/session";
import { providerFavoritesQuery } from "@/api/providers";
import { radioFavoritesListQuery } from "@/api/radio";
import { apiSend } from "@/api/client";

export type SavedFavoriteActions = {
  onEnqueueProvider: (item: ProviderItem, playNow: boolean) => Promise<boolean>;
  onEnqueueRadio: (station: RadioStation, playNow: boolean) => Promise<boolean>;
  onOpenProvider: (item: ProviderItem) => void;
};
type Favorite = { kind: "provider"; item: ProviderItem } | { kind: "radio"; item: RadioStation };
const providers = { youtube: "YouTube", raiplay: "RaiPlay", twitch: "Twitch", bandcamp: "Bandcamp", streamingcommunity: "StreamingCommunity" };
const title = (favorite: Favorite) => favorite.kind === "provider" ? favorite.item.title : favorite.item.name;
const key = (favorite: Favorite) => `${favorite.kind}:${favorite.item.id}`;
const message = (reason: unknown) => reason instanceof Error ? reason.message : "Could not use this saved item.";

// The gesture for one drop, per kind: favorites live in the provider and radio
// stores, so a drop reorders its own kind and a cross-kind drop does nothing.
export function reorderFavorites(favorites: Favorite[], kind: Favorite["kind"], activeId: string, overId: string): { kind: Favorite["kind"]; order: string[] } | null {
  const next = reorderedIds(favorites.filter(favorite => favorite.kind === kind), favorite => favorite.item.id, activeId, overId);
  return next && { kind, order: next.map(favorite => favorite.item.id) };
}

export function SavedFavorites({ origin, token, connected, canPlay, onEnqueueProvider, onEnqueueRadio, onOpenProvider, showHeading = true }: Credentials & SavedFavoriteActions & {
  connected: boolean; canPlay: boolean; showHeading?: boolean;
}) {
  // The session invalidates ["providers"] and ["radio"] whenever any remote
  // changes favorites. Enqueue and play stay on the WebSocket session.
  const queryClient = useQueryClient();
  const credentials = { origin, token };
  const online = useQuery({ ...providerFavoritesQuery(credentials), enabled: connected });
  const radio = useQuery({ ...radioFavoritesListQuery(credentials), enabled: connected });
  const loading = connected && (online.isPending || radio.isPending);
  const store = (kind: Favorite["kind"]) => kind === "provider" ? "providers" : "radio";
  const favoritesKey = (kind: Favorite["kind"]) => kind === "provider" ? providerFavoritesQuery(credentials).queryKey : radioFavoritesListQuery(credentials).queryKey;
  const reorder = useMutation({
    mutationFn: ({ kind, order }: { kind: Favorite["kind"]; order: string[] }) => apiSend(credentials, `/api/${store(kind)}/favorites/reorder`, { order }, "POST", 10_000),
    onSettled: (_, __, { kind }) => queryClient.invalidateQueries({ queryKey: favoritesKey(kind) }),
  });
  const remove = useMutation({
    mutationFn: (favorite: Favorite) => apiSend(credentials, `/api/${store(favorite.kind)}/favorites/${encodeURIComponent(favorite.item.id)}`, undefined, "DELETE"),
    onSuccess: (_, favorite) => queryClient.invalidateQueries({ queryKey: favoritesKey(favorite.kind) }),
  });
  // Each store keeps its own persisted order; the merged list shows online
  // favorites first, then stations. A pending drop renders its order.
  const order = (kind: Favorite["kind"]) => reorder.isPending && reorder.variables.kind === kind ? reorder.variables.order : undefined;
  const favorites = connected ? [
    ...applyIdOrder(online.data?.favorites ?? [], order("provider"), item => item.id).map((item: ProviderItem): Favorite => ({ kind: "provider", item })),
    ...applyIdOrder(radio.data?.favorites ?? [], order("radio"), item => item.id).map((item: RadioStation): Favorite => ({ kind: "radio", item })),
  ] : [];
  const error = connected ? [online.error, radio.error].filter(Boolean).map(message).join(" ") : "";
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const list = useRef<HTMLUListElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const sensors = useDndSensors();
  const refresh = () => { void online.refetch(); void radio.refetch(); };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return;
    const favorite = favorites.find(item => item.item.id === active.id);
    const plan = favorite && reorderFavorites(favorites, favorite.kind, String(active.id), String(over.id));
    if (plan) reorder.mutate(plan);
  };

  const update = async (favorite: Favorite, action: "play" | "append" | "remove") => {
    if (!connected || pending) return;
    setPending(true); setActionError(""); setNotice("");
    try {
      if (action === "remove") {
        const index = favorites.findIndex(item => key(item) === key(favorite));
        await remove.mutateAsync(favorite);
        setNotice(`Removed ${title(favorite)} from Saved.`);
        requestAnimationFrame(() => {
          const rows = list.current?.children;
          (rows?.[Math.min(index, rows.length - 1)]?.querySelector<HTMLButtonElement>("button:not(:disabled)") ?? heading.current)?.focus();
        });
      } else {
        const ok = await (favorite.kind === "provider" ? onEnqueueProvider(favorite.item, action === "play") : onEnqueueRadio(favorite.item, action === "play"));
        if (ok) setNotice(action === "play" ? `Starting ${title(favorite)} on the TV.` : `Added ${title(favorite)} to Up next.`);
      }
    } catch (reason) { setActionError(message(reason)); }
    finally { setPending(false); }
  };
  return <section className="space-y-3" aria-labelledby="saved-favorites-heading">
    <h2 ref={heading} id="saved-favorites-heading" tabIndex={-1} className={showHeading ? "text-xl font-semibold" : "sr-only"}>{showHeading ? "Online and radio" : "Channels and stations"}</h2>
    {!connected && <p role="status">Reconnect to see saved online items and stations.</p>}
    {loading && <p role="status">Loading saved items…</p>}
    {error && <div role="alert"><p>{error}</p><Button variant="outline" disabled={!connected || loading || pending} onClick={refresh}>Retry saved items</Button></div>}
    {(actionError || reorder.error) && <p role="alert">{actionError || message(reorder.error)}</p>}
    {notice && <p role="status">{notice}</p>}
    {connected && !loading && !error && !favorites.length && <p className="text-sm text-muted-foreground">{showHeading ? "No favorites yet." : "Save a channel, playlist or station to find it here."}</p>}
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
    <ul ref={list} className="saved-favorites grid list-none gap-2 p-0" aria-label="Saved online items and stations" aria-busy={loading}>
      <SortableContext items={favorites.filter(favorite => favorite.kind === "provider").map(favorite => favorite.item.id)} strategy={verticalListSortingStrategy}>
        {favorites.filter(favorite => favorite.kind === "provider").map(favorite => <SortableRow key={key(favorite)} id={favorite.item.id} label={`Reorder ${title(favorite)}`} editing>{(drag: RowDrag) => row(favorite, drag)}</SortableRow>)}
      </SortableContext>
      <SortableContext items={favorites.filter(favorite => favorite.kind === "radio").map(favorite => favorite.item.id)} strategy={verticalListSortingStrategy}>
        {favorites.filter(favorite => favorite.kind === "radio").map(favorite => <SortableRow key={key(favorite)} id={favorite.item.id} label={`Reorder ${title(favorite)}`} editing>{(drag: RowDrag) => row(favorite, drag)}</SortableRow>)}
      </SortableContext>
    </ul>
    </DndContext>
  </section>;

  function row(favorite: Favorite, drag?: RowDrag) {
    const itemTitle = title(favorite);
    const browse = favorite.kind === "provider" && favorite.item.kind !== "media";
    const detail = favorite.kind === "provider" ? [providers[favorite.item.provider], favorite.item.kind === "media" ? favorite.item.live ? "Live" : favorite.item.provider === "bandcamp" ? "Track" : favorite.item.provider === "streamingcommunity" ? "Title" : "Video" : favorite.item.kind === "channel" ? "Channel" : "Collection", favorite.item.subtitle].filter(Boolean).join(" · ") : ["Radio", favorite.item.groupTitle || favorite.item.countryCode].filter(Boolean).join(" · ");
    if (!showHeading) return <Item asChild><li data-nav-row ref={drag?.setNodeRef} style={drag?.style} className="saved-favorite-row">
      <MediaArtwork key={(favorite.kind === "provider" ? favorite.item.thumbnail : favorite.item.logoUrl) || favorite.item.id} thumbnail={favorite.kind === "provider" ? favorite.item.thumbnail : favorite.item.logoUrl} title={itemTitle} className="saved-favorite-art" />
      <Button variant="ghost" className="saved-favorite-main" disabled={!connected || pending || !browse && !canPlay} aria-label={`${browse ? "Open" : "Play"} ${itemTitle}`} onClick={() => browse ? onOpenProvider(favorite.item as ProviderItem) : void update(favorite, "play")}>
        <span className="saved-favorite-title-line"><strong>{itemTitle}</strong><small>{favorite.kind === "provider" ? [favorite.item.subtitle, providers[favorite.item.provider]].filter(Boolean).join(", ") : [favorite.item.groupTitle, "Radio"].filter(Boolean).join(", ")}</small></span>
        {favorite.kind === "provider" ? favorite.item.kind === "media" ? (favorite.item.duration != null || favorite.item.live) && <DurationBar duration={favorite.item.duration} live={favorite.item.live} /> : <small className="saved-favorite-kind">{favorite.item.kind === "channel" ? "Channel" : "Collection"}</small> : <small className="saved-favorite-kind">Live</small>}
      </Button>
      <div className="saved-favorite-actions">
        {browse && <Button variant="ghost" disabled={!connected || !canPlay || pending} aria-label={`Play ${itemTitle}`} onClick={() => void update(favorite, "play")}>Play</Button>}
        <Button variant="ghost" disabled={!connected || pending} aria-label={`Add ${itemTitle} to Up next`} onClick={() => void update(favorite, "append")}>Queue</Button>
        <Button variant="ghost" disabled={!connected || pending} aria-label={`Remove ${itemTitle} from Saved`} onClick={() => void update(favorite, "remove")}>Remove</Button>
      </div>
      <span className="saved-favorite-drag">{drag?.handle}</span>
    </li></Item>;
    return <Item asChild><li data-nav-row ref={drag?.setNodeRef} style={drag?.style} className="flex flex-wrap items-center gap-3 border-b py-3">
        <MediaArtwork key={(favorite.kind === "provider" ? favorite.item.thumbnail : favorite.item.logoUrl) || favorite.item.id} thumbnail={favorite.kind === "provider" ? favorite.item.thumbnail : favorite.item.logoUrl} title={itemTitle} className="saved-media-art h-[54px] w-[46px] rounded-md" />
        <div className="grid min-w-[100px] flex-1 gap-1.5 [overflow-wrap:anywhere]"><strong className="text-sm font-semibold">{itemTitle}</strong><small className="text-xs text-muted-foreground">{detail}</small></div>
        <div className={`${showHeading ? "" : "saved-media-actions "}flex min-h-11 flex-wrap gap-2`}>
          {favorite.kind === "provider" ? <>
            <Button className="min-h-11" disabled={!connected || !canPlay || pending} aria-label={`Play ${itemTitle}`} onClick={() => void update(favorite, "play")}><Play aria-hidden="true" />Play</Button>
            <Button className="min-h-11" variant="outline" disabled={!connected || pending} aria-label={`Add ${itemTitle} to Up next`} onClick={() => void update(favorite, "append")}><Plus aria-hidden="true" />Up next</Button>
            {browse && <Button className="min-h-11" disabled={!connected || pending} aria-label={`Open ${itemTitle}`} onClick={() => onOpenProvider(favorite.item)}><ArrowUpRight aria-hidden="true" />Open</Button>}
          </> : <>
            <Button className="min-h-11" disabled={!connected || !canPlay || pending} aria-label={`Play ${itemTitle}`} onClick={() => void update(favorite, "play")}><Play aria-hidden="true" />Play</Button>
            <Button className="min-h-11" variant="outline" disabled={!connected || pending} aria-label={`Add ${itemTitle} to Up next`} onClick={() => void update(favorite, "append")}><Plus aria-hidden="true" />Up next</Button>
          </>}
          <Button className="min-h-11" variant="ghost" disabled={!connected || pending} aria-label={`Remove ${itemTitle} from Saved`} onClick={() => void update(favorite, "remove")}><X aria-hidden="true" />Remove</Button>
        </div>
        {drag?.handle}
      </li></Item>;
  }
}
