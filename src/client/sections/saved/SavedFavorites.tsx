import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Play, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ProviderItem } from "../../../shared/providers";
import type { RadioStation } from "../../../shared/radio";
import { MediaArtwork } from "@/components/MediaArtwork";
import { applyIdOrder, reorderedIds, SortableRow, useDndSensors, type RowDrag } from "@/lib/dnd";
import type { Credentials } from "../../session/session";
import { providerFavoritesQuery } from "@/api/providers";
import { radioFavoritesListQuery } from "@/api/radio";

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

export function SavedFavorites({ origin, token, connected, canPlay, onEnqueueProvider, onEnqueueRadio, onOpenProvider }: Credentials & SavedFavoriteActions & {
  connected: boolean; canPlay: boolean;
}) {
  // Saved reads go through Query: the session invalidates ["providers"] and
  // ["radio"] on socket revisions, replacing the version props this panel
  // used to receive. Enqueue and play stay on the WebSocket session.
  const queryClient = useQueryClient();
  const online = useQuery({ ...providerFavoritesQuery({ origin, token }), enabled: connected });
  const radio = useQuery({ ...radioFavoritesListQuery({ origin, token }), enabled: connected });
  const loading = connected && (online.isPending || radio.isPending);
  // Each store keeps its own persisted order; the merged list shows online
  // favorites first, then stations. A drop updates its store optimistically.
  const [savedOrder, setSavedOrder] = useState<{ provider?: string[]; radio?: string[] }>({});
  const favorites = connected ? [
    ...applyIdOrder(online.data?.favorites ?? [], savedOrder.provider, item => item.id).map((item: ProviderItem): Favorite => ({ kind: "provider", item })),
    ...applyIdOrder(radio.data?.favorites ?? [], savedOrder.radio, item => item.id).map((item: RadioStation): Favorite => ({ kind: "radio", item })),
  ] : [];
  const error = connected ? [online.error, radio.error].filter(Boolean).map(message).join(" ") : "";
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const mutation = useRef<AbortController | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const sensors = useDndSensors();
  useEffect(() => { setNotice(""); setActionError(""); setPending(false); setSavedOrder({}); return () => mutation.current?.abort(); }, [origin, token, connected]);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["providers", "favorites"] });
    void queryClient.invalidateQueries({ queryKey: ["radio", "favorites"] });
  };
  const saveOrder = async (plan: { kind: Favorite["kind"]; order: string[] }) => {
    setSavedOrder(previous => ({ ...previous, [plan.kind]: plan.order }));
    try {
      const response = await fetch(`${origin}/api/${plan.kind === "provider" ? "providers" : "radio"}/favorites/reorder`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ order: plan.order }), signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(((await response.json()) as { error?: string }).error || "Could not save the new order.");
      await queryClient.invalidateQueries({ queryKey: plan.kind === "provider" ? ["providers", "favorites"] : ["radio", "favorites"] });
    } catch (reason) { setActionError(message(reason)); }
    finally { setSavedOrder(({ [plan.kind]: _dropped, ...rest }) => rest); }
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return;
    const favorite = favorites.find(item => item.item.id === active.id);
    const plan = favorite && reorderFavorites(favorites, favorite.kind, String(active.id), String(over.id));
    if (plan) void saveOrder(plan);
  };

  const update = async (favorite: Favorite, action: "play" | "append" | "remove") => {
    if (!connected || mutation.current) return;
    const controller = new AbortController();
    mutation.current = controller;
    setPending(true); setActionError(""); setNotice("");
    try {
      if (action === "remove") {
        const response = await fetch(`${origin}/api/${favorite.kind === "provider" ? "providers" : "radio"}/favorites/${encodeURIComponent(favorite.item.id)}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
        if (!response.ok) { const body = await response.json(); throw new Error(body.error || "Could not remove this saved item."); }
        if (controller.signal.aborted) return;
        const index = favorites.findIndex(item => key(item) === key(favorite));
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["providers", "favorites"] }),
          queryClient.invalidateQueries({ queryKey: ["radio", "favorites"] }),
        ]);
        setNotice(`Removed ${title(favorite)} from Saved.`);
        requestAnimationFrame(() => {
          const rows = list.current?.children;
          (rows?.[Math.min(index, rows.length - 1)]?.querySelector<HTMLButtonElement>("button:not(:disabled)") ?? heading.current)?.focus();
        });
      } else {
        const ok = await (favorite.kind === "provider" ? onEnqueueProvider(favorite.item, action === "play") : onEnqueueRadio(favorite.item, action === "play"));
        if (!controller.signal.aborted && ok) setNotice(action === "play" ? `Starting ${title(favorite)} on the TV.` : `Added ${title(favorite)} to Up next.`);
      }
    } catch (reason) { if (!controller.signal.aborted) setActionError(message(reason)); }
    finally { if (!controller.signal.aborted) setPending(false); if (mutation.current === controller) mutation.current = null; }
  };
  return <section className="space-y-3" aria-labelledby="saved-favorites-heading">
    <h2 ref={heading} id="saved-favorites-heading" tabIndex={-1} className="text-xl font-semibold">Online and radio</h2>
    {!connected && <p role="status">Reconnect to see saved online items and stations.</p>}
    {loading && <p role="status">Loading saved items…</p>}
    {error && <div role="alert"><p>{error}</p><Button variant="outline" disabled={!connected || loading || pending} onClick={refresh}>Retry saved items</Button></div>}
    {actionError && <p role="alert">{actionError}</p>}
    {notice && <p role="status">{notice}</p>}
    {connected && !loading && !error && !favorites.length && <p className="text-sm text-muted-foreground">No favorites yet.</p>}
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
      return <li ref={drag?.setNodeRef} style={drag?.style} className="flex flex-wrap items-center gap-3 border-b py-3">
        <MediaArtwork key={(favorite.kind === "provider" ? favorite.item.thumbnail : favorite.item.logoUrl) || favorite.item.id} thumbnail={favorite.kind === "provider" ? favorite.item.thumbnail : favorite.item.logoUrl} title={itemTitle} className="h-[54px] w-[46px] rounded-md" />
        <div className="grid min-w-[100px] flex-1 gap-1.5 [overflow-wrap:anywhere]"><strong className="text-sm font-semibold">{itemTitle}</strong><small className="text-xs text-muted-foreground">{detail}</small></div>
        <div className="flex min-h-11 flex-wrap gap-2">
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
      </li>;
  }
}
