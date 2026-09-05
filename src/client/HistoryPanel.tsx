import { useEffect, useState } from "react";
import { Check, History, MoreHorizontal, Play, RotateCcw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { HistoryItem, ViewingProgress, WatchingProfile } from "../shared/library";

export type HistoryPlayback = (item: HistoryItem, options: { fromStart?: boolean }) => Promise<boolean>;

export function progressTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

export function ProgressActions({ origin, token, connected, mediaId, title, progress, onUpdated }: {
  origin: string;
  token: string;
  connected: boolean;
  mediaId: string;
  title: string;
  progress?: ViewingProgress | null;
  onUpdated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = async (body: { watched?: boolean; clearResume?: true }) => {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`${origin}/api/progress/${encodeURIComponent(mediaId)}`, {
        method: "POST", signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not update watched state.");
      onUpdated();
      setOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update watched state.");
    } finally { setPending(false); }
  };
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><Button variant="ghost" size="icon" disabled={!connected} aria-label={`Watching options for ${title}`}><MoreHorizontal aria-hidden="true" /></Button></PopoverTrigger>
    <PopoverContent align="end" className="max-w-[calc(100vw-2rem)] gap-3" aria-label={`Watching options for ${title}`}>
      <p className="break-words font-medium">{title}</p>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <Button variant="outline" className="justify-start" disabled={!connected || pending} onClick={() => void update({ watched: !progress?.watched })}><Check aria-hidden="true" />{progress?.watched ? "Mark unwatched" : "Mark watched"}</Button>
      {!!progress?.position && <Button variant="outline" className="justify-start" disabled={!connected || pending} onClick={() => void update({ clearResume: true })}><RotateCcw aria-hidden="true" />Clear resume point</Button>}
      {pending && <p className="text-sm text-muted-foreground" role="status">Saving…</p>}
    </PopoverContent>
  </Popover>;
}

export function HistoryPanel({ origin, token, connected, canPlay, version, onPlay }: {
  origin: string;
  token: string;
  connected: boolean;
  canPlay: boolean;
  version: number;
  onPlay: HistoryPlayback;
}) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [profile, setProfile] = useState<WatchingProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!connected) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void fetch(`${origin}/api/progress/history?limit=40`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
    }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load viewing history.");
      if (!controller.signal.aborted) { setItems(result.items); setProfile(result.profile); }
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load viewing history.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [origin, token, connected, version, refresh]);

  const play = async (item: HistoryItem, fromStart = false) => {
    setPending(item.mediaId);
    setError(null);
    setNotice(null);
    try {
      if (await onPlay(item, { fromStart })) setNotice(`${fromStart || !item.position ? "Starting" : "Resuming"} ${item.title} on the TV.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not play this item."); }
    finally { setPending(null); }
  };

  return <section className="history-panel space-y-4" aria-label="Viewing history">
    <div><h3 className="text-xl font-semibold">Recently played</h3><p className="mt-1 text-sm text-muted-foreground">{profile ? `${profile.name}'s local history.` : "Your local history."} Jellyfin history stays with your Jellyfin account.</p></div>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {notice && <p className="text-sm text-primary" role="status">{notice}</p>}
    {loading && <p className="text-sm text-muted-foreground" role="status">Loading history…</p>}
    {!loading && !items.length && <Card className="p-5 text-sm text-muted-foreground">Play a local file to begin this profile's history.</Card>}
    <ul className="history-items space-y-3" aria-busy={loading}>{items.map(item => {
      const available = !!(item.libraryItemId || item.queueEntryId);
      const resumable = item.position > 0;
      return <li key={item.mediaId}><Card className="catalog-row gap-3 p-3">
        <div className="catalog-row-main flex min-w-0 items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-muted text-primary"><History aria-hidden="true" /></span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><strong className="break-words text-base font-medium">{item.title}</strong>{item.watched && <Badge variant="secondary"><Check aria-hidden="true" />Watched</Badge>}</div>
            <p className="mt-1 text-sm text-muted-foreground">{resumable ? `${progressTime(item.position)}${item.duration ? ` of ${progressTime(item.duration)}` : ""}` : "No saved resume point"}{item.lastPlayedAt && ` · ${new Date(item.lastPlayedAt).toLocaleDateString()}`}</p>
          </div>
          <ProgressActions origin={origin} token={token} connected={connected} mediaId={item.mediaId} title={item.title} progress={item} onUpdated={() => setRefresh(value => value + 1)} />
        </div>
        <div className="catalog-row-actions flex flex-wrap gap-2">
          <Button disabled={!connected || !canPlay || !available || pending !== null} aria-label={`${resumable ? "Resume" : "Play"} ${item.title}`} onClick={() => void play(item)}><Play aria-hidden="true" />{pending === item.mediaId ? "Starting…" : resumable ? "Resume" : "Play"}</Button>
          {resumable && <Button variant="outline" disabled={!connected || !canPlay || !available || pending !== null} aria-label={`Play ${item.title} from start`} onClick={() => void play(item, true)}><RotateCcw aria-hidden="true" />From start</Button>}
        </div>
        {!available && <p className="text-sm text-muted-foreground">Open this file again on the TV to play it. Its resume point and watched mark are saved.</p>}
      </Card></li>;
    })}</ul>
  </section>;
}
