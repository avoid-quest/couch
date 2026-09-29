import type { ReactNode } from "react";
import { useLocation } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, apiJson, apiSend, type ApiCredentials } from "@/api/client";
import { forLaterQuery } from "@/api/for-later";
import { radioProgrammesQuery } from "@/api/radio";
import { removeFromContinue, undoProgressAction } from "@/api/progress";
import { MediaArtwork } from "@/components/MediaArtwork";
import { PageHeader } from "@/components/PageHeader";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { savedSourceLabel } from "@/saved-source";
import { collectionTarget } from "@/collection-target";
import { useDetailNavigation } from "@/detail-navigation";
import { useSessionGate } from "@/session/session-context";
import { useShell } from "@/sections/shell/shell-context";
import { formatDuration } from "@/time-format";
import type { ForLaterItem } from "../../../shared/for-later";
import type { HistoryItem } from "../../../shared/viewing";
import { avoidRadioPlaylistId, type RadioStation } from "../../../shared/radio";
import type { PlaybackCollection } from "../../../shared/protocol";

const kinds = ["history", "saved", "radio"] as const;
type Kind = typeof kinds[number];
type ItemDetails = { kind: "history"; item: HistoryItem } | { kind: "saved"; item: ForLaterItem } | { kind: "radio"; item: RadioStation };

export function readItemSearch(search: Record<string, unknown>): { kind?: Kind; id?: string } {
  const kind = kinds.find(kind => kind === search.kind);
  return kind && typeof search.id === "string" && search.id.trim() && search.id.length <= 2048 ? { kind, id: search.id } : {};
}

async function readDetails(credentials: ApiCredentials, kind: Kind, id: string, signal: AbortSignal): Promise<ItemDetails> {
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
  const { search } = useLocation();
  const { kind, id } = readItemSearch(search);
  const navigation = useDetailNavigation();
  return <section data-page="Item" className="min-w-0">
    {kind && id ? <LoadedItem key={`${kind}:${id}`} kind={kind} id={id} /> : <PageHeader title="Item not found" back={{ label: "Back", onClick: () => navigation.back() }} />}
  </section>;
}

function LoadedItem({ kind, id }: { kind: Kind; id: string }) {
  const { credentials } = useShell();
  const { connected } = useSessionGate();
  const navigation = useDetailNavigation();
  const query = useQuery({
    queryKey: [kind === "saved" ? "for-later" : kind === "history" ? "progress" : kind, "item", id],
    queryFn: ({ signal }) => readDetails(credentials, kind, id, signal), enabled: connected, staleTime: 30_000, retry: false,
  });
  if (!query.data || query.error instanceof ApiError && query.error.status === 404) return <>
    <PageHeader title={query.error instanceof ApiError && query.error.status === 404 ? "Item not found" : "Details"} back={{ label: "Back", onClick: () => navigation.back() }} />
    {query.error ? <Alert variant="destructive"><AlertDescription>{query.error.message}</AlertDescription><AlertAction><Button variant="ghost" onClick={() => void query.refetch()}>Try again</Button></AlertAction></Alert>
      : <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">{connected ? <><Spinner className="size-4" />Loading details…</> : "Connect to Couch to load this item."}</p>}
  </>;
  const detail = query.data;
  switch (detail.kind) {
    case "history": return <HistoryDetails item={detail.item} refresh={() => void query.refetch()} />;
    case "saved": return <SavedDetails item={detail.item} />;
    case "radio": return <RadioDetails item={detail.item} />;
  }
}

function DetailLayout({ title, meta, description, thumbnail, position, duration, actions, children }: {
  title: string; meta?: string; description?: string | null; thumbnail?: string; position?: number; duration?: number | null; actions: ReactNode; children?: ReactNode;
}) {
  const navigation = useDetailNavigation();
  return <>
    <PageHeader title={title} back={{ label: "Back", onClick: () => navigation.back() }} className="[&_h1]:whitespace-normal [&_h1]:break-words" />
    <div className="grid items-start gap-6 sm:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] sm:gap-8">
      <MediaArtwork thumbnail={thumbnail} title={title} className="aspect-square h-auto w-full max-w-sm object-contain" />
      <div className="min-w-0 space-y-5">
        {(meta || duration != null) && <p className="text-sm text-muted-foreground">{[meta, duration != null && formatDuration(duration)].filter(Boolean).join(" · ")}</p>}
        {description && <p className="max-w-prose whitespace-pre-line text-sm leading-relaxed break-words">{description}</p>}
        {!!position && <p className="text-sm text-muted-foreground">Resume at {formatDuration(position)}</p>}
        <div className="flex flex-wrap gap-2">{actions}</div>
        {children}
      </div>
    </div>
  </>;
}

function useDetailAction() {
  return useMutation({ mutationFn: (run: () => Promise<unknown>) => run(), onError: (error: Error) => toast.error(error.message) });
}

function BrowseCollection({ collection }: { collection?: PlaybackCollection }) {
  const shell = useShell();
  const target = collectionTarget(collection);
  return target && <Button variant="ghost" aria-label={`Browse ${target.title}`} onClick={() => shell.openProvider(target)}>Browse</Button>;
}

function HistoryDetails({ item, refresh }: { item: HistoryItem; refresh: () => void }) {
  const shell = useShell();
  const session = useSessionGate();
  const action = useDetailAction();
  const blocked = !session.connected || action.isPending;
  const playable = shell.available && !!(item.playable || item.queueEntryId);
  const remove = async () => {
    const result = await removeFromContinue(shell.credentials, item.mediaId);
    refresh();
    if (result.undoToken && result.expiresAt && result.expiresAt > Date.now()) session.offerUndo(`Removed ${item.title} from Continue.`, async () => { await undoProgressAction(shell.credentials, result.undoToken!); refresh(); }, result.expiresAt - Date.now());
  };
  return <DetailLayout title={item.title} thumbnail={item.thumbnail} duration={item.duration} position={item.position} meta={[item.subtitle, item.sourceLabel].filter(Boolean).join(" · ")} description={item.description} actions={<>
    <Button disabled={blocked || !playable} onClick={() => action.mutate(() => shell.playHistory(item, { fromStart: item.position === 0 }))}>{item.position > 0 ? "Resume" : "Play"}</Button>
    {!!item.position && <Button variant="ghost" disabled={blocked || !playable} onClick={() => action.mutate(() => shell.playHistory(item, { fromStart: true }))}>From start</Button>}
    <Button variant="ghost" disabled={blocked} onClick={() => action.mutate(() => apiSend(shell.credentials, `/api/progress/${encodeURIComponent(item.mediaId)}/queue`, { profileId: session.state?.activeProfile.id }))}>Queue</Button>
    {!!item.position && !item.watched && <Button variant="ghost" disabled={blocked} onClick={() => action.mutate(remove)}>Remove from Continue</Button>}
    <BrowseCollection collection={item.collection} />
  </>} />;
}

function SavedDetails({ item }: { item: ForLaterItem }) {
  const shell = useShell();
  const { connected } = useSessionGate();
  const client = useQueryClient();
  const action = useDetailAction();
  const load = async (mode: "play" | "append") => {
    const result = await apiSend<{ notice?: string }>(shell.credentials, `/api/for-later/${encodeURIComponent(item.id)}/load`, { mode }, "POST", 30_000);
    if (result?.notice) toast(result.notice);
    await client.invalidateQueries({ queryKey: forLaterQuery(shell.credentials).queryKey });
  };
  return <DetailLayout title={item.title} thumbnail={item.thumbnail} duration={item.duration} meta={[item.subtitle, savedSourceLabel(item)].filter(Boolean).join(" · ")} description={item.description} actions={<>
    <Button disabled={!connected || !shell.available || action.isPending} onClick={() => action.mutate(() => load("play"))}>Play</Button>
    <Button variant="ghost" disabled={!connected || action.isPending} onClick={() => action.mutate(() => load("append"))}>Queue</Button>
    <BrowseCollection collection={item.collection} />
  </>}>{action.error && <p role="alert" className="text-sm text-destructive">{action.error.message}</p>}</DetailLayout>;
}

function RadioDetails({ item }: { item: RadioStation }) {
  const shell = useShell();
  const { connected } = useSessionGate();
  const action = useDetailAction();
  const programmes = useQuery({ ...radioProgrammesQuery(shell.credentials), enabled: connected && item.sourceId === avoidRadioPlaylistId, refetchInterval: 60_000 });
  const programme = programmes.data?.[item.id];
  return <DetailLayout title={programme?.title || item.name} thumbnail={programme?.artworkUrl ?? item.logoUrl} meta={[programme ? item.name : item.groupTitle || item.countryCode, programme?.genre].filter(Boolean).join(" · ")} description={programme?.description} actions={<>
    <Button disabled={!connected || !shell.available || action.isPending} onClick={() => action.mutate(() => shell.enqueueRadio(item, true))}>Play {item.name}</Button>
    <Button variant="ghost" disabled={!connected || action.isPending} onClick={() => action.mutate(() => shell.enqueueRadio(item, false))}>Queue</Button>
  </>} />;
}
