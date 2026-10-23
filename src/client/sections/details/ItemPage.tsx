import { DetailSkeleton } from "@/components/LoadingMedia";
import { radioSearchQuery, radioFavoritesListQuery } from "@/api/radio";
import { MediaContext, mediaSubtitle } from "@/components/MediaContext";
import { browserActions, queuePageUrl } from "@/original-page";
import type { ComponentProps } from "react";
import { useRouter } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, apiJson, apiSend, type ApiCredentials } from "@/api/client";
import { forLaterQuery, loadForLater } from "@/api/for-later";
import { radioProgrammesQuery } from "@/api/radio";
import { useStationSave } from "@/sections/home/on-air";
import { removeFromContinue, undoProgressAction } from "@/api/progress";
import { DetailHeader } from "@/components/DetailHeader";
import { tileShape } from "@/components/MediaTile";
import { PageHeader } from "@/components/PageHeader";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { savedSourceLabel } from "@/saved-source";
import { ContentBreadcrumb } from "@/components/ContentBreadcrumb";
import { RelatedCollection } from "@/components/RelatedCollection";
import { RelatedRadio } from "@/components/RelatedRadio";
import { useSessionGate } from "@/session/session-context";
import { failed } from "@/toasts";
import { useShell } from "@/sections/shell/shell-context";
import type { ForLaterItem, ForLaterReference } from "../../../shared/for-later";
import type { HistoryItem } from "../../../shared/viewing";
import { avoidRadioPlaylistId, isRadio, type RadioStation } from "../../../shared/radio";
import type { PlaybackCollection } from "../../../shared/protocol";
import { providerForUrl } from "../../../shared/providers";
import { readFrom } from "../../../shared/page-paths";
import { sourceLabel } from "@/source-label";
import { usePlayOn } from "@/components/PlayOn";
import { useDetailNavigation, useOwnSearch } from "@/detail-navigation";
import { reorderedIds } from "@/lib/dnd";
import { deviceName, savedNotice } from "@/copy";

const kinds = ["history", "saved", "radio", "queue"] as const;
type Kind = typeof kinds[number];
type ItemDetails = { kind: "history"; item: HistoryItem } | { kind: "saved"; item: ForLaterItem } | { kind: "radio"; item: RadioStation };

export function readItemSearch(search: Record<string, unknown>): { kind?: Kind; id?: string; from?: string } {
  const kind = kinds.find(kind => kind === search.kind);
  const from = readFrom(search.from);
  return { ...kind && typeof search.id === "string" && search.id.trim() && search.id.length <= 2048 ? { kind, id: search.id } : {}, ...from ? { from } : {} };
}

async function readDetails(credentials: ApiCredentials, kind: Exclude<Kind, "queue">, id: string, signal: AbortSignal): Promise<ItemDetails> {
  const read = <T,>(path: string) => apiJson<T>(credentials, path, { signal });
  const encoded = encodeURIComponent(id);
  switch (kind) {
    case "history": return { kind, item: (await read<{ item: HistoryItem }>(`/api/progress/${encoded}`)).item };
    case "radio": return { kind, item: (await read<{ station: RadioStation }>(`/api/radio/stations/${encoded}`)).station };
    case "saved": {
      const item = (await read<{ items: ForLaterItem[] }>("/api/for-later")).items.find(item => item.id === id);
      if (!item) throw new ApiError("This item is no longer saved.", 404);
      return { kind, item };
    }
  }
}

export function ItemPage() {
  const { kind, id } = useOwnSearch(readItemSearch);
  return <section data-page="Item" className="min-w-0 space-y-6">
    {kind && id ? kind === "queue" ? <QueueDetails id={id} /> : <LoadedItem key={`${kind}:${id}`} kind={kind} id={id} /> : <ItemNotFound />}
  </section>;
}

/** An item or collection that is gone, or that its address doesn't name: its title, then the ways on, Search (the
 * header's field) and Back. */
export function ItemNotFound({ title = "Item not found" }: { title?: string }) {
  const { focusSearch, section, sectionUrl } = useShell();
  const { history } = useRouter();
  return <>
    <PageHeader breadcrumb={<ContentBreadcrumb />} title={title} className="mb-6" />
    <div data-nav-row className="flex flex-wrap gap-2">
      <Button data-page-first size="lg" onClick={focusSearch}>Search</Button>
      <Button variant="ghost" size="lg" onClick={() => history.canGoBack() ? history.back() : history.push(sectionUrl(section))}>Back</Button>
    </div>
  </>;
}

function LoadedItem({ kind, id }: { kind: Exclude<Kind, "queue">; id: string }) {
  const { credentials } = useShell();
  const { connected } = useSessionGate();
  const client = useQueryClient();
  const cached = kind === "saved" ? client.getQueryState<{ items: ForLaterItem[] }>(forLaterQuery(credentials).queryKey)
    : kind === "history" ? client.getQueryState<{ items: HistoryItem[] }>(["progress", "history", "all"])
    : undefined;
  const initial = kind === "saved" ? (cached?.data as {items: ForLaterItem[]} | undefined)?.items.find(item => item.id === id)
    : kind === "history" ? (cached?.data as {items: HistoryItem[]} | undefined)?.items.find(item => item.mediaId === id)
    : client.getQueryData(radioFavoritesListQuery(credentials).queryKey)?.favorites.find(item => item.id === id)
      ?? client.getQueryData(radioSearchQuery(credentials, "avoid radio", "").queryKey)?.stations.find(item => item.id === id);
  const query = useQuery({
    initialData: initial ? { kind, item: initial } as ItemDetails : undefined,
    initialDataUpdatedAt: cached?.dataUpdatedAt ?? 0,
    queryKey: [kind === "saved" ? "for-later" : kind === "history" ? "progress" : kind, "details", id],
    queryFn: ({ signal }) => readDetails(credentials, kind, id, signal), enabled: connected, staleTime: 30_000, retry: false,
  });
  // An address Core can't read (400) names no item, as one that's gone (404) no longer does.
  const gone = query.error instanceof ApiError && (query.error.status === 404 || query.error.status === 400);
  if (!query.data || gone) return <>
    {gone ? <ItemNotFound />
      : connected && !query.error ? <DetailSkeleton trail={<ContentBreadcrumb radio={kind === "radio"} />} /> : <PageHeader breadcrumb={<ContentBreadcrumb />} title="Details" />}
    {query.error && !gone ? <Alert variant="destructive"><AlertDescription>{query.error.message}</AlertDescription><AlertAction><Button variant="ghost" onClick={() => void query.refetch()}>Try again</Button></AlertAction></Alert>
      : !connected && <p role="status" className="text-sm text-muted-foreground">Connect to Couch to load this item.</p>}
  </>;
  const detail = query.data;
  switch (detail.kind) {
    case "history": return <HistoryDetails item={detail.item} refresh={() => void query.refetch()} />;
    case "saved": return <SavedDetails item={detail.item} />;
    case "radio": return <RadioDetails item={detail.item} />;
  }
}

/** The trail names the collections holding the item, so the header's links leave them out. */
function DetailLayout({ collection, radio, ...header }: ComponentProps<typeof DetailHeader> & { collection?: PlaybackCollection; radio?: boolean }) {
  return <DetailHeader {...header} trail={<ContentBreadcrumb title={header.title} collection={collection} radio={radio} />} />;
}

// Core says why a verb failed; without its answer, Couch wasn't reached.
function useDetailAction() {
  const name = useSessionGate().state?.installationName;
  return useMutation({ mutationFn: (run: () => Promise<unknown>) => run(), onError: (error: Error) => failed(`Couldn't reach ${deviceName(name)}.`, error) });
}

function QueueDetails({ id }: { id: string }) {
  const shell = useShell();
  const { state, run } = useSessionGate();
  const action = useDetailAction();
  const item = state?.queue.find(entry => entry.id === id);
  const save = useForLaterToggle(item?.source.startsWith("web:") ? item.source.slice(4) : undefined, () => ({ kind: "queue", id }), action);
  if (!item) return <><PageHeader breadcrumb={<ContentBreadcrumb />} title={state ? "Item not found" : "Details"} /><p className="text-sm text-muted-foreground">{state ? "This item is no longer in Up next." : "Connect to Couch to load this item."}</p></>;
  const radio = isRadio(item);
  return <><DetailLayout context={<MediaContext creator={item.creator} />} title={item.title} collection={item.collection} radio={radio} thumbnail={item.thumbnail} shape={radio ? "square" : tileShape(sourceLabel(item.source), !!item.collection)} duration={item.live ? undefined : item.duration} meta={[mediaSubtitle(item), sourceLabel(item.source)].filter(Boolean).join(" · ")} description={item.description}
    play={{ label: "Play", disabled: !shell.available || action.isPending, run: () => action.mutate(() => run({ type: "play", entryId: item.id })) }} save={save} more={browserActions(queuePageUrl(item))} />
    {radio ? <RelatedRadio stationId={item.source.startsWith("radio:") ? item.source.slice(6) : undefined} /> : <RelatedCollection collection={item.collection} creator={item.creator} provider={providerForUrl(item.source.replace(/^web:/, ""))} currentUrl={item.source.replace(/^web:/, "")} />}
  </>;
}

/** Save and Saved for an item kept in For later, matched by its page URL; without one, Save only adds it. */
function useForLaterToggle(url: string | undefined, reference: () => ForLaterReference, action: ReturnType<typeof useDetailAction>) {
  const shell = useShell();
  const { connected } = useSessionGate();
  const client = useQueryClient();
  const later = useQuery({ ...forLaterQuery(shell.credentials), enabled: connected });
  const saved = url ? later.data?.items.find(item => item.url === url) : undefined;
  return { saved: !!saved, disabled: !connected || !later.data || action.isPending, run: () => action.mutate(async () => {
    await (saved ? apiSend(shell.credentials, `/api/for-later/${encodeURIComponent(saved.id)}`, undefined, "DELETE") : apiSend(shell.credentials, "/api/for-later", { reference: reference() }));
    await client.invalidateQueries({ queryKey: forLaterQuery(shell.credentials).queryKey });
  }) };
}

function HistoryDetails({ item, refresh }: { item: HistoryItem; refresh: () => void }) {
  const shell = useShell();
  const session = useSessionGate();
  const action = useDetailAction();
  const { play } = usePlayOn();
  const blocked = !session.connected || action.isPending;
  const playable = shell.available && !!(item.playable || item.queueEntryId);
  // A provider page can be kept in For later; its saved copy plays the same page.
  const save = useForLaterToggle(item.url, () => ({ kind: "web", url: item.url!, title: item.title, ...(/^https?:/.test(item.thumbnail ?? "") ? { thumbnail: item.thumbnail } : {}),
    ...(item.duration != null && item.duration <= 86_400 ? { duration: item.duration } : {}), ...(item.collection ? { collection: { url: item.collection.url, index: item.collection.index } } : {}) }), action);
  const remove = async () => {
    const result = await removeFromContinue(shell.credentials, item.mediaId);
    refresh();
    if (result.undoToken && result.expiresAt && result.expiresAt > Date.now()) session.offerUndo(`Removed ${item.title} from Continue.`, async () => { await undoProgressAction(shell.credentials, result.undoToken!); refresh(); }, result.expiresAt - Date.now());
  };
  const start = (on?: string) => shell.playHistory(item, { fromStart: item.position === 0, on });
  return <><DetailLayout context={<MediaContext creator={item.creator} />} title={item.title} collection={item.collection} thumbnail={item.thumbnail} shape={tileShape(item.sourceLabel, !!item.collection)} duration={item.duration} position={item.position} meta={[mediaSubtitle(item), item.sourceLabel].filter(Boolean).join(" · ")} description={item.description}
    play={{ label: item.position > 0 ? "Resume" : "Play", disabled: blocked || !playable, run: () => action.mutate(() => play(() => start())) }}
    fromStart={item.position ? { label: "From start", disabled: blocked || !playable, run: () => action.mutate(() => play(() => shell.playHistory(item, { fromStart: true }))) } : undefined}
    queue={{ label: "Queue", disabled: blocked, run: () => action.mutate(() => session.queue(item.title, () => apiSend(shell.credentials, `/api/progress/${encodeURIComponent(item.mediaId)}/queue`, { profileId: session.state?.activeProfile.id }))) }}
    save={item.url ? save : undefined}
    playOn={{ disabled: blocked || !playable || !item.playable, run: deviceId => action.mutate(() => play(start, deviceId)) }}
    more={[...browserActions(item.url), ...item.position && !item.watched ? [{ label: "Remove from Continue", disabled: blocked, run: () => action.mutate(remove) }] : []]} /><RelatedCollection collection={item.collection} creator={item.creator} currentTitle={item.title} /></>;
}

function SavedDetails({ item }: { item: ForLaterItem }) {
  const shell = useShell();
  const { connected, offerUndo, queue } = useSessionGate();
  const navigation = useDetailNavigation();
  const client = useQueryClient();
  const action = useDetailAction();
  const { play } = usePlayOn();
  const list = useQuery({ ...forLaterQuery(shell.credentials), enabled: connected });
  const items = list.data?.items ?? [];
  const index = items.findIndex(saved => saved.id === item.id);
  const refresh = () => client.invalidateQueries({ queryKey: forLaterQuery(shell.credentials).queryKey });
  const remove = async () => {
    const result = await apiSend<{ undoToken?: string }>(shell.credentials, `/api/for-later/${encodeURIComponent(item.id)}`, undefined, "DELETE");
    if (result?.undoToken) offerUndo(savedNotice(item.title, false), async () => {
      await apiSend(shell.credentials, "/api/for-later/restore", { token: result.undoToken }, "POST", 10_000);
      await refresh();
    });
    await refresh();
    navigation.back("/saved");
  };
  const move = async (offset: number) => {
    const adjacent = items[index + offset];
    const order = adjacent && reorderedIds(items, saved => saved.id, item.id, adjacent.id);
    if (!order) return;
    await apiSend(shell.credentials, "/api/for-later/reorder", { order: order.map(saved => saved.id) }, "POST", 10_000);
    await refresh();
  };
  const load = async (mode: "play" | "append", on?: string) => {
    const send = () => loadForLater(shell.credentials, item.id, mode, on);
    await (mode === "append" ? queue(item.title, send) : send());
    await client.invalidateQueries({ queryKey: forLaterQuery(shell.credentials).queryKey });
  };
  // A saved item has no Save: Remove, with Undo, takes it out of For later.
  return <><DetailLayout context={<MediaContext creator={item.creator} />} title={item.title} collection={item.collection} thumbnail={item.thumbnail} shape={tileShape(savedSourceLabel(item), !!item.collection)} duration={item.live ? undefined : item.duration} meta={[mediaSubtitle(item), savedSourceLabel(item)].filter(Boolean).join(" · ")} description={item.description}
    play={{ label: "Play", disabled: !connected || !shell.available || action.isPending, run: () => action.mutate(() => play(() => load("play"))) }}
    queue={{ label: "Queue", disabled: !connected || action.isPending, run: () => action.mutate(() => load("append")) }}
    playOn={{ disabled: !connected || !shell.available || action.isPending, run: deviceId => action.mutate(() => play(on => load("play", on), deviceId)) }}
    more={[
      ...browserActions(item.url),
      { label: "Move up", disabled: !connected || action.isPending || index <= 0, run: () => action.mutate(() => move(-1)) },
      { label: "Move down", disabled: !connected || action.isPending || index < 0 || index >= items.length - 1, run: () => action.mutate(() => move(1)) },
      { label: "Remove", disabled: !connected || action.isPending, run: () => action.mutate(remove) },
    ]}>{action.error && <p role="alert" className="text-sm text-destructive">{action.error.message}</p>}</DetailLayout><RelatedCollection collection={item.collection} creator={item.creator} currentUrl={item.url} /></>;
}

function RadioDetails({ item }: { item: RadioStation }) {
  const shell = useShell();
  const { connected } = useSessionGate();
  const action = useDetailAction();
  const { play } = usePlayOn();
  const programmes = useQuery({ ...radioProgrammesQuery(shell.credentials), enabled: connected && item.sourceId === avoidRadioPlaylistId, refetchInterval: 60_000 });
  const save = useStationSave()(item);
  const programme = programmes.data?.[item.id];
  return <><DetailLayout radio title={programme?.title || item.name} thumbnail={programme?.artworkUrl ?? item.logoUrl} shape="square" fit={programme?.artworkUrl ? undefined : "contain"} meta={[programme ? item.name : item.groupTitle || item.countryCode, programme?.genre, programme?.artist, programme?.album, programme?.bitrate && `${programme.bitrate} kbps`].filter(Boolean).join(" · ")} description={programme?.description}
    play={{ label: "Play", aria: item.name, disabled: !connected || !shell.available || action.isPending, run: () => action.mutate(() => shell.enqueueRadio(item, true)) }}
    queue={{ label: "Queue", disabled: !connected || action.isPending, run: () => action.mutate(() => shell.enqueueRadio(item, false)) }}
    save={{ ...save, disabled: save.disabled || action.isPending }}
    playOn={{ disabled: !connected || !shell.available || action.isPending, run: deviceId => action.mutate(() => play(on => shell.enqueueRadio(item, true, on), deviceId)) }}
    more={browserActions(programme?.programmeUrl ?? item.homepage)} /><RelatedRadio station={item} /></>;
}
