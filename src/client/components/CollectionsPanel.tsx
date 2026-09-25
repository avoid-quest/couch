import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Pencil, Play, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CollectionDefinition, CollectionPreview, SavedCollection } from "../../shared/collections";
import { CollectionEditor } from "./CollectionEditor";

export function CollectionsPanel({ origin, token, connected, canPlay, version, active }: { origin: string; token: string; connected: boolean; canPlay: boolean; version: number; active: boolean }) {
  const [collections, setCollections] = useState<SavedCollection[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<CollectionPreview | null>(null);
  const [edit, setEdit] = useState<{ definition: CollectionDefinition; revision?: number } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const mutation = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const focusHeading = () => requestAnimationFrame(() => heading.current?.focus());

  useEffect(() => { setPending(false); return () => mutation.current?.abort(); }, [origin, token, connected]);
  useEffect(() => {
    if (!connected || !active) return;
    const controller = new AbortController();
    setLoading(true);
    const read = async (path: string) => {
      const response = await fetch(`${origin}${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load collections.");
      return result;
    };
    void Promise.all([read("/api/collections"), selected ? read(`/api/collections/${selected}`) : Promise.resolve(null)]).then(([list, detail]) => {
      if (!controller.signal.aborted) { setCollections(list.collections); setPreview(detail); }
    }).catch(reason => { if (!controller.signal.aborted) { setPreview(null); setError(reason instanceof Error ? reason.message : "Could not load collections."); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [origin, token, connected, active, selected, version, refresh]);

  const update = async (path: string, body: unknown, method = "POST") => {
    if (!connected || mutation.current && !mutation.current.signal.aborted) return null;
    const controller = new AbortController();
    mutation.current = controller;
    setPending(true); setError(null); setNotice(null);
    try {
      const response = await fetch(`${origin}/api/collections${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]), body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not update this collection.");
      return controller.signal.aborted ? null : result;
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not update this collection."); return null; }
    finally { if (!controller.signal.aborted) { setPending(false); setRefresh(value => value + 1); } if (mutation.current === controller) mutation.current = null; }
  };
  const select = (id: string | null) => { setSelected(id); setPreview(null); setEdit(null); setConfirm(false); setError(null); setNotice(null); focusHeading(); };
  const save = async () => {
    if (!edit) return;
    const result = await update(selected ? `/${selected}` : "", { definition: edit.definition, ...(edit.revision ? { revision: edit.revision } : {}) });
    if (result) { setSelected(result.collection.id); setPreview(result); setEdit(null); setNotice("Collection saved."); focusHeading(); }
  };
  const startEdit = () => {
    if (!preview) return;
    const { id: _id, revision, updatedAt: _updatedAt, ...definition } = preview.collection;
    setEdit({ definition: structuredClone(definition), revision }); setConfirm(false); setError(null); setNotice(null);
  };
  const load = async (mode: "append" | "play") => {
    if (!preview) return;
    if (await update(`/${preview.collection.id}/load`, { revision: preview.collection.revision, digest: preview.digest, mode })) setNotice(mode === "play" ? "Starting the available preview items on the TV." : "Added the available preview items to the queue.");
  };
  const disabled = !connected || pending;
  const available = preview?.items.filter(item => item.available).length ?? 0;
  return <section className="collections-panel grid min-w-0 gap-4" aria-label="Library collections">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 ref={heading} tabIndex={-1} className="min-w-0 break-words text-xl font-semibold">{edit ? edit.revision ? "Edit collection" : "New collection" : preview?.collection.name ?? "Collections and filters"}</h3>{(selected || edit) && <Button variant="ghost" disabled={pending} onClick={() => select(null)}><ArrowLeft />All collections</Button>}</div>
    {!connected && <p role="status">Reconnect to browse and edit collections.</p>}
    {error && <div role="alert" className="grid gap-2 border-l-2 border-destructive py-2 pl-3 text-destructive"><p>{error}</p><Button variant="outline" className="justify-self-start" disabled={disabled} onClick={() => { setError(null); setRefresh(value => value + 1); }}>Reload collections</Button></div>}
    {notice && <p role="status" className="text-sm text-primary">{notice}</p>}
    {edit ? <div className="grid gap-4 border-t pt-4">
      {edit.revision && preview && edit.revision !== preview.collection.revision && <p role="alert" className="border-l-2 border-primary py-2 pl-3">Another controller saved changes. Your draft is still here. Cancel editing to use the latest definition.</p>}
      <CollectionEditor value={edit.definition} onChange={definition => setEdit({ ...edit, definition })} disabled={disabled} origin={origin} token={token} version={version} />
      <div className="flex flex-wrap gap-2"><Button disabled={disabled || !edit.definition.name.trim()} onClick={() => void save()}><Save />Save collection</Button><Button variant="outline" disabled={pending} onClick={() => { setEdit(null); setError(null); focusHeading(); }}>Cancel editing</Button></div>
    </div> : selected ? <>
      {loading && <p role="status">Refreshing preview…</p>}
      {preview && <>
        <div className="flex flex-wrap gap-2"><Button disabled={disabled || loading || !canPlay || !available} onClick={() => void load("play")}><Play />Play preview</Button><Button variant="outline" disabled={disabled || loading || !available} onClick={() => void load("append")}><Plus />Up next</Button><Button variant="outline" disabled={disabled || loading} onClick={startEdit}><Pencil />Edit collection</Button></div>
        <p className="text-sm text-muted-foreground">{available} available · {preview.items.length - available} missing. {preview.total > 500 ? `Showing the first 500 of ${preview.total} matches. ` : ""}Play replaces the queue. Missing items are skipped. Order: {preview.collection.sort === "manual" ? "my order" : preview.collection.sort === "album" ? "album, disc and track" : preview.collection.sort}, {preview.collection.descending ? "descending" : "ascending"}.</p>
        <ol className="max-h-[60dvh] divide-y overflow-y-auto" aria-label="Collection preview">{preview.items.map((item, index) => <li key={item.id} tabIndex={0} aria-label={`${index + 1}. ${item.title}, ${item.available ? "available" : "missing"}`} className="flex min-w-0 items-center gap-3 py-3 focus-visible:outline-2 focus-visible:outline-primary"><span className="shrink-0 text-sm text-muted-foreground">{index + 1}</span><div className="min-w-0 flex-1"><strong className="break-words text-sm">{item.title}</strong><p className="break-words text-sm text-muted-foreground">{[item.artist, item.album, item.video?.show?.title, item.video?.year].filter(Boolean).join(" · ")}</p></div><span className="shrink-0 text-sm">{item.available ? "Available" : "Missing"}</span></li>)}</ol>
        {!preview.items.length && <p>No matching items. Edit the definition or scan your folders again.</p>}
        <Button className="justify-self-start" variant="destructive" disabled={disabled} onClick={() => setConfirm(true)}><Trash2 />Delete collection</Button>
        {confirm && <div className="grid gap-3 border-t pt-3"><p>Delete {preview.collection.name}?</p><div className="flex flex-wrap gap-2"><Button variant="destructive" disabled={disabled} onClick={() => void update(`/${selected}`, { revision: preview.collection.revision }, "DELETE").then(result => { if (result) select(null); })}>Confirm delete</Button><Button variant="outline" disabled={pending} onClick={() => setConfirm(false)}>Cancel</Button></div></div>}
      </>}
    </> : <>
      <p className="text-sm text-muted-foreground">Keep a film collection or save a movie, show or music filter. Everyone paired with this TV shares saved definitions.</p>
      <Button className="justify-self-start" disabled={disabled || collections.length >= 100} onClick={() => { setError(null); setEdit({ definition: { name: "", filter: null, members: [], sort: "manual", descending: false } }); }}><Plus />New collection</Button>
      {loading && <p role="status">Loading collections…</p>}
      <ul className="divide-y" aria-label="Saved collections">{collections.map(collection => <li key={collection.id}><Button variant="ghost" className="h-auto min-h-11 w-full justify-between gap-3 rounded-none px-0 py-3 text-left whitespace-normal" disabled={disabled} onClick={() => select(collection.id)}><span className="min-w-0 break-words">{collection.name}</span><span className="shrink-0 text-sm text-muted-foreground">{collection.filter ? "Saved filter" : `${collection.members.length} movies`}</span></Button></li>)}</ul>
    </>}
  </section>;
}
