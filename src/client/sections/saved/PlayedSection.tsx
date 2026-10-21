import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { MediaArtwork } from "@/components/MediaArtwork";
import { MediaList, MediaRow } from "@/components/MediaRow";
import { usePlayOn } from "@/components/PlayOn";
import { historyQuery } from "@/api/progress";
import { apiSend } from "@/api/client";
import { itemLocation, useDetailNavigation } from "@/detail-navigation";
import { browserActions } from "@/original-page";
import { historyCaption, metaLine } from "@/media-caption";
import { formatDuration } from "@/time-format";
import { useOptionalSessionGate } from "@/session/session-context";
import { useShell } from "@/sections/shell/shell-context";
import { failed } from "@/toasts";
import type { HistoryItem } from "../../../shared/viewing";
import type { Credentials } from "../../session/session";
import { SavedEmpty, SavedError, SavedStatus } from "./SavedStatus";

/** How far an item got, in the meta line's words: what's left while part watched, else its length. */
const progress = (item: HistoryItem) => item.duration == null ? undefined
  : item.position > 0 && !item.watched ? `${formatDuration(Math.max(0, item.duration - item.position))} left` : formatDuration(item.duration);

/**
 * History, newest first, as Saved's other tabs: one meta line and a "…". Each row opens its History Details, which also
 * holds From start and Remove from Continue with Undo.
 */
export function PlayedSection({ origin, token, connected, onFind }: Credentials & { connected: boolean; onFind?: () => void }) {
  // The session invalidates ["progress"] whenever anything plays or a removal changes it.
  const history = useQuery({ ...historyQuery({ origin, token }), enabled: connected });
  const details = useDetailNavigation();
  const shell = useShell();
  const session = useOptionalSessionGate();
  const { play } = usePlayOn();
  const items = connected ? history.data?.items ?? [] : [];
  const loading = connected && history.isPending;
  const queue = (item: HistoryItem) => void session?.queue(item.title, () => apiSend({ origin, token }, `/api/progress/${encodeURIComponent(item.mediaId)}/queue`, { profileId: session.state?.activeProfile.id })).catch(reason => failed(`Couldn't queue ${item.title}.`, reason));
  return <section aria-label="Played">
    <SavedStatus connected={connected} loading={loading} />
    {connected && history.error && <SavedError message={history.error.message || "Couldn't load Played."} onRetry={() => void history.refetch()} />}
    {connected && !loading && !history.error && !items.length && <SavedEmpty title="Nothing played yet" action={onFind && <Button onClick={onFind}>Discover</Button>}>Your watching and listening history will appear here.</SavedEmpty>}
    {!!items.length && <MediaList aria-label="Played">
      {items.map(item => {
        const href = itemLocation("history", item.mediaId);
        const playable = connected && shell.available && !!(item.playable || item.queueEntryId);
        const start = (on?: string) => shell.playHistory(item, { fromStart: item.position === 0, on });
        const caption = historyCaption(item);
        return <MediaRow key={item.mediaId} data-history-details={item.mediaId} source={item.url} art={<MediaArtwork thumbnail={item.thumbnail} title={item.title} />} artFit="contain"
          title={caption.title} meta={metaLine(caption.meta, progress(item))} primary={{ label: "Details", href, onClick: () => details.open(href) }}
          menu={[
            { label: item.position > 0 && !item.watched ? "Resume" : "Play", disabled: !playable, run: () => void play(start) },
            { label: "Play on", disabled: !playable || !item.playable, playOn: deviceId => void play(start, deviceId) },
            { label: "Queue", disabled: !connected || !session, run: () => queue(item) },
            ...browserActions(item.url),
          ]} />;
      })}
    </MediaList>}
  </section>;
}
