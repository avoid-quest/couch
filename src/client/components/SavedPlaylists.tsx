import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Bookmark, ListMusic, Play, Plus, Trash2, X } from "lucide-react";
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { SortableRow, useDndSensors } from "@/lib/dnd";
import type { PlaylistLoadMode, SavedPlaylist, SavedPlaylistSummary } from "../../shared/playlists";

const providerLabels = { youtube: "YouTube", raiplay: "RaiPlay", bandcamp: "Bandcamp", streamingcommunity: "StreamingCommunity" };

export function SavedPlaylists({ origin, token, connected, canPlay, version, queueCount, inline = false }: {
  origin: string;
  token: string;
  connected: boolean;
  canPlay: boolean;
  version: number;
  queueCount: number;
  inline?: boolean;
}) {
  const [dialogOpen, setOpen] = useState(false);
  const open = inline || dialogOpen;
  const [playlists, setPlaylists] = useState<SavedPlaylistSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [playlist, setPlaylist] = useState<SavedPlaylist | null>(null);
  const [name, setName] = useState("");
  const [rename, setRename] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"saveQueue" | null>(null);
  const [undo, setUndo] = useState<{ token: string; name: string } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sensors = useDndSensors();
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const mutation = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const entriesRef = useRef<HTMLOListElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setPending(false);
    setUndo(null);
    return () => { mutation.current?.abort(); if (undoTimer.current) clearTimeout(undoTimer.current); };
  }, [origin, token, connected, open]);

  useEffect(() => {
    if (!open || !connected) return;
    const controller = new AbortController();
    setLoading(true);
    const read = async (path: string) => {
      const response = await fetch(`${origin}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 404 && selectedId && !controller.signal.aborted) {
          setSelectedId(null);
          setPlaylist(null);
          requestAnimationFrame(() => (listRef.current?.querySelector<HTMLButtonElement>("button") ?? nameRef.current)?.focus());
        }
        throw new Error(result.error || "Could not load saved lists.");
      }
      return result;
    };
    void Promise.all([
      read("/api/playlists"),
      selectedId ? read(`/api/playlists/${encodeURIComponent(selectedId)}`) : Promise.resolve(null),
    ]).then(([list, detail]) => {
      if (!controller.signal.aborted) {
        setPlaylists(Array.isArray(list.playlists) ? list.playlists : []);
        setPlaylist(detail?.playlist ?? null);
      }
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load saved lists.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [origin, token, connected, open, selectedId, version, refresh]);

  const update = async (path: string, body: unknown, message: string, method = "POST") => {
    if (!connected || (mutation.current && !mutation.current.signal.aborted)) return false;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const controller = new AbortController();
    mutation.current = controller;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`${origin}${path}`, {
        method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]), body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not update this list.");
      if (controller.signal.aborted) return false;
      if (result.playlist?.id === selectedId) setPlaylist(result.playlist);
      setNotice(message);
      setConfirm(null);
      return result;
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not update this list.");
      return false;
    } finally {
      if (!controller.signal.aborted) {
        setPending(false);
        setRefresh(value => value + 1);
        requestAnimationFrame(() => { if (opener?.isConnected && !opener.matches(":disabled")) opener.focus(); });
      }
      if (mutation.current === controller) mutation.current = null;
    }
  };

  const select = (id: string | null) => {
    const previousId = selectedId;
    setSelectedId(id);
    setPlaylist(null);
    setRename(null);
    setConfirm(null);
    setError(null);
    setNotice(null);
    requestAnimationFrame(() => {
      if (id) backRef.current?.focus();
      else {
        const buttons = [...listRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []];
        (buttons.find(button => button.dataset.playlistId === previousId) ?? buttons[0] ?? nameRef.current)?.focus();
      }
    });
  };
  const path = playlist ? `/api/playlists/${encodeURIComponent(playlist.id)}` : "";
  const disabled = !connected || pending;
  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (await update("/api/playlists", { name: name.trim() }, `Kept ${name.trim()}.`)) setName("");
  };
  const load = (mode: PlaylistLoadMode) => playlist && update(`${path}/load`, { revision: playlist.revision, mode },
    mode === "append" ? `Added ${playlist.name} to Up next.` : mode === "play" ? `Starting ${playlist.name} on the TV.` : `Loaded ${playlist.name}. Press Play to start.`);
  const deleteList = async () => {
    if (!playlist) return;
    const name = playlist.name;
    const result = await update(path, { revision: playlist.revision }, `Deleted ${name}.`, "DELETE");
    if (!result?.undoToken) return;
    select(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo({ token: result.undoToken, name });
    undoTimer.current = setTimeout(() => setUndo(null), 6_000);
  };
  const restoreList = async () => {
    if (!undo) return;
    const result = await update("/api/playlists/restore", { token: undo.token }, `Restored ${undo.name}.`);
    if (result) { setUndo(null); if (undoTimer.current) clearTimeout(undoTimer.current); }
  };

  const content = <>
      {inline ? <header className="saved-playlist-heading">
        <div><h2 className="text-xl font-semibold tracking-tight">{playlist?.name ?? "Lists"}</h2><p className="text-sm text-muted-foreground">Shared on this TV. Keep the current Up next to play it again.</p></div>
      </header> : <DialogHeader>
        <DialogTitle className="break-words pr-12">{playlist?.name ?? "Saved lists"}</DialogTitle>
        <DialogDescription>{selectedId ? "Edit this list or load it into Up next." : "Lists are shared on this TV and stay available when the watching profile changes. Keep the current Up next to reuse it later."}</DialogDescription>
      </DialogHeader>}
      {selectedId && <Button ref={backRef} variant="ghost" className="justify-self-start" disabled={pending} onClick={() => select(null)}><ArrowLeft aria-hidden="true" />All lists</Button>}
      {!connected && <Alert><AlertDescription>Reconnect to load or edit lists.</AlertDescription></Alert>}
      {error && <Alert variant="destructive" className="gap-2"><AlertDescription>{error}</AlertDescription><Button variant="outline" className="justify-self-start" disabled={disabled} onClick={() => { setError(null); setRefresh(value => value + 1); }}>Reload lists</Button></Alert>}
      {notice && <p className="text-sm text-primary" role="status">{notice}</p>}
      {undo && <div className="saved-undo-notice" role="status"><span>Deleted {undo.name}.</span><Button variant="ghost" disabled={disabled} onClick={() => void restoreList()}>Undo</Button></div>}
      {loading && <p className="text-sm text-muted-foreground" role="status">Loading lists…</p>}
      {!selectedId ? <>
        <form className="grid gap-2" onSubmit={event => void create(event)}>
          <Label htmlFor="saved-playlist-name" className="sr-only">Name the current Up next</Label>
          <div className="flex flex-wrap gap-2">
            <Input ref={nameRef} id="saved-playlist-name" className="min-h-11 min-w-0 flex-1" value={name} onChange={event => setName(event.target.value)} placeholder="List name" maxLength={80} required autoComplete="off" disabled={disabled} />
            <Button type="submit" disabled={disabled || !name.trim() || !queueCount || playlists.length >= 100}><Bookmark aria-hidden="true" />Keep</Button>
          </div>
          <p className="text-sm text-muted-foreground">{queueCount ? `${queueCount} ${queueCount === 1 ? "item" : "items"} in Up next.` : "Add something to Up next before keeping it."}{playlists.length >= 100 && " Delete a list before keeping another."}</p>
        </form>
        <Separator />
        {!loading && !playlists.length && <p className="text-sm text-muted-foreground">Your kept lists will appear here.</p>}
        <ul ref={listRef} className="grid max-h-80 gap-2 overflow-y-auto p-1" aria-label="Saved lists" aria-busy={loading}>{playlists.map(item => <li key={item.id}>
          <Button variant="outline" className="h-auto min-h-11 w-full justify-between gap-3 py-3 text-left whitespace-normal" data-playlist-id={item.id} disabled={disabled} onClick={() => select(item.id)}>
            <span className="min-w-0 break-words">{item.name}</span>
            <span className="flex shrink-0 items-center gap-2">
              {item.source && <Badge variant="secondary">{providerLabels[item.source.provider]}</Badge>}
              <span className="text-sm text-muted-foreground">{item.entryCount} {item.entryCount === 1 ? "item" : "items"}</span>
            </span>
          </Button>
        </li>)}</ul>
      </> : playlist && <>
        <div className="flex flex-wrap gap-2" aria-label="Load list">
          <Button disabled={disabled || !canPlay || !playlist.entries.length} onClick={() => void load("play")}><Play aria-hidden="true" />Play</Button>
          <Button variant="outline" disabled={disabled || !playlist.entries.length} onClick={() => void load("append")}><Plus aria-hidden="true" />Up next</Button>
          <Button variant="outline" disabled={disabled || !playlist.entries.length} onClick={() => void load("replace")}>Replace</Button>
        </div>
        <p className="text-sm text-muted-foreground">Play replaces Up next and starts the first item. Replace stops playback and loads these items.</p>
        <form className="grid gap-2" onSubmit={event => {
          event.preventDefault();
          void update(path, { revision: playlist.revision, operation: "rename", name: (rename ?? playlist.name).trim() }, "List renamed.").then(ok => { if (ok) setRename(null); });
        }}>
          <Label htmlFor="rename-playlist">List name</Label>
          <div className="flex flex-wrap gap-2">
            <Input id="rename-playlist" className="min-h-11 min-w-0 flex-1" value={rename ?? playlist.name} onChange={event => setRename(event.target.value)} maxLength={80} required autoComplete="off" disabled={disabled} />
            <Button variant="outline" type="submit" disabled={disabled || !(rename ?? "").trim() || rename?.trim() === playlist.name}>Rename</Button>
          </div>
        </form>
        <DndContext sensors={sensors} onDragEnd={({ active, over }) => {
          if (!over || active.id === over.id) return;
          const from = playlist.entries.findIndex(entry => entry.id === String(active.id)), to = playlist.entries.findIndex(entry => entry.id === String(over.id));
          if (from < 0 || to < 0) return;
          const beforeEntryId = to > from ? playlist.entries[to + 1]?.id ?? null : playlist.entries[to]!.id;
          void update(path, { revision: playlist.revision, operation: "move", entryId: String(active.id), beforeEntryId }, "List order kept.");
        }}>
          <SortableContext items={playlist.entries.map(entry => entry.id)} strategy={verticalListSortingStrategy}>
        <ol ref={entriesRef} className="grid max-h-80 gap-2 overflow-y-auto p-1" aria-label="List items" aria-busy={loading}>{playlist.entries.map((entry, index) => <SortableRow key={entry.id} id={entry.id} label={`Reorder ${entry.title}`} editing>{drag => <li ref={drag.setNodeRef} style={drag.style} className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
          {drag.handle}
          <span className="w-6 shrink-0 text-center text-sm text-muted-foreground">{index + 1}</span>
          <span className="min-w-0 flex-1 break-words text-sm">{entry.title}{entry.live && <span className="ml-2 text-xs text-muted-foreground">LIVE</span>}</span>
          <div className="flex shrink-0 gap-1">
            <Button variant="ghost" size="icon" aria-label={`Remove ${entry.title} from list`} disabled={disabled} onClick={() => void update(path, { revision: playlist.revision, operation: "remove", entryId: entry.id }, "Item removed from list.").then(ok => {
              if (ok) requestAnimationFrame(() => {
                const rows = entriesRef.current?.children;
                const row = rows?.[Math.min(index, rows.length - 1)];
                (row?.querySelector<HTMLButtonElement>("button:not(:disabled)") ?? backRef.current)?.focus();
              });
            })}><X aria-hidden="true" /></Button>
          </div>
        </li>}</SortableRow>)}</ol></SortableContext></DndContext>
        {!playlist.entries.length && <p className="text-sm text-muted-foreground">This list is empty. Fill Up next, then keep it here.</p>}
        <Separator />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={disabled || !queueCount} onClick={() => setConfirm("saveQueue")}><Bookmark aria-hidden="true" />Update from Up next</Button>
          <Button variant="ghost" disabled={disabled} onClick={() => void deleteList()}><Trash2 aria-hidden="true" />Delete list</Button>
        </div>
        {confirm && <div className="grid gap-3 rounded-lg border p-3">
          <p className="text-sm">Replace the kept contents of {playlist.name} with the current {queueCount} Up next items?</p>
          <div className="flex flex-wrap gap-2">
            <Button disabled={disabled || !queueCount} onClick={() => void update(path, { revision: playlist.revision, operation: "saveQueue" }, "List updated from Up next.")}>Replace saved items</Button>
            <Button variant="outline" disabled={pending} onClick={() => setConfirm(null)}>Cancel</Button>
          </div>
        </div>}
      </>}
    </>;
  if (inline) return <section className="saved-playlists saved-playlists-inline" aria-label="Saved lists">{content}</section>;
  return <Dialog open={open} onOpenChange={value => { setOpen(value); setError(null); setNotice(null); setConfirm(null); }}>
    <DialogTrigger asChild><Button variant="outline" className="min-h-11" disabled={!connected}><ListMusic aria-hidden="true" />Saved lists</Button></DialogTrigger>
    <DialogContent className="saved-playlists">{content}</DialogContent>
  </Dialog>;
}
