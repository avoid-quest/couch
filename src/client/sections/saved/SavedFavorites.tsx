import { mediaSubtitle } from "@/components/MediaContext";
import { browserActions } from "@/original-page";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ProviderItem } from "../../../shared/providers";
import { stationSources, type RadioStation } from "../../../shared/radio";
import { MediaArtwork } from "@/components/MediaArtwork";
import { DurationBar } from "@/components/DurationBar";
import { MediaList, MediaRow } from "@/components/MediaRow";
import { majorityShape, providerItemShape, type ArtShape } from "@/art-shape";
import { usePlayOn } from "@/components/PlayOn";
import { applyIdOrder, reorderedIds } from "@/lib/dnd";
import { useOptionalSessionGate } from "@/session/session-context";
import { itemLocation, useDetailNavigation } from "@/detail-navigation";
import type { Credentials } from "../../session/session";
import { providerFavoritesQuery } from "@/api/providers";
import { radioFavoritesListQuery } from "@/api/radio";
import { apiSend } from "@/api/client";
import { SavedEmpty, SavedError, SavedStatus, useRemovalFocus } from "./SavedStatus";
import { savedNotice } from "@/copy";
import { collectionSubtitle, metaLine } from "@/media-caption";
import { collectionLabel, providerNames } from "@/sections/find/SearchOnlineResults";

export type SavedFavoriteActions = {
  onEnqueueProvider: (item: ProviderItem, playNow: boolean, deviceId?: string) => Promise<boolean>;
  onEnqueueRadio: (station: RadioStation, playNow: boolean, deviceId?: string) => Promise<boolean>;
  onOpenProvider: (item: ProviderItem) => void;
};
type Favorite = { kind: "provider"; item: ProviderItem } | { kind: "radio"; item: RadioStation };
const title = (favorite: Favorite) => favorite.kind === "provider" ? favorite.item.title : favorite.item.name;
const shapeOf = (favorite: Favorite): ArtShape => favorite.kind === "radio" ? "square" : providerItemShape(providerNames[favorite.item.provider], favorite.item);
const key = (favorite: Favorite) => `${favorite.kind}:${favorite.item.id}`;
const store = (kind: Favorite["kind"]) => kind === "provider" ? "providers" : "radio";
const meta = (favorite: Favorite) => {
  if (favorite.kind === "radio") return metaLine("Radio", favorite.item.groupTitle || favorite.item.countryCode);
  const type = collectionLabel(favorite.item);
  return metaLine(providerNames[favorite.item.provider], type, collectionSubtitle(favorite.item.subtitle === favorite.item.title ? undefined : mediaSubtitle(favorite.item), type, providerNames[favorite.item.provider]));
};

// Favorites live in the provider and radio stores, so Move up and Move down move a favorite within its own kind.
export function moveFavorite(favorites: Favorite[], favorite: Favorite, offset: number): { kind: Favorite["kind"]; order: string[] } | null {
  const group = favorites.filter(item => item.kind === favorite.kind);
  const next = reorderedIds(group, item => item.item.id, favorite.item.id, group[group.indexOf(favorite) + offset]?.item.id ?? "");
  return next && { kind: favorite.kind, order: next.map(item => item.item.id) };
}

export function SavedFavorites({ origin, token, connected, canPlay, onEnqueueProvider, onEnqueueRadio, onOpenProvider, onFind }: Credentials & SavedFavoriteActions & {
  connected: boolean; canPlay: boolean; onFind?: () => void;
}) {
  // The session invalidates ["providers"] and ["radio"] whenever any remote
  // changes favorites. Enqueue and play stay on the WebSocket session.
  const session = useOptionalSessionGate();
  const details = useDetailNavigation();
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
  // favorites first, then stations. A pending move renders its order.
  const order = (kind: Favorite["kind"]) => reorder.isPending && reorder.variables.kind === kind ? reorder.variables.order : undefined;
  const favorites = connected ? [
    ...applyIdOrder(online.data?.favorites ?? [], order("provider"), item => item.id).map((item: ProviderItem): Favorite => ({ kind: "provider", item })),
    ...applyIdOrder(radio.data?.favorites ?? [], order("radio"), item => item.id).map((item: RadioStation): Favorite => ({ kind: "radio", item })),
  ] : [];
  // The list takes its majority shape (art-shape.ts); an item of another shape is contained in it.
  const shape = majorityShape(favorites.map(shapeOf));
  const loadError = connected ? [online.error, radio.error].filter(error => error !== null).map(error => error.message).join(" ") : "";
  const failure = remove.error ? remove.error.message || "Couldn't remove this." : reorder.error ? reorder.error.message || "Couldn't save the order." : "";
  // Play and Queue run on the session, which reports its own errors.
  const [enqueueing, setEnqueueing] = useState(false);
  const pending = enqueueing || remove.isPending;
  const list = useRef<HTMLUListElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const section = useRef<HTMLElement>(null);
  const removing = useRemovalFocus(favorites.map(key), !pending, list, () => section.current?.querySelector<HTMLElement>("button:not(:disabled)") ?? heading.current);
  const { play } = usePlayOn();
  const enqueue = async (favorite: Favorite, playNow: boolean, deviceId?: string) => {
    if (!connected || pending) return;
    setEnqueueing(true);
    try {
      const work = (on?: string) => favorite.kind === "provider" ? onEnqueueProvider(favorite.item, playNow, on) : onEnqueueRadio(favorite.item, playNow, on);
      await (playNow ? play(work, deviceId) : work());
    } finally { setEnqueueing(false); }
  };

  const row = (favorite: Favorite, index: number) => {
    const itemTitle = title(favorite);
    const browse = favorite.kind === "provider" && favorite.item.kind !== "media";
    const blocked = !connected || pending || reorder.isPending;
    const move = (offset: number) => { const plan = moveFavorite(favorites, favorite, offset); if (plan && !blocked) reorder.mutate(plan); };
    // A station's page holds no Remove or ordering, so the row keeps its "…", which opens its Details too.
    return <MediaRow related={favorite.kind === "provider" ? { creator: favorite.item.creator, collection: favorite.item.collection } : undefined} key={key(favorite)}
      source={favorite.kind === "provider" ? favorite.item.url : stationSources(favorite.item)}
      artFit="contain" shape={shape} own={shapeOf(favorite)}
      art={<MediaArtwork key={(favorite.kind === "provider" ? favorite.item.thumbnail : favorite.item.logoUrl) || favorite.item.id} thumbnail={favorite.kind === "provider" ? favorite.item.thumbnail : favorite.item.logoUrl} title={itemTitle} collection={favorite.kind === "provider" && favorite.item.kind !== "media"} />}
      title={itemTitle}
      meta={meta(favorite)}
      primary={browse
        ? { label: "Open", onClick: () => onOpenProvider(favorite.item as ProviderItem), disabled: !connected || pending }
        : { label: "Play", onClick: () => void enqueue(favorite, true), disabled: !connected || !canPlay || pending }}
      menu={[
        ...(favorite.kind === "radio" ? [{ label: "Details", run: () => details.open(itemLocation("radio", favorite.item.id)) }] : []),
        ...(browse ? [{ label: "Play", disabled: !connected || !canPlay || pending, run: () => void enqueue(favorite, true) }] : []),
        { label: "Play on", disabled: !connected || !canPlay || pending, playOn: deviceId => void enqueue(favorite, true, deviceId) },
        { label: "Queue", disabled: !connected || pending, run: () => void enqueue(favorite, false) },
        ...browserActions(favorite.kind === "provider" ? favorite.item.url : favorite.item.homepage),
        { label: "Move up", disabled: blocked || favorites[index - 1]?.kind !== favorite.kind, run: () => move(-1) },
        { label: "Move down", disabled: blocked || favorites[index + 1]?.kind !== favorite.kind, run: () => move(1) },
        { label: "Remove", disabled: !connected || pending, run: () => { if (!connected || pending) return; removing(key(favorite), index); remove.mutate(favorite); } },
      ]}>
      {favorite.kind === "provider" && favorite.item.kind === "media" && favorite.item.duration != null && <DurationBar duration={favorite.item.duration} live={favorite.item.live} />}
    </MediaRow>;
  };

  return <section ref={section} aria-labelledby="saved-favorites-heading">
    <h2 ref={heading} id="saved-favorites-heading" tabIndex={-1} className="sr-only">Channels &amp; stations</h2>
    <SavedStatus connected={connected} loading={loading} />
    {loadError && <SavedError message={loadError} onRetry={() => { void online.refetch(); void radio.refetch(); }} />}
    {connected && failure && <SavedError message={failure} />}
    {connected && !loading && !loadError && !favorites.length && <SavedEmpty title="No saved channels or stations" action={onFind && <Button onClick={onFind}>Search</Button>}>Choose Save on a channel, collection or radio station to find it here.</SavedEmpty>}
    {!!favorites.length && <MediaList ref={list} aria-label="Channels & stations">{favorites.map(row)}</MediaList>}
  </section>;
}
