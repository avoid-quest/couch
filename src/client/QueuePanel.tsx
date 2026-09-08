import { invoke } from "@tauri-apps/api/core";
import { useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { FolderOpen, ListMusic, Play, Plus } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Action, QueueEntry, SessionState, VideoQuality } from "../shared/protocol";
import { AuthArtwork } from "./AuthArtwork";
import { MediaArtwork } from "./ProviderPanel";
import { QualitySelect } from "./QualitySelect";
import { supportsWebVideoQuality, useEnqueueVideoQuality, videoQualityLabels } from "./video-quality";
import { QueueActions } from "./QueueActions";
import { SavedPlaylists } from "./SavedPlaylists";
import { createId, type Credentials } from "./session";
import "./queue-panel.css";

type Props = {
  state: SessionState | null;
  credentials: Credentials;
  connected: boolean;
  available: boolean;
  nativeHost: boolean;
  defaultQuality: VideoQuality;
  run: (action: Action) => Promise<boolean>;
};

function duration(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(value / 3_600);
  const minutes = Math.floor(value % 3_600 / 60);
  return `${hours ? `${hours}:${String(minutes).padStart(2, "0")}` : minutes}:${String(value % 60).padStart(2, "0")}`;
}

function sourceLabel(source: string) {
  try {
    const url = new URL(source.startsWith("web:") ? source.slice(4) : source);
    return { "file:": "Local file", "library:": "Your library", "jellyfin:": "Jellyfin", "radio:": "Radio playlist", "iptv:": "TV guide" }[url.protocol] ?? (url.host || "Media");
  } catch {
    return "Media";
  }
}

export function QueuePanel({ state, credentials, connected, available, nativeHost, defaultQuality, run }: Props) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState("");
  const [sourceKind, setSourceKind] = useState<"direct" | "webpage">("direct");
  const [title, setTitle] = useState("");
  const [quality, setQuality, resetQuality] = useEnqueueVideoQuality(defaultQuality);
  const offersVideoQuality = sourceKind === "webpage" && supportsWebVideoQuality(source);
  const [adding, setAdding] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const sourceRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const focusedEntry = useRef<{ element: HTMLElement; id: string; label: string | null } | null>(null);
  const queue = state?.queue ?? [];
  const currentIndex = queue.findIndex(entry => entry.id === state?.currentEntryId);
  const cursorIndex = currentIndex >= 0 ? currentIndex : queue.findIndex(entry => entry.id === state?.queueCursorEntryId);
  const previous = queue.map((entry, index) => ({ entry, index })).filter(({ index }) => index <= cursorIndex && index !== currentIndex);
  useLayoutEffect(() => {
    const focused = focusedEntry.current;
    if (!focused || focused.element.isConnected || document.activeElement !== document.body) return;
    const row = [...panelRef.current!.querySelectorAll<HTMLElement>("[data-queue-entry-id]")].find(row => row.dataset.queueEntryId === focused.id);
    const replacement = row?.closest("details:not([open])")?.querySelector<HTMLElement>("summary")
      ?? [...(row?.querySelectorAll<HTMLElement>("button") ?? [])].find(button => button.getAttribute("aria-label") === focused.label)
      ?? panelRef.current!.querySelector<HTMLElement>(".queue-previous summary, .queue-play:not(:disabled)");
    focusedEntry.current = null;
    replacement?.focus({ preventScroll: true });
  });

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!connected || adding) return;
    setError(null);
    let url: URL;
    try {
      url = new URL(source.trim());
      if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    } catch {
      setError("Enter a URL beginning with http:// or https://.");
      sourceRef.current?.focus();
      return;
    }
    if (url.username || url.password) {
      setError("Use a public link without a username or password.");
      sourceRef.current?.focus();
      return;
    }
    setAdding(true);
    try {
      const action: Action = sourceKind === "webpage"
        ? { type: "enqueueWeb", entryId: createId(), url: url.href, title: title.trim() || undefined, ...(offersVideoQuality ? { quality } : {}) }
        : { type: "enqueue", entry: { id: createId(), source: url.href, title: title.trim() || url.hostname } };
      if (await run(action)) {
        resetQuality();
        setSource("");
        setTitle("");
        setNotice("Added to the queue.");
        setOpen(false);
      } else setError("Could not add this link. Check the link and your connection, then try again.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not add this link.");
    } finally {
      setAdding(false);
    }
  };

  const chooseFile = async () => {
    if (!nativeHost || !connected || choosing) return;
    setChoosing(true);
    setFileError(null);
    setNotice("");
    try {
      const file = await invoke<{ source: string; title: string } | null>("choose_media");
      if (file) {
        if (await run({ type: "enqueue", entry: { id: createId(), ...file } })) setNotice(`Added ${file.title} to the queue.`);
        else setFileError("Could not add this file. Try again when connected.");
      }
    } catch (reason) {
      setFileError(reason instanceof Error ? reason.message : "Could not open this file.");
    } finally {
      setChoosing(false);
    }
  };

  const renderEntry = (entry: QueueEntry, index: number) => {
    const current = entry.id === state?.currentEntryId;
    const label = [sourceLabel(entry.source), entry.live ? "LIVE" : entry.duration ? duration(entry.duration) : "", entry.quality ? videoQualityLabels[entry.quality] : ""].filter(Boolean).join(" · ");
    return <li className={`queue-entry ${current ? "current" : ""}`} key={entry.id} data-queue-entry-id={entry.id} aria-current={current ? "true" : undefined}>
      <Button variant="ghost" size="icon" className="queue-play" aria-label={`Play ${entry.title}`} disabled={!available} onClick={() => void run({ type: "play", entryId: entry.id })}><span className="queue-number">{String(index + 1).padStart(2, "0")}</span><Play aria-hidden="true" /></Button>
      {entry.artworkId ? <AuthArtwork origin={credentials.origin} token={credentials.token} id={entry.artworkId} className="queue-artwork" /> : entry.thumbnail && <MediaArtwork key={entry.thumbnail} thumbnail={entry.thumbnail} title={entry.title} className="queue-artwork" />}
      <div className="queue-entry-copy"><span className="queue-entry-title" title={entry.title}>{entry.title}</span><span className="source-label" title={label}>{current && <span className="queue-current-label">On TV · </span>}{label}</span></div>
      <QueueActions credentials={credentials} entry={entry} index={index} queue={queue} connected={connected} canPlay={available} run={run} />
    </li>;
  };

  return <section ref={panelRef} className="queue-panel" aria-labelledby="queue-title" onFocusCapture={event => {
    const element = event.target, row = element.closest<HTMLElement>("[data-queue-entry-id]");
    focusedEntry.current = row ? { element, id: row.dataset.queueEntryId!, label: element.getAttribute("aria-label") } : null;
  }}>
    <div className="queue-header">
      <div className="queue-heading"><h2 id="queue-title">Play queue <span className="count">{queue.length}</span></h2><p>Everyone can choose what plays next.</p></div>
      <div className="queue-header-actions">
        <SavedPlaylists origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} version={state?.playlistVersion ?? 0} queueCount={queue.length} />
        {nativeHost && <Button variant="secondary" data-tv-local-only disabled={!connected || choosing} onClick={() => void chooseFile()}><FolderOpen aria-hidden="true" />{choosing ? "Opening…" : "Open file"}</Button>}
        <Dialog open={open} onOpenChange={value => { setOpen(value); if (value) { resetQuality(); setError(null); setNotice(""); } }}>
          <DialogTrigger asChild><Button disabled={!connected}><Plus aria-hidden="true" />Add media</Button></DialogTrigger>
          <DialogContent className="queue-add-dialog" onOpenAutoFocus={event => { event.preventDefault(); sourceRef.current?.focus(); }}>
            <DialogHeader><DialogTitle>Add media</DialogTitle><DialogDescription>Paste a link to add it to the TV queue.</DialogDescription></DialogHeader>
            <form className="queue-add-form" aria-busy={adding} onSubmit={event => void add(event)}>
              {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
              {!connected && <Alert><AlertDescription>Reconnect to add this link. Your draft is saved here.</AlertDescription></Alert>}
              <div className="queue-form-field"><Label htmlFor="media-kind">Link type</Label>
                <Select value={sourceKind} disabled={!connected || adding} onValueChange={value => setSourceKind(value as "direct" | "webpage")}>
                  <SelectTrigger id="media-kind"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="direct">Direct media</SelectItem><SelectItem value="webpage">Webpage</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="queue-form-field"><Label htmlFor="media-url">{sourceKind === "webpage" ? "Webpage URL" : "Direct media URL"}</Label>
                <Input ref={sourceRef} id="media-url" type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="https://…" maxLength={4096} value={source} onChange={event => setSource(event.target.value)} disabled={!connected || adding} required aria-describedby="media-link-help" />
                <p id="media-link-help" className="queue-form-help">{sourceKind === "webpage" ? "A video or album page from a supported site." : "A direct link to a video, audio file, or live stream."}</p>
              </div>
              <div className="queue-form-field"><Label htmlFor="media-title">Title <span className="optional">optional</span></Label><Input id="media-title" placeholder={sourceKind === "webpage" ? "Fetched automatically" : "Give it a name"} maxLength={200} value={title} onChange={event => setTitle(event.target.value)} disabled={!connected || adding} /></div>
              {offersVideoQuality && <QualitySelect id="media-quality" label="This video quality" description="Overrides your default for this video only." value={quality} disabled={!connected || adding} onChange={setQuality} />}
              <Button type="submit" className="queue-add-submit" disabled={!connected || adding || !source.trim()}><Plus aria-hidden="true" />{adding ? "Adding…" : "Add to queue"}</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </div>
    {fileError && <Alert variant="destructive" className="queue-feedback"><AlertDescription>{fileError}</AlertDescription></Alert>}
    {state?.queueError && <Alert variant="destructive" className="queue-feedback"><AlertDescription>{state.queueError}</AlertDescription></Alert>}
    {notice && <p className="queue-feedback queue-notice" role="status">{notice}</p>}
    {queue.length ? <>
      {currentIndex >= 0 && <section className="queue-group" aria-labelledby="queue-current-title"><h3 id="queue-current-title">Current item</h3><ol className="queue-list" aria-label="Current item">{renderEntry(queue[currentIndex]!, currentIndex)}</ol></section>}
      <section className="queue-group" aria-labelledby="queue-next-title"><h3 id="queue-next-title">Up next <span className="count">{queue.length - cursorIndex - 1}</span></h3>
        {cursorIndex + 1 < queue.length ? <ol className="queue-list" aria-label="Up next">{queue.slice(cursorIndex + 1).map((entry, index) => renderEntry(entry, cursorIndex + 1 + index))}</ol> : <p className="queue-group-empty">Nothing queued next. Add something to keep watching or listening.</p>}
      </section>
      {previous.length > 0 && <details className="queue-group queue-previous"><summary tabIndex={0}>Previously queued <span className="count">{previous.length}</span></summary><ol className="queue-list" aria-label="Previously queued">{previous.map(({ entry, index }) => renderEntry(entry, index))}</ol></details>}
    </> : <div className="queue-empty"><ListMusic aria-hidden="true" /><h3>What should play first?</h3><p>Browse your library, find a station, or add a link.</p></div>}
  </section>;
}
