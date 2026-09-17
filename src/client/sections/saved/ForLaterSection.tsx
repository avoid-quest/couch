import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Play, Plus, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { AuthArtwork } from "@/components/AuthArtwork";
import { MediaArtwork } from "@/components/MediaArtwork";
import type { ForLaterItem } from "../../../shared/for-later";
import { forLaterQuery } from "@/api/for-later";

export function ForLaterSection({ origin, token, connected, canPlay, inspect = false, onFind }: {
  origin: string; token: string; connected: boolean; canPlay: boolean; inspect?: boolean; onFind?: () => void;
}) {
  // For later reads through Query; the session invalidates ["for-later"] on
  // socket revisions, replacing the version prop this section drilled down.
  const queryClient = useQueryClient();
  const { data, isPending, error: loadError, refetch } = useQuery({ ...forLaterQuery({ origin, token }), enabled: connected });
  const items = connected ? data?.items ?? [] : [];
  const loading = connected && isPending;
  const error = connected && loadError ? loadError instanceof Error ? loadError.message : "Could not load For later." : "";
  const [detail, setDetail] = useState<ForLaterItem | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const list = useRef<HTMLUListElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const mutation = useRef<AbortController | null>(null);
  useEffect(() => { setPending(false); setDetail(null); setNotice(""); setActionError(""); return () => mutation.current?.abort(); }, [origin, token, connected]);
  const update = async (item: ForLaterItem, mode: "play" | "append" | "remove", index: number) => {
    if (!connected || pending) return;
    const controller = new AbortController();
    mutation.current = controller;
    setPending(true); setActionError(""); setNotice("");
    try {
      const response = await fetch(`${origin}/api/for-later/${encodeURIComponent(item.id)}${mode === "remove" ? "" : "/load"}`, { method: mode === "remove" ? "DELETE" : "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, ...(mode === "remove" ? {} : { body: JSON.stringify({ mode }) }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not use this saved item.");
      if (controller.signal.aborted) return;
      setNotice(body.notice ?? (mode === "remove" ? `Removed ${item.title} from For later.` : mode === "play" ? `Starting ${item.title} on the TV.` : `Added ${item.title} to Up next.`));
      if (mode === "remove") {
        setDetail(null);
        await queryClient.invalidateQueries({ queryKey: ["for-later"] });
        requestAnimationFrame(() => {
          const rows = list.current?.children;
          (rows?.[Math.min(index, rows.length - 1)]?.querySelector<HTMLButtonElement>("button:not(:disabled)") ?? heading.current)?.focus();
        });
      }
    } catch (reason) { if (!controller.signal.aborted) setActionError(reason instanceof Error ? reason.message : "Could not use this saved item."); }
    finally { if (!controller.signal.aborted) setPending(false); }
  };
  const actions = (item: ForLaterItem, index: number) => <div className="flex flex-wrap gap-2">
    <Button className="min-h-11" disabled={!connected || !canPlay || pending} aria-label={`Play ${item.title}`} onClick={() => void update(item, "play", index)}><Play aria-hidden="true" />Play</Button>
    <Button className="min-h-11" variant="outline" disabled={!connected || pending} aria-label={`Add ${item.title} to Up next`} onClick={() => void update(item, "append", index)}><Plus aria-hidden="true" />Up next</Button>
    <Button className="min-h-11" variant="ghost" disabled={!connected || pending} aria-label={`Remove ${item.title} from For later`} onClick={() => void update(item, "remove", index)}><X aria-hidden="true" />Remove</Button>
  </div>;
  return <section className="space-y-4" aria-labelledby="for-later-title">
    <div><h2 ref={heading} tabIndex={-1} id="for-later-title" className="text-xl font-semibold">For later</h2></div>
    {!connected && <p role="status">Reconnect to see your saved items.</p>}
    {loading && <p className="flex items-center gap-2" role="status"><Spinner className="size-3.5" />Loading saved items…</p>}
    {error && <div role="alert" className="space-y-2"><p>{error}</p><Button variant="outline" disabled={!connected || loading || pending} onClick={() => void refetch()}>Refresh For later</Button></div>}
    {actionError && <p role="alert">{actionError}</p>}
    {notice && <p role="status">{notice}</p>}
    {connected && !loading && !error && !items.length && <div className="space-y-2"><p>No saved titles.</p>{onFind && <Button variant="outline" onClick={onFind}>Search</Button>}</div>}
    <ul ref={list} className="list-none space-y-2 p-0" aria-label="Saved for later" aria-busy={loading}>{items.map((item, index) => <li key={item.id} className="flex flex-wrap items-center gap-3 border-b py-3">
      {inspect ? <>
        {item.artworkId ? <AuthArtwork origin={origin} token={token} id={item.artworkId} video={item.kind !== "radio"} className="h-[54px] w-[46px] rounded-md" /> : <MediaArtwork key={item.thumbnail || item.id} thumbnail={item.thumbnail} title={item.title} className="h-[54px] w-[46px] rounded-md" />}
        <Button variant="ghost" className="h-auto min-h-11 min-w-0 flex-1 flex-col items-start justify-start gap-1.5 p-0 text-left whitespace-normal" aria-label={`Details for ${item.title}`} onClick={event => { trigger.current = event.currentTarget; setDetail(item); }}><strong className="text-sm font-semibold [overflow-wrap:anywhere]">{item.title}</strong>{item.live && <small className="text-[11px] text-muted-foreground">Live</small>}</Button>
        {actions(item, index)}
      </> : <><strong className="min-w-0 flex-1 break-words">{item.title}</strong>{actions(item, index)}</>}

    </li>)}</ul>
    {inspect && <Dialog open={detail !== null} onOpenChange={open => { if (!open) setDetail(null); }}><DialogContent onCloseAutoFocus={event => { event.preventDefault(); if (trigger.current?.isConnected) trigger.current.focus(); }}>
      {detail && <>{detail.artworkId ? <AuthArtwork origin={origin} token={token} id={detail.artworkId} video={detail.kind !== "radio"} className="aspect-[1.9] w-full" /> : <MediaArtwork key={detail.thumbnail || detail.id} thumbnail={detail.thumbnail} title={detail.title} className="aspect-[1.9] w-full" />}<DialogHeader><DialogTitle>{detail.title}</DialogTitle><DialogDescription>Saved for later</DialogDescription></DialogHeader>{actions(detail, items.findIndex(item => item.id === detail.id))}{notice && <p role="status">{notice}</p>}{actionError && <p role="alert">{actionError}</p>}</>}
    </DialogContent></Dialog>}
  </section>;
}
