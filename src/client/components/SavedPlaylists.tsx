import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Bookmark, ListMusic, Play, Plus, Trash2, X } from "lucide-react";
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { SortableRow, useDndSensors } from "@/lib/dnd";
import { ApiError, apiSend } from "@/api/client";
import { playlistQuery, playlistsQuery } from "@/api/playlists";
import type { PlaylistLoadMode, SavedPlaylist } from "../../shared/playlists";

const providerLabels = { youtube: "YouTube", raiplay: "RaiPlay", bandcamp: "Bandcamp", streamingcommunity: "StreamingCommunity" };

export function SavedPlaylists({ origin, token, connected, canPlay, queueCount, inline = false }: {
  origin: string;
  token: string;
  connected: boolean;
  canPlay: boolean;
  queueCount: number;
  inline?: boolean;
}) {
  const credentials = { origin, token };
  const queryClient = useQueryClient();
  const [dialogOpen, setOpen] = useState(false);
  const open = inline || dialogOpen;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rename, setRename] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"saveQueue" | null>(null);
  const undoToast = useRef<string | number | null>(null);
  const sensors = useDndSensors();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const entriesRef = useRef<HTMLOListElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  // The server bumps the playlists revision after every change, from any remote.
  const list = useQuery({ ...playlistsQuery(credentials), enabled: open && connected });
  const detail = useQuery({ ...playlistQuery(credentials, selectedId ?? ""), enabled: open && connected && !!selectedId });
  const playlists = list.data?.playlists ?? [];
  const playlist = selectedId ? detail.data?.playlist ?? null : null;
  const loading = list.isLoading || detail.isLoading;
  const missing = detail.error instanceof ApiError && detail.error.status === 404;
  const loadError = list.error ?? (missing ? null : detail.error);
  const mutation = useMutation({
    mutationFn: ({ path, body, method }: { path: string; body: unknown; method: string }) => apiSend<{ playlist?: SavedPlaylist; undoToken?: string }>(credentials, path, body, method, 30_000),
    onSuccess: result => { if (result.playlist) queryClient.setQueryData(playlistQuery(credentials, result.playlist.id).queryKey, { playlist: result.playlist }); },
  });
  const pending = mutation.isPending;

  useEffect(() => () => { if (undoToast.current != null) toast.dismiss(undoToast.current); }, [open]);
  useEffect(() => {
    if (!missing) return;
    setSelectedId(null);
    requestAnimationFrame(() => (listRef.current?.querySelector<HTMLButtonElement>("button") ?? keepRef.current)?.focus());
  }, [missing]);

  const update = async (path: string, body: unknown, message: string, method = "POST") => {
    if (!connected || pending) return false;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setError(null);
    setNotice(null);
    try {
      const result = await mutation.mutateAsync({ path, body, method });
      setNotice(message);
      setConfirm(null);
      return result;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update this list.");
      return false;
    } finally {
      requestAnimationFrame(() => { if (opener?.isConnected && !opener.matches(":disabled")) opener.focus(); });
    }
  };

  const select = (id: string | null) => {
    const previousId = selectedId;
    setSelectedId(id);
    setRename(null);
    setConfirm(null);
    setError(null);
    setNotice(null);
    requestAnimationFrame(() => {
      if (id) backRef.current?.focus();
      else {
        const buttons = [...listRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []];
        (buttons.find(button => button.dataset.playlistId === previousId) ?? buttons[0] ?? keepRef.current)?.focus();
      }
    });
  };
  const path = playlist ? `/api/playlists/${encodeURIComponent(playlist.id)}` : "";
  const disabled = !connected || pending;
  const create = () => {
    const name = `Up next, ${new Date().toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`;
    void update("/api/playlists", { name, scope: "upNext" }, `Kept ${name} in Saved.`);
  };
  const load = (mode: PlaylistLoadMode) => playlist && update(`${path}/load`, { revision: playlist.revision, mode },
    mode === "append" ? `Added ${playlist.name} to Up next.` : mode === "play" ? `Starting ${playlist.name} on the TV.` : `Loaded ${playlist.name}. Press Play to start.`);
  const deleteList = async () => {
    if (!playlist) return;
    const name = playlist.name;
    const result = await update(path, { revision: playlist.revision }, `Deleted ${name}.`, "DELETE");
    const undoToken = result ? result.undoToken : undefined;
    if (!undoToken) return;
    select(null);
    if (undoToast.current != null) toast.dismiss(undoToast.current);
    undoToast.current = toast(`Deleted ${name}.`, { duration: 6_000, action: { label: "Undo", onClick: () => void restoreList(undoToken, name) } });
  };
  const restoreList = async (token: string, name: string) => {
    const result = await update("/api/playlists/restore", { token }, `Restored ${name}.`);
    if (result && undoToast.current != null) { toast.dismiss(undoToast.current); undoToast.current = null; }
  };

  const content = <>
      {inline ? <header className="saved-playlist-heading">
        <h2 className="text-xl font-semibold tracking-tight">{playlist?.name ?? "Lists"}</h2>
      </header> : <DialogHeader>
        <DialogTitle className="break-words pr-12">{playlist?.name ?? "Saved lists"}</DialogTitle>
        <DialogDescription>{selectedId ? "Edit this list or load it into Up next." : "Lists are shared on this TV and stay available when the watching profile changes. Keep the current Up next to reuse it later."}</DialogDescription>
      </DialogHeader>}
      {selectedId && <Button ref={backRef} variant="ghost" className="justify-self-start" disabled={pending} onClick={() => select(null)}><ArrowLeft aria-hidden="true" />All lists</Button>}
      {!connected && <p role="status" className="border-l-2 border-primary py-2 pl-3">Reconnect to load or edit lists.</p>}
      {(error || loadError) && <div role="alert" className="grid gap-2 border-l-2 border-destructive py-2 pl-3 text-destructive"><p>{error ?? (loadError?.message || "Could not load saved lists.")}</p><Button variant="outline" className="justify-self-start" disabled={disabled} onClick={() => { setError(null); void list.refetch(); if (selectedId) void detail.refetch(); }}>Reload lists</Button></div>}
      {notice && <p className="text-sm text-primary" role="status">{notice}</p>}
      {loading && <p className="text-sm text-muted-foreground" role="status">Loading lists…</p>}
      {!selectedId ? <>
        <div className="grid gap-2">
          <Button ref={keepRef} className="justify-self-start" disabled={disabled || !queueCount || playlists.length >= 100} onClick={create}><Bookmark aria-hidden="true" />Keep Up next as a list</Button>
          {(!queueCount || playlists.length >= 100) && <p className="text-sm text-muted-foreground">{!queueCount ? "Add something to Up next before keeping it." : "Delete a list before keeping another."}</p>}
        </div>
        <Separator />
        {!loading && !playlists.length && <p className="text-sm text-muted-foreground">Your kept lists will appear here.</p>}
        <ul ref={listRef} className="max-h-80 divide-y overflow-y-auto" aria-label="Saved lists" aria-busy={loading}>{playlists.map(item => <li key={item.id} data-nav-row>
          <Button variant="ghost" className="h-auto min-h-11 w-full justify-between gap-3 rounded-none px-0 py-3 text-left whitespace-normal" data-playlist-id={item.id} disabled={disabled} onClick={() => select(item.id)}>
            <span className="min-w-0 break-words">{item.name}</span>
            <span className="flex shrink-0 items-center gap-2">
              {item.source && <Badge variant="secondary">{providerLabels[item.source.provider]}</Badge>}
              <span className="text-sm text-muted-foreground">{item.entryCount} {item.entryCount === 1 ? "item" : "items"}, {item.totalDuration == null ? "unknown length" : `${Math.floor(item.totalDuration / 3_600)}:${String(Math.floor(item.totalDuration % 3_600 / 60)).padStart(2, "0")}`}</span>
            </span>
          </Button>
        </li>)}</ul>
      </> : playlist && <>
        <div className="flex flex-wrap gap-2" aria-label="Load list" data-nav-row>
          <Button disabled={disabled || !canPlay || !playlist.entries.length} onClick={() => void load("play")}><Play aria-hidden="true" />Play</Button>
          <Button variant="outline" disabled={disabled || !playlist.entries.length} onClick={() => void load("append")}><Plus aria-hidden="true" />Add to Up next</Button>
          <Button variant="outline" disabled={disabled || !playlist.entries.length} onClick={() => void load("replace")}>Replace Up next</Button>
        </div>
        <p className="text-sm text-muted-foreground">Play replaces Up next and starts the first item. Replace stops playback and loads these items.</p>
        <form className="grid gap-2" onSubmit={event => {
          event.preventDefault();
          void update(path, { revision: playlist.revision, operation: "rename", name: (rename ?? playlist.name).trim() }, "List renamed.").then(ok => { if (ok) setRename(null); });
        }}>
          <Label htmlFor="rename-playlist">List name</Label>
          <div className="flex flex-wrap gap-2" data-nav-row>
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
        <ol ref={entriesRef} className="max-h-80 divide-y overflow-y-auto" aria-label="List items" aria-busy={loading}>{playlist.entries.map((entry, index) => <SortableRow key={entry.id} id={entry.id} label={`Reorder ${entry.title}`} editing>{drag => <li data-nav-row ref={drag.setNodeRef} style={drag.style} className="flex flex-wrap items-center gap-2 py-2">
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
        <div className="flex flex-wrap gap-2" data-nav-row>
          <Button variant="outline" disabled={disabled || !queueCount} onClick={() => setConfirm("saveQueue")}><Bookmark aria-hidden="true" />Update from Up next</Button>
          <Button variant="ghost" disabled={disabled} onClick={() => void deleteList()}><Trash2 aria-hidden="true" />Delete</Button>
        </div>
        {confirm && <div className="grid gap-3 border-t pt-3">
          <p className="text-sm">Replace the kept contents of {playlist.name} with the current {queueCount} Up next items?</p>
          <div className="flex flex-wrap gap-2" data-nav-row>
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
