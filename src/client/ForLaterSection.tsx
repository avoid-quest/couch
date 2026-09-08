import { useEffect, useRef, useState } from "react";
import { Play, Plus, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AuthArtwork } from "./AuthArtwork";
import { MediaArtwork } from "./ProviderPanel";
import { Button } from "@/components/ui/button";
import type { ForLaterItem } from "../shared/for-later";

export function ForLaterSection({ origin, token, connected, canPlay, version, inspect = false, onFind }: {
  origin: string; token: string; connected: boolean; canPlay: boolean; version: number; inspect?: boolean; onFind?: () => void;
}) {
  const [detail, setDetail] = useState<ForLaterItem | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const [items, setItems] = useState<ForLaterItem[]>([]);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const list = useRef<HTMLUListElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const mutation = useRef<AbortController | null>(null);
  useEffect(() => { setPending(false); setItems([]); setDetail(null); setNotice(""); return () => mutation.current?.abort(); }, [origin, token, connected]);
  useEffect(() => {
    if (!connected) return;
    const controller = new AbortController();
    setLoading(true); setError("");
    void fetch(`${origin}/api/for-later`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not load For later.");
      if (!controller.signal.aborted) setItems(body.items);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load For later."); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [origin, token, connected, version, refresh]);
  const update = async (item: ForLaterItem, mode: "play" | "append" | "remove", index: number) => {
    if (!connected || pending) return;
    const controller = new AbortController();
    mutation.current = controller;
    setPending(true); setError(""); setNotice("");
    try {
      const response = await fetch(`${origin}/api/for-later/${encodeURIComponent(item.id)}${mode === "remove" ? "" : "/load"}`, { method: mode === "remove" ? "DELETE" : "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, ...(mode === "remove" ? {} : { body: JSON.stringify({ mode }) }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not use this saved item.");
      if (controller.signal.aborted) return;
      setNotice(body.notice ?? (mode === "remove" ? `Removed ${item.title} from For later.` : mode === "play" ? `Starting ${item.title} on the TV.` : `Added ${item.title} to Up next.`));
      if (mode === "remove") {
        setDetail(null);
        setItems(current => current.filter(entry => entry.id !== item.id));
        requestAnimationFrame(() => {
          const rows = list.current?.children;
          (rows?.[Math.min(index, rows.length - 1)]?.querySelector<HTMLButtonElement>("button:not(:disabled)") ?? heading.current)?.focus();
        });
      }
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not use this saved item."); }
    finally { if (!controller.signal.aborted) setPending(false); }
  };
  const actions = (item: ForLaterItem, index: number) => <div className="flex flex-wrap gap-2">
    <Button disabled={!connected || !canPlay || pending} aria-label={`Play ${item.title}`} onClick={() => void update(item, "play", index)}><Play aria-hidden="true" />Play</Button>
    <Button variant="outline" disabled={!connected || pending} aria-label={`Add ${item.title} to Up next`} onClick={() => void update(item, "append", index)}><Plus aria-hidden="true" />Up next</Button>
    <Button variant="ghost" disabled={!connected || pending} aria-label={`Remove ${item.title} from For later`} onClick={() => void update(item, "remove", index)}><X aria-hidden="true" />Remove</Button>
  </div>;
  return <section className="catalog-panel space-y-4" aria-labelledby="for-later-title">
    <div><h2 ref={heading} tabIndex={-1} id="for-later-title" className="text-xl font-semibold">For later</h2><p className="text-sm text-muted-foreground">Shared by everyone on this TV. Items saved from your library or queue stay here until you remove them.</p></div>
    {!connected && <p role="status">Reconnect to see your saved items.</p>}
    {loading && <p role="status">Loading saved items…</p>}
    {error && <div role="alert" className="space-y-2"><p>{error}</p><Button variant="outline" disabled={!connected || loading || pending} onClick={() => setRefresh(value => value + 1)}>Refresh For later</Button></div>}
    {notice && <p role="status">{notice}</p>}
    {connected && !loading && !error && !items.length && <div className="space-y-2"><p>Nothing saved for later yet. Save something you want to watch or listen to.</p>{onFind && <Button variant="outline" onClick={onFind}>Search for something to save</Button>}</div>}
    <ul ref={list} className="space-y-2" aria-label="Saved for later" aria-busy={loading}>{items.map((item, index) => <li key={item.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
      {inspect ? <>
        {item.artworkId ? <AuthArtwork origin={origin} token={token} id={item.artworkId} video={item.kind !== "radio"} className="saved-item-art" /> : <MediaArtwork key={item.thumbnail || item.id} thumbnail={item.thumbnail} title={item.title} className="saved-item-art" />}
        <Button variant="ghost" className="saved-item-title" aria-label={`Details for ${item.title}`} onClick={event => { trigger.current = event.currentTarget; setDetail(item); }}><strong>{item.title}</strong>{item.live && <small>Live</small>}</Button>
        {actions(item, index)}
      </> : <><strong className="min-w-0 flex-1 break-words">{item.title}</strong>{actions(item, index)}</>}

    </li>)}</ul>
    {inspect && <Dialog open={detail !== null} onOpenChange={open => { if (!open) setDetail(null); }}><DialogContent onCloseAutoFocus={event => { event.preventDefault(); if (trigger.current?.isConnected) trigger.current.focus(); }}>
      {detail && <>{detail.artworkId ? <AuthArtwork origin={origin} token={token} id={detail.artworkId} video={detail.kind !== "radio"} className="saved-detail-art" /> : <MediaArtwork key={detail.thumbnail || detail.id} thumbnail={detail.thumbnail} title={detail.title} className="saved-detail-art" />}<DialogHeader><DialogTitle>{detail.title}</DialogTitle><DialogDescription>Saved for later · shared on this TV</DialogDescription></DialogHeader>{actions(detail, items.findIndex(item => item.id === detail.id))}{notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}</>}
    </DialogContent></Dialog>}
  </section>;
}
