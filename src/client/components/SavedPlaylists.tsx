import { MediaContext } from "@/components/MediaContext";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DndContext } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MediaList, MediaRow } from "@/components/MediaRow";
import { PlayOnMenu, playOnQuery, usePlayOn } from "@/components/PlayOn";
import { PageHeader } from "@/components/PageHeader";
import { SortableRow, useDndSensors } from "@/lib/dnd";
import { ApiError, apiSend } from "@/api/client";
import { playlistQuery, playlistsQuery } from "@/api/playlists";
import { useOptionalSessionGate } from "@/session/session-context";
import { formatDuration } from "@/time-format";
import { SavedEmpty, SavedError, SavedStatus } from "@/sections/saved/SavedStatus";
import type { PlaylistLoadMode, SavedPlaylist, SavedPlaylistSummary } from "../../shared/playlists";

const providerLabels = { youtube: "YouTube", raiplay: "RaiPlay", bandcamp: "Bandcamp", streamingcommunity: "StreamingCommunity", movies123: "123MoviesFree", animesaturn: "AnimeSaturn", animeunity: "AnimeUnity" };
const summary = (list: SavedPlaylistSummary) => [
  list.source && providerLabels[list.source.provider],
  `${list.entryCount} ${list.entryCount === 1 ? "item" : "items"}`,
  list.totalDuration != null && formatDuration(list.totalDuration),
].filter(Boolean).join(" · ");
const listPath = (id: string) => `/api/playlists/${encodeURIComponent(id)}`;
type Write = { path: string; body: unknown; method?: string };

/** Saved's Lists tab: lists kept from Up next or a source, and one list's detail. */
export function SavedPlaylists({ origin, token, connected, canPlay, queueCount, onFind }: {
  origin: string;
  token: string;
  connected: boolean;
  canPlay: boolean;
  queueCount: number;
  onFind: () => void;
}) {
  const credentials = { origin, token };
  const session = useOptionalSessionGate();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rename, setRename] = useState<string | null>(null);
  const section = useRef<HTMLElement>(null);
  const sensors = useDndSensors();
  // The server bumps the playlists revision after every change, from any remote.
  const list = useQuery({ ...playlistsQuery(credentials), enabled: connected });
  const detail = useQuery({ ...playlistQuery(credentials, selectedId ?? ""), enabled: connected && !!selectedId });
  // A list deleted on another remote returns this one to all lists.
  const missing = detail.error instanceof ApiError && detail.error.status === 404;
  const openId = missing ? null : selectedId;
  const playlists = list.data?.playlists ?? [];
  const playlist = openId ? detail.data?.playlist ?? null : null;
  const loading = connected && (list.isPending || !!openId && detail.isPending);
  const loadError = connected ? list.error ?? (missing ? null : detail.error) : null;
  const mutation = useMutation({
    mutationFn: ({ path, body, method = "POST" }: Write) => apiSend<{ playlist?: SavedPlaylist; undoToken?: string } | undefined>(credentials, path, body, method, 30_000),
    onSuccess: result => { if (result?.playlist) queryClient.setQueryData(playlistQuery(credentials, result.playlist.id).queryKey, { playlist: result.playlist }); },
  });
  const pending = mutation.isPending;
  const disabled = !connected || pending;
  const write = (path: string, body: unknown, method?: string) => connected && !pending ? mutation.mutateAsync({ path, body, method }).catch(() => null) : Promise.resolve(null);

  // Focus the first selector that matches, after React commits.
  const focus = (...selectors: string[]) => requestAnimationFrame(() => {
    for (const selector of selectors) {
      const target = section.current?.querySelector<HTMLElement>(selector);
      if (target) { target.focus(); return; }
    }
  });
  const select = (id: string | null) => {
    const previousId = openId;
    setSelectedId(id);
    setRename(null);
    mutation.reset();
    if (id) focus("[data-back]");
    else focus(`[data-playlist-id="${previousId}"] [data-play]`, "[data-play]", "button:not(:disabled)");
  };
  const create = async () => {
    const name = `Up next, ${new Date().toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`;
    await write("/api/playlists", { name, scope: "upNext" });
  };
  const { on, play } = usePlayOn();
  const load = async (target: { id: string; name: string; revision: number }, mode: PlaylistLoadMode, deviceId?: string) => {
    const send = (on?: string) => write(`${listPath(target.id)}/load${playOnQuery(on)}`, { revision: target.revision, mode });
    await (mode === "play" ? play(async on => await send(on) ?? false, deviceId) : session ? session.queue(target.name, send) : send());
  };
  const deleteList = async (target: SavedPlaylist) => {
    const result = await write(listPath(target.id), { revision: target.revision }, "DELETE");
    if (!result) return;
    select(null);
    const text = `Deleted ${target.name}.`;
    const undoToken = result.undoToken;
    if (undoToken && session) session.offerUndo(text, async () => { await apiSend(credentials, "/api/playlists/restore", { token: undoToken }, "POST", 30_000); });
  };
  const cannotSave = !queueCount ? "Queue something first." : playlists.length >= 100 ? "100-list limit. Delete one first." : "";

  return <section ref={section} aria-label="Lists">
    {!openId ? <>
      <PageHeader title="Lists" hidden actions={<Button disabled={disabled || !!cannotSave} onClick={() => void create()}>Save as list</Button>} />
      {connected && cannotSave && <p className="mb-4 text-sm text-muted-foreground">{cannotSave}</p>}
      <SavedStatus connected={connected} loading={loading} />
      {loadError && <SavedError message={loadError.message || "Couldn't load lists."} onRetry={() => void list.refetch()} />}
      {connected && mutation.error && <SavedError message={mutation.error.message || "Couldn't change this list."} />}
      {connected && !loading && !loadError && !playlists.length && <SavedEmpty title="No lists yet" action={<Button onClick={onFind}>Discover</Button>}>Queue a few items, then choose Save as list to play them together again.</SavedEmpty>}
      {!!playlists.length && <MediaList>{playlists.map(item => <MediaRow key={item.id} data-playlist-id={item.id}
        title={item.name}
        meta={summary(item)}
        primary={{ label: "Open", onClick: () => select(item.id), disabled }}
        // The list's page holds Play, Play on and Queue, so the row needs no "…".
        menuOnPage
        menu={[
          { label: "Play", disabled: disabled || !canPlay || !item.entryCount, run: () => void load(item, "play") },
          { label: "Play on", disabled: disabled || !canPlay || !item.entryCount, playOn: deviceId => void load(item, "play", deviceId) },
          { label: "Queue", disabled: disabled || !item.entryCount, run: () => void load(item, "append") },
        ]} />)}</MediaList>}
    </> : <>
      <PageHeader title={playlist?.name ?? playlists.find(item => item.id === openId)?.name ?? "List"} back={{ label: "Lists", onClick: () => select(null) }} actions={playlist && <>
        <Button disabled={disabled || !canPlay || !playlist.entries.length} onClick={() => void load(playlist, "play")}>{on("Play")}</Button>
        <PlayOnMenu title={playlist.name} disabled={disabled || !canPlay || !playlist.entries.length} onPlay={deviceId => void load(playlist, "play", deviceId)} />
        <Button variant="outline" disabled={disabled || !playlist.entries.length} onClick={() => void load(playlist, "append")}>Queue</Button>
        <AlertDialog>
          <AlertDialogTrigger asChild><Button variant="ghost" disabled={disabled || !queueCount}>Update from Up next</Button></AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Replace {playlist.name}?</AlertDialogTitle>
              <AlertDialogDescription>Its items become the {queueCount} in Up next.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => void write(listPath(playlist.id), { revision: playlist.revision, operation: "saveQueue" })}>Replace</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Button variant="ghost" disabled={disabled} onClick={() => void deleteList(playlist)}>Delete</Button>
      </>} />
      <SavedStatus connected={connected} loading={loading} />
      {loadError && <SavedError message={loadError.message || "Couldn't load this list."} onRetry={() => void detail.refetch()} />}
      {connected && mutation.error && <SavedError message={mutation.error.message || "Couldn't change this list."} />}
      {playlist && !playlist.entries.length && <SavedEmpty>This list is empty. Use Update from Up next to fill it.</SavedEmpty>}
      {!!playlist?.entries.length && <DndContext sensors={sensors} onDragEnd={({ active, over }) => {
        if (!over || active.id === over.id) return;
        const from = playlist.entries.findIndex(entry => entry.id === String(active.id)), to = playlist.entries.findIndex(entry => entry.id === String(over.id));
        if (from < 0 || to < 0) return;
        const beforeEntryId = to > from ? playlist.entries[to + 1]?.id ?? null : playlist.entries[to]!.id;
        void write(listPath(playlist.id), { revision: playlist.revision, operation: "move", entryId: String(active.id), beforeEntryId });
      }}>
        <SortableContext items={playlist.entries.map(entry => entry.id)} strategy={verticalListSortingStrategy}>
          <MediaList aria-label="List items">{playlist.entries.map((entry, index) => <SortableRow key={entry.id} id={entry.id} label={`Reorder ${entry.title}`}>{drag => <MediaRow context={<MediaContext collection={entry.collection} creator={entry.creator} />} ref={drag.setNodeRef} style={drag.style}
            title={entry.title}
            meta={!entry.live && entry.duration != null ? formatDuration(entry.duration) : undefined}
            actions={<>
              <Button variant="ghost" aria-label={`Remove ${entry.title} from list`} disabled={disabled} onClick={() => void write(listPath(playlist.id), { revision: playlist.revision, operation: "remove", entryId: entry.id }).then(ok => {
                // Focus the row that took this one's place, or Back.
                if (ok) focus(`[aria-label="List items"] > li:nth-child(${Math.min(index + 1, playlist.entries.length - 1)}) button:not(:disabled)`, "[data-back]");
              })}>Remove</Button>
              {drag.handle}
            </>} />}</SortableRow>)}</MediaList>
        </SortableContext>
      </DndContext>}
      {playlist && <form className="mt-8 flex max-w-md flex-wrap items-end gap-2" data-nav-row onSubmit={event => {
        event.preventDefault();
        void write(listPath(playlist.id), { revision: playlist.revision, operation: "rename", name: (rename ?? playlist.name).trim() }).then(ok => { if (ok) setRename(null); });
      }}>
        <div className="grid min-w-0 flex-1 gap-2">
          <Label htmlFor="rename-playlist">Name</Label>
          <Input id="rename-playlist" value={rename ?? playlist.name} onChange={event => setRename(event.target.value)} maxLength={80} required autoComplete="off" disabled={disabled} />
        </div>
        <Button variant="outline" type="submit" disabled={disabled || !(rename ?? "").trim() || rename?.trim() === playlist.name}>Rename</Button>
      </form>}
    </>}
  </section>;
}
