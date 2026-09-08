import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, ListMusic, Play, Plus, Save, Trash2, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import type { PlaylistLoadMode, SavedPlaylist, SavedPlaylistSummary } from "../shared/playlists";

export function SavedPlaylists({ origin, token, connected, canPlay, version, queueCount }: {
  origin: string;
  token: string;
  connected: boolean;
  canPlay: boolean;
  version: number;
  queueCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [playlists, setPlaylists] = useState<SavedPlaylistSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [playlist, setPlaylist] = useState<SavedPlaylist | null>(null);
  const [name, setName] = useState("");
  const [rename, setRename] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"delete" | "saveQueue" | null>(null);
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
    return () => mutation.current?.abort();
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
        throw new Error(result.error || "Could not load saved playlists.");
      }
      return result;
    };
    void Promise.all([
      read("/api/playlists"),
      selectedId ? read(`/api/playlists/${encodeURIComponent(selectedId)}`) : Promise.resolve(null),
    ]).then(([list, detail]) => {
      if (!controller.signal.aborted) {
        setPlaylists(list.playlists);
        setPlaylist(detail?.playlist ?? null);
      }
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load saved playlists.");
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
      if (!response.ok) throw new Error(result.error || "Could not update this playlist.");
      if (controller.signal.aborted) return false;
      if (result.playlist?.id === selectedId) setPlaylist(result.playlist);
      setNotice(message);
      setConfirm(null);
      return true;
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not update this playlist.");
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
    if (await update("/api/playlists", { name: name.trim() }, `Saved ${name.trim()}.`)) setName("");
  };
  const load = (mode: PlaylistLoadMode) => playlist && update(`${path}/load`, { revision: playlist.revision, mode },
    mode === "append" ? `Added ${playlist.name} to the queue.` : mode === "play" ? `Starting ${playlist.name} on the TV.` : `Loaded ${playlist.name}. Press Play to start.`);

  return <Dialog open={open} onOpenChange={value => { setOpen(value); setError(null); setNotice(null); setConfirm(null); }}>
    <DialogTrigger asChild><Button variant="outline" className="min-h-11" disabled={!connected}><ListMusic aria-hidden="true" />Saved playlists</Button></DialogTrigger>
    <DialogContent className="saved-playlists sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle className="break-words pr-12">{playlist?.name ?? "Saved playlists"}</DialogTitle>
        <DialogDescription>{selectedId ? "Edit this playlist or load it into the shared TV queue." : "Playlists are shared on this TV and stay available when the watching profile changes. Save the queue to reuse it later."}</DialogDescription>
      </DialogHeader>
      {selectedId && <Button ref={backRef} variant="ghost" className="justify-self-start" disabled={pending} onClick={() => select(null)}><ArrowLeft aria-hidden="true" />All playlists</Button>}
      {!connected && <Alert><AlertDescription>Reconnect to load or edit playlists.</AlertDescription></Alert>}
      {error && <Alert variant="destructive" className="gap-2"><AlertDescription>{error}</AlertDescription><Button variant="outline" className="justify-self-start" disabled={disabled} onClick={() => { setError(null); setRefresh(value => value + 1); }}>Reload playlists</Button></Alert>}
      {notice && <p className="text-sm text-primary" role="status">{notice}</p>}
      {loading && <p className="text-sm text-muted-foreground" role="status">Loading playlists…</p>}
      {!selectedId ? <>
        <form className="grid gap-2" onSubmit={event => void create(event)}>
          <Label htmlFor="saved-playlist-name">Save the current queue</Label>
          <div className="flex flex-wrap gap-2">
            <Input ref={nameRef} id="saved-playlist-name" className="min-h-11 min-w-0 flex-1" value={name} onChange={event => setName(event.target.value)} placeholder="Playlist name" maxLength={80} required autoComplete="off" disabled={disabled} />
            <Button type="submit" disabled={disabled || !name.trim() || !queueCount || playlists.length >= 100}><Save aria-hidden="true" />Save queue</Button>
          </div>
          <p className="text-sm text-muted-foreground">{queueCount ? `${queueCount} ${queueCount === 1 ? "item" : "items"} in the queue.` : "Add something to the queue before saving it."}{playlists.length >= 100 && " Delete a playlist before saving another."}</p>
        </form>
        <Separator />
        {!loading && !playlists.length && <p className="text-sm text-muted-foreground">Your saved playlists will appear here.</p>}
        <ul ref={listRef} className="grid max-h-80 gap-2 overflow-y-auto p-1" aria-label="Saved playlists" aria-busy={loading}>{playlists.map(item => <li key={item.id}>
          <Button variant="outline" className="h-auto min-h-11 w-full justify-between gap-3 py-3 text-left whitespace-normal" data-playlist-id={item.id} disabled={disabled} onClick={() => select(item.id)}>
            <span className="min-w-0 break-words">{item.name}</span><span className="shrink-0 text-sm text-muted-foreground">{item.entryCount} {item.entryCount === 1 ? "item" : "items"}</span>
          </Button>
        </li>)}</ul>
      </> : playlist && <>
        <div className="flex flex-wrap gap-2" aria-label="Load playlist">
          <Button disabled={disabled || !canPlay || !playlist.entries.length} onClick={() => void load("play")}><Play aria-hidden="true" />Play playlist</Button>
          <Button variant="outline" disabled={disabled || !playlist.entries.length} onClick={() => void load("append")}><Plus aria-hidden="true" />Add to queue</Button>
          <Button variant="outline" disabled={disabled || !playlist.entries.length} onClick={() => void load("replace")}>Replace queue</Button>
        </div>
        <p className="text-sm text-muted-foreground">Play playlist replaces the queue and starts the first item. Replace queue stops playback and loads these items.</p>
        <form className="grid gap-2" onSubmit={event => {
          event.preventDefault();
          void update(path, { revision: playlist.revision, operation: "rename", name: (rename ?? playlist.name).trim() }, "Playlist renamed.").then(ok => { if (ok) setRename(null); });
        }}>
          <Label htmlFor="rename-playlist">Playlist name</Label>
          <div className="flex flex-wrap gap-2">
            <Input id="rename-playlist" className="min-h-11 min-w-0 flex-1" value={rename ?? playlist.name} onChange={event => setRename(event.target.value)} maxLength={80} required autoComplete="off" disabled={disabled} />
            <Button variant="outline" type="submit" disabled={disabled || !(rename ?? "").trim() || rename?.trim() === playlist.name}>Rename</Button>
          </div>
        </form>
        <ol ref={entriesRef} className="grid max-h-80 gap-2 overflow-y-auto p-1" aria-label="Playlist items" aria-busy={loading}>{playlist.entries.map((entry, index) => <li key={entry.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
          <span className="w-6 shrink-0 text-center text-sm text-muted-foreground">{index + 1}</span>
          <span className="min-w-0 flex-1 break-words text-sm">{entry.title}{entry.live && <span className="ml-2 text-xs text-muted-foreground">LIVE</span>}</span>
          <div className="flex shrink-0 gap-1">
            <Button variant="ghost" size="icon" aria-label={`Move ${entry.title} up`} disabled={disabled || index === 0} onClick={() => void update(path, { revision: playlist.revision, operation: "move", entryId: entry.id, beforeEntryId: playlist.entries[index - 1]!.id }, "Playlist order saved.")}><ArrowUp aria-hidden="true" /></Button>
            <Button variant="ghost" size="icon" aria-label={`Move ${entry.title} down`} disabled={disabled || index === playlist.entries.length - 1} onClick={() => void update(path, { revision: playlist.revision, operation: "move", entryId: entry.id, beforeEntryId: playlist.entries[index + 2]?.id ?? null }, "Playlist order saved.")}><ArrowDown aria-hidden="true" /></Button>
            <Button variant="ghost" size="icon" aria-label={`Remove ${entry.title} from playlist`} disabled={disabled} onClick={() => void update(path, { revision: playlist.revision, operation: "remove", entryId: entry.id }, "Item removed from playlist.").then(ok => {
              if (ok) requestAnimationFrame(() => {
                const rows = entriesRef.current?.children;
                const row = rows?.[Math.min(index, rows.length - 1)];
                (row?.querySelector<HTMLButtonElement>("button:not(:disabled)") ?? backRef.current)?.focus();
              });
            })}><X aria-hidden="true" /></Button>
          </div>
        </li>)}</ol>
        {!playlist.entries.length && <p className="text-sm text-muted-foreground">This playlist is empty. Fill the queue, then save it here.</p>}
        <Separator />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={disabled || !queueCount} onClick={() => setConfirm("saveQueue")}><Save aria-hidden="true" />Update from queue</Button>
          <Button variant="destructive" disabled={disabled} onClick={() => setConfirm("delete")}><Trash2 aria-hidden="true" />Delete playlist</Button>
        </div>
        {confirm && <div className="grid gap-3 rounded-lg border p-3">
          <p className="text-sm">{confirm === "delete" ? `Delete ${playlist.name}? Items in the current queue will stay.` : `Replace the saved contents of ${playlist.name} with the current ${queueCount}-item queue?`}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant={confirm === "delete" ? "destructive" : "default"} disabled={disabled || (confirm === "saveQueue" && !queueCount)} onClick={() => void update(path, { revision: playlist.revision, ...(confirm === "saveQueue" ? { operation: "saveQueue" } : {}) }, confirm === "delete" ? "Playlist deleted." : "Playlist updated from the queue.", confirm === "delete" ? "DELETE" : "POST").then(ok => { if (ok && confirm === "delete") select(null); })}>{confirm === "delete" ? "Confirm delete" : "Replace saved items"}</Button>
            <Button variant="outline" disabled={pending} onClick={() => setConfirm(null)}>Cancel</Button>
          </div>
        </div>}
      </>}
    </DialogContent>
  </Dialog>;
}
