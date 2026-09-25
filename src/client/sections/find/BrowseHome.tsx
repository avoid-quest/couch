import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { AuthArtwork } from "@/components/AuthArtwork";
import { MediaArtwork } from "@/components/MediaArtwork";
import { DurationBar } from "@/components/DurationBar";
import { MediaList, MediaRow } from "@/components/MediaRow";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { ForLaterSection } from "../saved/ForLaterSection";
import { historyQuery, librarySourcesQuery, removeFromContinue, undoProgressAction } from "@/api/library";
import { forLaterQuery } from "@/api/for-later";
import { jellyfinQuery } from "@/api/jellyfin";
import { iptvSourcesQuery } from "@/api/iptv";
import { useOptionalSessionGate } from "@/session/session-context";
import { playNotice, TRY_AGAIN } from "@/copy";
import type { HistoryItem } from "../../../shared/library";
import type { Credentials } from "../../session/session";

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
const status = (count: number, noun: string, note?: string) => count ? [plural(count, noun), note].filter(Boolean).join(" · ") : "Not set up";

// Find with an empty query: what to continue, what was saved for later, or on
// a fresh install, what Couch searches and (for admins) which sources exist.
export type HistoryPlayback = (item: HistoryItem, options: { fromStart?: boolean }) => Promise<boolean>;

export function BrowseHome({ credentials, connected, canPlay, canManageMetadata = false, active, onAddSource, onPlay, onAdd }: {
  credentials: Credentials;
  connected: boolean;
  canPlay: boolean;
  canManageMetadata?: boolean;
  active: boolean;
  onAddSource?: () => void;
  onPlay: HistoryPlayback;
  onAdd: (item: HistoryItem) => Promise<boolean>;
}) {
  const session = useOptionalSessionGate();
  const history = useQuery({ ...historyQuery(credentials), enabled: connected && active });
  const later = useQuery({ ...forLaterQuery(credentials), enabled: connected && active });
  const [pending, setPending] = useState(false);
  const unfinished = (history.data?.items ?? []).filter(item => item.position > 0 && !item.watched);
  const savedMedia = later.data?.items.filter(item => item.kind !== "radio" && !item.live) ?? [];
  const fresh = !history.isPending && !later.isPending && !unfinished.length && !savedMedia.length;
  const playable = (item: HistoryItem) => connected && canPlay && !pending && !!(item.playable || item.libraryItemId || item.queueEntryId);
  async function act(item: HistoryItem, action: "resume" | "start" | "queue" | "remove") {
    if (pending) return;
    setPending(true);
    try {
      if (action === "remove") {
        const result = await removeFromContinue(credentials, item.mediaId);
        await history.refetch();
        if (result.undoToken && result.expiresAt && result.expiresAt > Date.now()) session?.offerUndo(`Removed ${item.title} from Continue.`, async () => {
          await undoProgressAction(credentials, result.undoToken!);
          await history.refetch();
        }, result.expiresAt - Date.now());
        return;
      }
      const ok = action === "queue" ? await onAdd(item) : await onPlay(item, { fromStart: action === "start" });
      if (ok) toast(playNotice(item.title, action === "queue" ? "queue" : action === "start" ? "play" : "resume"));
      else if (action === "queue") toast.error(`Couldn't queue ${item.title}.`);
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : `Couldn't play ${item.title}.`); }
    finally { setPending(false); }
  }
  return <section className="space-y-12 [--duration-width:6rem] sm:[--duration-width:14rem] lg:[--duration-width:18rem]" aria-label="Home">
    {history.error && <Alert variant="destructive"><AlertDescription>{history.error.message || "Couldn't load Continue."}</AlertDescription><AlertAction><Button variant="ghost" size="sm" onClick={() => void history.refetch()}>{TRY_AGAIN}</Button></AlertAction></Alert>}
    {!!unfinished.length && <section aria-label="Continue">
      <h2 className="mb-2 text-base font-medium">Continue</h2>
      <MediaList>{unfinished.map(item => <MediaRow key={item.mediaId} title={item.title} meta={item.sourceLabel || (item.libraryItemId ? "Folders" : undefined)}
        art={item.artworkId ? <AuthArtwork origin={credentials.origin} token={credentials.token} id={item.artworkId} /> : <MediaArtwork thumbnail={item.thumbnail} title={item.title} />}
        primary={{ label: "Resume", onClick: () => void act(item, "resume"), disabled: !playable(item) }}
        actions={<>
          <Button variant="ghost" aria-label={`From start ${item.title}`} disabled={!playable(item)} onClick={() => void act(item, "start")}>From start</Button>
          <Button variant="ghost" aria-label={`Queue ${item.title}`} disabled={!connected || pending} onClick={() => void act(item, "queue")}>Queue</Button>
          <Button variant="ghost" aria-label={`Remove ${item.title} from Continue`} disabled={!connected || pending} onClick={() => void act(item, "remove")}>Remove</Button>
        </>}>
        <DurationBar duration={item.duration} position={item.position} />
      </MediaRow>)}</MediaList>
    </section>}
    {!!savedMedia.length && <ForLaterSection origin={credentials.origin} token={credentials.token} connected={connected} canPlay={canPlay} mediaOnly />}
    {fresh && <Empty className="py-0">
      <EmptyHeader><EmptyTitle><h2>Find something to play</h2></EmptyTitle><EmptyDescription>Couch searches YouTube, Twitch, RaiPlay, radio and your folders at once. You can also paste a link.</EmptyDescription></EmptyHeader>
      {canManageMetadata && <SourcesStatus credentials={credentials} connected={connected} active={active} onAddSource={onAddSource} />}
    </Empty>}
  </section>;
}

function SourcesStatus({ credentials, connected, active, onAddSource }: { credentials: Credentials; connected: boolean; active: boolean; onAddSource?: () => void }) {
  const enabled = connected && active;
  const folders = useQuery({ ...librarySourcesQuery(credentials), enabled }).data?.sources ?? [];
  const jellyfin = useQuery({ ...jellyfinQuery(credentials, true), enabled }).data;
  const iptv = useQuery({ ...iptvSourcesQuery(credentials), enabled }).data?.sources ?? [];
  const attention = "Needs attention";
  return <EmptyContent className="mt-4 max-w-xl gap-4">
    <SettingsSection title="Sources" className="w-full">
      <SettingsRow label="Folders"><span className="text-sm leading-6 text-muted-foreground">{status(folders.length, "folder", folders.some(folder => folder.status === "scanning") ? "Scanning" : folders.some(folder => folder.status === "error" || folder.status === "unavailable") ? attention : undefined)}</span></SettingsRow>
      <SettingsRow label="Jellyfin"><span className="text-sm leading-6 text-muted-foreground">{jellyfin?.connected ? "Connected" : "Not set up"}</span></SettingsRow>
      <SettingsRow label="Live TV"><span className="text-sm leading-6 text-muted-foreground">{status(iptv.length, "source", iptv.some(source => source.error) ? attention : undefined)}</span></SettingsRow>
      <SettingsRow label="Radio"><span className="text-sm leading-6 text-muted-foreground">Built in</span></SettingsRow>
    </SettingsSection>
    {onAddSource && <Button variant="outline" onClick={onAddSource}>Add a source</Button>}
  </EmptyContent>;
}
