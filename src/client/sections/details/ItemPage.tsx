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
import { ContentBreadcrumb } from "@/components/ContentBreadcrumb";
import { BrowseActions } from "@/sections/find/SearchPanel";
import type { SearchHit } from "@/sections/find/SearchOnlineResults";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { RelatedCollection } from "@/components/RelatedCollection";
import { RelatedRadio } from "@/components/RelatedRadio";
import { useSessionGate } from "@/session/session-context";
import { useShell } from "@/sections/shell/shell-context";
import { formatDuration } from "@/time-format";
import type { ForLaterItem } from "../../../shared/for-later";
import type { HistoryItem } from "../../../shared/viewing";
import { avoidRadioPlaylistId, type RadioStation } from "../../../shared/radio";
import type { PlaybackCollection } from "../../../shared/protocol";
import { providerForUrl } from "../../../shared/providers";
import { sourceLabel } from "@/source-label";
import { playOnQuery, usePlayOn } from "@/components/PlayOn";

const kinds = ["history", "saved", "radio", "queue"] as const;
type Kind = typeof kinds[number];
type ItemDetails = { kind: "history"; item: HistoryItem } | { kind: "saved"; item: ForLaterItem } | { kind: "radio"; item: RadioStation };

export function readItemSearch(search: Record<string, unknown>): { kind?: Kind; id?: string } {
  const kind = kinds.find(kind => kind === search.kind);
  return kind && typeof search.id === "string" && search.id.trim() && search.id.length <= 2048 ? { kind, id: search.id } : {};
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
  const { search } = useLocation();
  const { kind, id } = readItemSearch(search);
  return <section data-page="Item" className="min-w-0 space-y-6">
    {kind && id ? kind === "queue" ? <QueueDetails id={id} /> : <LoadedItem key={`${kind}:${id}`} kind={kind} id={id} /> : <><ContentBreadcrumb title="Item not found" /><PageHeader title="Item not found" /></>}
  </section>;
}

function LoadedItem({ kind, id }: { kind: Exclude<Kind, "queue">; id: string }) {
  const { credentials } = useShell();
  const { connected } = useSessionGate();
  const query = useQuery({
    queryKey: [kind === "saved" ? "for-later" : kind === "history" ? "progress" : kind, "item", id],
    queryFn: ({ signal }) => readDetails(credentials, kind, id, signal), enabled: connected, staleTime: 30_000, retry: false,
  });
  if (!query.data || query.error instanceof ApiError && query.error.status === 404) return <>
    <ContentBreadcrumb title="Details" />
    <PageHeader title={query.error instanceof ApiError && query.error.status === 404 ? "Item not found" : "Details"} />
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

function DetailLayout({ title, meta, description, thumbnail, position, duration, primary, actions, children, collection, radio }: {
  title: string; meta?: string; description?: string | null; thumbnail?: string; position?: number; duration?: number | null; primary: ReactNode; actions: SearchHit["actions"]; children?: ReactNode; collection?: PlaybackCollection; radio?: boolean;
}) {
  return <>
    <ContentBreadcrumb title={title} collection={collection} radio={radio} />
    <header>
      <div className="flex items-start gap-4">
        <MediaArtwork thumbnail={thumbnail} title={title} className="size-20 shrink-0 object-contain sm:size-24" />
        <div className="min-w-0 space-y-2">
          <h1 tabIndex={-1} className="text-2xl font-semibold tracking-tight break-words outline-none">{title}</h1>
          {(meta || duration != null) && <p className="text-sm text-muted-foreground">{[meta, duration != null && formatDuration(duration)].filter(Boolean).join(" · ")}</p>}
          {!!position && <p className="text-sm text-muted-foreground">Resume at {formatDuration(position)}</p>}
          <div className="flex items-center gap-1">{primary}<BrowseActions title={title} actions={actions} /></div>
        </div>
      </div>
      {description && <Collapsible className="mt-2"><CollapsibleTrigger asChild><Button variant="ghost" size="sm" className="-ml-2.5 text-muted-foreground">About</Button></CollapsibleTrigger><CollapsibleContent><p className="max-w-prose pt-2 text-sm leading-relaxed break-words text-muted-foreground">{description}</p></CollapsibleContent></Collapsible>}
    </header>
    {children}
  </>;
}

function useDetailAction() {
  return useMutation({ mutationFn: (run: () => Promise<unknown>) => run(), onError: (error: Error) => toast.error(error.message) });
}

function QueueDetails({ id }: { id: string }) {
  const shell = useShell();
  const { state, connected, run } = useSessionGate();
  const action = useDetailAction();
  const item = state?.queue.find(entry => entry.id === id);
  if (!item) return <><ContentBreadcrumb title="Details" /><PageHeader title={state ? "Item not found" : "Details"} /><p className="text-sm text-muted-foreground">{state ? "This item is no longer in Up next." : "Connect to Couch to load this item."}</p></>;
  const radio = item.kind === "radio" || item.source.startsWith("radio:");
  return <><DetailLayout title={item.title} collection={item.collection} radio={radio} thumbnail={item.thumbnail} duration={item.duration} meta={[item.subtitle, sourceLabel(item.source)].filter(Boolean).join(" · ")} description={item.description}
    primary={<Button size="sm" disabled={!shell.available || action.isPending} onClick={() => action.mutate(() => run({ type: "play", entryId: item.id }))}>Play</Button>}
    actions={[{ label: "Save for later", disabled: !connected || action.isPending, run: () => action.mutate(() => apiSend(shell.credentials, "/api/for-later", { reference: { kind: "queue", id: item.id } })) }]} />
    {radio ? <RelatedRadio stationId={item.source.startsWith("radio:") ? item.source.slice(6) : undefined} /> : <RelatedCollection collection={item.collection} provider={providerForUrl(item.source.replace(/^web:/, ""))} currentUrl={item.source.replace(/^web:/, "")} />}
  </>;
}

function HistoryDetails({ item, refresh }: { item: HistoryItem; refresh: () => void }) {
  const shell = useShell();
  const session = useSessionGate();
  const action = useDetailAction();
  const { on, play } = usePlayOn();
  const blocked = !session.connected || action.isPending;
  const playable = shell.available && !!(item.playable || item.queueEntryId);
  const remove = async () => {
    const result = await removeFromContinue(shell.credentials, item.mediaId);
    refresh();
    if (result.undoToken && result.expiresAt && result.expiresAt > Date.now()) session.offerUndo(`Removed ${item.title} from Continue.`, async () => { await undoProgressAction(shell.credentials, result.undoToken!); refresh(); }, result.expiresAt - Date.now());
  };
  return <><DetailLayout title={item.title} collection={item.collection} thumbnail={item.thumbnail} duration={item.duration} position={item.position} meta={[item.subtitle, item.sourceLabel].filter(Boolean).join(" · ")} description={item.description}
    primary={<Button size="sm" disabled={blocked || !playable} onClick={() => action.mutate(() => play(() => shell.playHistory(item, { fromStart: item.position === 0 })))}>{on(item.position > 0 ? "Resume" : "Play")}</Button>}
    actions={[
      { label: "Play on", disabled: blocked || !playable, playOn: deviceId => action.mutate(() => play(on => shell.playHistory(item, { fromStart: item.position === 0, on }), deviceId)) },
      ...(item.position ? [{ label: "From start", disabled: blocked || !playable, run: () => action.mutate(() => play(() => shell.playHistory(item, { fromStart: true }))) }] : []),
      { label: "Queue", disabled: blocked, run: () => action.mutate(() => apiSend(shell.credentials, `/api/progress/${encodeURIComponent(item.mediaId)}/queue`, { profileId: session.state?.activeProfile.id })) },
      ...(item.position && !item.watched ? [{ label: "Remove from Continue", disabled: blocked, run: () => action.mutate(remove) }] : []),
    ]} /><RelatedCollection collection={item.collection} currentTitle={item.title} /></>;
}

function SavedDetails({ item }: { item: ForLaterItem }) {
  const shell = useShell();
  const { connected } = useSessionGate();
  const client = useQueryClient();
  const action = useDetailAction();
  const { on, play } = usePlayOn();
  const load = async (mode: "play" | "append", on?: string) => {
    const result = await apiSend<{ notice?: string }>(shell.credentials, `/api/for-later/${encodeURIComponent(item.id)}/load${playOnQuery(on)}`, { mode }, "POST", 30_000);
    if (result?.notice) toast(result.notice);
    await client.invalidateQueries({ queryKey: forLaterQuery(shell.credentials).queryKey });
  };
  return <><DetailLayout title={item.title} collection={item.collection} thumbnail={item.thumbnail} duration={item.duration} meta={[item.subtitle, savedSourceLabel(item)].filter(Boolean).join(" · ")} description={item.description}
    primary={<Button size="sm" disabled={!connected || !shell.available || action.isPending} onClick={() => action.mutate(() => play(() => load("play")))}>{on("Play")}</Button>}
    actions={[{ label: "Play on", disabled: !connected || !shell.available || action.isPending, playOn: deviceId => action.mutate(() => play(on => load("play", on), deviceId)) }, { label: "Queue", disabled: !connected || action.isPending, run: () => action.mutate(() => load("append")) }]}>{action.error && <p role="alert" className="text-sm text-destructive">{action.error.message}</p>}</DetailLayout><RelatedCollection collection={item.collection} currentUrl={item.url} /></>;
}

function RadioDetails({ item }: { item: RadioStation }) {
  const shell = useShell();
  const { connected, nativeHost } = useSessionGate();
  const action = useDetailAction();
  const { on, play } = usePlayOn();
  const programmes = useQuery({ ...radioProgrammesQuery(shell.credentials), enabled: connected && item.sourceId === avoidRadioPlaylistId, refetchInterval: 60_000 });
  const programme = programmes.data?.[item.id];
  return <><DetailLayout radio title={programme?.title || item.name} thumbnail={programme?.artworkUrl ?? item.logoUrl} meta={[programme ? item.name : item.groupTitle || item.countryCode, programme?.genre, programme?.artist, programme?.album, programme?.bitrate && `${programme.bitrate} kbps`].filter(Boolean).join(" · ")} description={programme?.description}
    primary={<Button size="sm" aria-label={on(`Play ${item.name}`)} disabled={!connected || !shell.available || action.isPending} onClick={() => action.mutate(() => shell.enqueueRadio(item, true))}>{on("Play")}</Button>}
    actions={[
      { label: "Play on", disabled: !connected || !shell.available || action.isPending, playOn: deviceId => action.mutate(() => play(on => shell.enqueueRadio(item, true, on), deviceId)) },
      { label: "Queue", disabled: !connected || action.isPending, run: () => action.mutate(() => shell.enqueueRadio(item, false)) },
      ...(!nativeHost && programme?.programmeUrl ? [{ label: "Open show page", node: <a href={programme.programmeUrl} target="_blank" rel="noopener noreferrer">Open show page</a> }] : []),
    ]} /><RelatedRadio station={item} /></>;
}
