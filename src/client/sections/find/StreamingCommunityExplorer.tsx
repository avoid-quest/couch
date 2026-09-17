import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ListMusic, Play, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { MediaArtwork } from "@/components/MediaArtwork";
import type { ProviderItem } from "../../../shared/providers";
import type { Credentials } from "../../session/session";
import { streamingCommunityBrowse, streamingCommunityPreviewQuery } from "@/api/streamingcommunity";
import { useInvalidation } from "./useInvalidation";

type Props = {
  credentials: Credentials;
  connected: boolean;
  canPlay: boolean;
  active: boolean;
  onEnqueue: (item: ProviderItem, playNow: boolean) => Promise<boolean>;
  onSavePlaylist: (provider: "streamingcommunity", url: string) => Promise<boolean>;
};
type Location = { request: { q?: string; url?: string }; title: string };
const message = (error: unknown) => error instanceof Error ? error.message : "Could not load StreamingCommunity.";
const previewId = (item: ProviderItem) => Number(/\/titles\/(\d+)-/.exec(item.url)?.[1] ?? 0) || null;
const isListUrl = (url: string | undefined) => /\/titles\/\d+(?:-[\w-]*)?(?:\/season-\d+)?$/.test(url ?? "");

export function StreamingCommunityExplorer({ credentials, connected, canPlay, active, onEnqueue, onSavePlaylist }: Props) {
  const version = useInvalidation("providers");
  const [trail, setTrail] = useState<Location[]>([{ request: {}, title: "Catalogue" }]);
  const location = trail[trail.length - 1]!;
  const [draft, setDraft] = useState("");
  const [detail, setDetail] = useState<ProviderItem | null>(null);
  const detailTrigger = useRef<HTMLButtonElement | null>(null);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const browse = useInfiniteQuery({
    queryKey: ["providers", "streamingcommunity", version, location.request] as const,
    queryFn: ({ signal, pageParam }) => streamingCommunityBrowse(credentials, { ...location.request, ...pageParam }, signal),
    initialPageParam: {} as { cursor?: string },
    getNextPageParam: (lastPage, _pages, lastPageParam) => lastPage.nextCursor ? { ...lastPageParam, cursor: lastPage.nextCursor } : undefined,
    enabled: connected,
  });
  const items = browse.data?.pages.flatMap(page => page.items) ?? [];
  const heading = browse.data?.pages.at(-1)?.title ?? location.title;
  const preview = useQuery({ ...streamingCommunityPreviewQuery(credentials, detail ? previewId(detail) : null, version) });
  useEffect(() => { setNotice(""); setActionError(""); }, [location]);

  const search = (event: React.FormEvent) => {
    event.preventDefault();
    const value = draft.trim();
    setTrail([{ request: /^https?:\/\//i.test(value) ? { url: value } : value ? { q: value } : {}, title: value ? `Results for ${value}` : "Catalogue" }]);
  };
  const open = (item: ProviderItem) => {
    setTrail(current => [...current, { request: { url: item.url }, title: item.title }]);
  };
  const back = () => setTrail(current => current.length > 1 ? current.slice(0, -1) : current);
  const run = async (work: () => Promise<boolean>, done: string) => {
    if (busy || !connected) return;
    setBusy(true); setActionError(""); setNotice("");
    try {
      if (await work()) setNotice(done);
    } catch (error) { setActionError(message(error)); }
    finally { setBusy(false); }
  };
  const enqueue = (item: ProviderItem, playNow: boolean) => run(() => onEnqueue(item, playNow), playNow ? `${item.title} sent to the TV.` : `${item.title} added to the shared queue.`);
  const save = (url: string) => run(() => onSavePlaylist("streamingcommunity", url), "Saved as a playlist. Find it under Saved playlists.");
  const actions = (item: ProviderItem, dialog = false) => <div className="flex flex-wrap items-center gap-1">
    {item.kind === "media" ? <>
      <Button aria-label={`Play now: ${item.title}`} className="min-h-11" disabled={!connected || !canPlay || busy} onClick={() => void enqueue(item, true)}><Play aria-hidden="true" />Play now</Button>
      <Button variant="secondary" aria-label={`Add to queue: ${item.title}`} className="min-h-11" disabled={!connected || busy} onClick={() => void enqueue(item, false)}><Plus aria-hidden="true" />Add to queue</Button>
    </> : <Button variant="secondary" aria-label={`Open ${item.title}`} className="min-h-11" disabled={!connected} onClick={() => { if (dialog) setDetail(null); open(item); }}>Open</Button>}
    {isListUrl(item.url) && <Button variant="secondary" aria-label={`Save ${item.title} as playlist`} className="min-h-11" disabled={!connected || busy} onClick={() => void save(item.url)}><ListMusic aria-hidden="true" />Save as playlist</Button>}
  </div>;
  return <section aria-label="StreamingCommunity" className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-xl font-semibold tracking-tight">StreamingCommunity</h2>
      <p className="text-[13px] text-muted-foreground">Films and series from the configured website source.</p>
    </div>
    <form role="search" className="flex items-end gap-2" onSubmit={search}>
      <div className="grid min-w-0 flex-1 gap-2">
        <Label htmlFor="streamingcommunity-search">Search or open a title link</Label>
        <Input id="streamingcommunity-search" className="min-h-11" type="search" maxLength={2000} placeholder="Search StreamingCommunity or paste a title link" value={draft} onChange={event => setDraft(event.target.value)} disabled={!connected} />
      </div>
      <Button type="submit" className="min-h-11" disabled={!connected}>Search</Button>
    </form>
    {!connected && <p role="status">Browsing will return when the TV reconnects.</p>}
    {browse.isPending && connected && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner aria-hidden="true" />Loading StreamingCommunity…</p>}
    {browse.isError && <p role="alert">{message(browse.error)} <Button variant="outline" className="min-h-11" disabled={!connected} onClick={() => void browse.refetch()}>Try again</Button></p>}
    {browse.isSuccess && <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {trail.length > 1 && <Button variant="outline" className="min-h-11" onClick={back}>Back</Button>}
          <h3 className="text-lg font-medium wrap-anywhere">{heading}</h3>
        </div>
        {isListUrl(location.request.url) && <Button variant="secondary" className="min-h-11" aria-label={`Save ${heading} as playlist`} disabled={!connected || busy} onClick={() => void save(location.request.url!)}><ListMusic aria-hidden="true" />Save as playlist</Button>}
      </div>
      {notice && <p role="status" className="rounded-lg border bg-muted p-4 text-sm">{notice}</p>}
      {actionError && <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">{actionError}</p>}
      {!browse.isFetching && !items.length && <p className="text-sm text-muted-foreground">Nothing found. Try another search or paste a title link.</p>}
      <ul className="m-0 grid list-none grid-cols-2 gap-4 p-0 md:grid-cols-3 md:gap-[18px]">
        {items.map(item => <li key={item.id} className="flex min-w-0 flex-col">
          <MediaArtwork thumbnail={item.thumbnail} title={item.title} />
          <div className="grid gap-1 px-0.5 pb-0 pt-2.5">
            <Button variant="ghost" className="flex min-h-11 min-w-0 flex-col items-start gap-1 p-0 text-left leading-normal whitespace-normal" aria-label={`Details for ${item.title}`} onClick={event => { detailTrigger.current = event.currentTarget; setDetail(item); }}>
              <strong className="text-[15px] font-semibold leading-tight break-words">{item.title}</strong>
              <small className="text-xs text-muted-foreground break-words">{item.subtitle}</small>
            </Button>
          </div>
          {actions(item)}
        </li>)}
      </ul>
      {browse.hasNextPage && <Button variant="outline" className="min-h-11 w-full" disabled={!connected || browse.isFetching} onClick={() => void browse.fetchNextPage()}>{browse.isFetching ? "Loading more…" : "Load more"}</Button>}
    </div>}
    <Dialog open={active && detail !== null} onOpenChange={openState => { if (!openState) setDetail(null); }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto" onCloseAutoFocus={event => { event.preventDefault(); if (active && detailTrigger.current?.isConnected) detailTrigger.current.focus({ preventScroll: true }); }}>
        {detail && <>
          <MediaArtwork thumbnail={detail.thumbnail} title={detail.title} className="h-auto aspect-[1.9] w-full" />
          <DialogHeader>
            <DialogTitle>{detail.title}</DialogTitle>
            <DialogDescription>{[preview.data && [preview.data.year, preview.data.quality, preview.data.kind === "series" ? preview.data.seasonsCount ? `${preview.data.seasonsCount} seasons` : "Series" : preview.data.runtime ? `${preview.data.runtime} min` : "Film"].filter(Boolean).join(" · "), preview.data?.genres.join(" · ")].filter(Boolean).join(" — ") || detail.subtitle || "StreamingCommunity"}</DialogDescription>
          </DialogHeader>
          {(preview.data?.plot || detail.description) && <p className="break-words text-sm">{preview.data?.plot || detail.description}</p>}
          {preview.isPending && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner aria-hidden="true" />Loading details…</p>}
          {actions(detail, true)}
          {notice && <p role="status">{notice}</p>}
          {actionError && <p role="alert">{actionError}</p>}
          {preview.isError && <p role="alert">{message(preview.error)}</p>}
        </>}
      </DialogContent>
    </Dialog>
  </section>;
}
