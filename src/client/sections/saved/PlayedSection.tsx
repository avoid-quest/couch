import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { MediaArtwork } from "@/components/MediaArtwork";
import { MediaList, MediaRow } from "@/components/MediaRow";
import { historyShape, majorityShape } from "@/art-shape";
import { historyQuery } from "@/api/progress";
import { itemLocation, useDetailNavigation } from "@/detail-navigation";
import { historyCaption, metaLine } from "@/media-caption";
import { formatDuration } from "@/time-format";
import type { HistoryItem } from "../../../shared/viewing";
import type { Credentials } from "../../session/session";
import { useHistoryMenu } from "@/sections/home/history-menu";
import { SavedEmpty, SavedError, SavedStatus } from "./SavedStatus";

/** How far an item got, in the meta line's words: what's left while part watched, else its length. */
const progress = (item: HistoryItem) =>
  item.duration == null
    ? undefined
    : item.position > 0 && !item.watched
      ? `${formatDuration(Math.max(0, item.duration - item.position))} left`
      : formatDuration(item.duration);

/**
 * History, newest first, as Saved's other tabs: one meta line and a "…". Each row opens its History Details, which also
 * holds From start and Remove from Continue with Undo.
 */
export function PlayedSection({
  origin,
  token,
  connected,
  onFind,
}: Credentials & { connected: boolean; onFind?: () => void }) {
  // The session invalidates ["progress"] whenever anything plays or a removal changes it.
  const history = useQuery({ ...historyQuery({ origin, token }), enabled: connected });
  const details = useDetailNavigation();
  const menu = useHistoryMenu();
  const items = connected ? (history.data?.items ?? []) : [];
  const loading = connected && history.isPending;
  const shape = majorityShape(items.map(historyShape));
  return (
    <section aria-label="Played">
      <SavedStatus connected={connected} loading={loading} />
      {connected && history.error && (
        <SavedError
          message={history.error.message || "Couldn't load Played."}
          onRetry={() => void history.refetch()}
        />
      )}
      {connected && !loading && !history.error && !items.length && (
        <SavedEmpty
          title="Nothing played yet"
          action={onFind && <Button onClick={onFind}>Search</Button>}
        >
          Your watching and listening history will appear here.
        </SavedEmpty>
      )}
      {!!items.length && (
        <MediaList aria-label="Played">
          {items.map((item) => {
            const href = itemLocation("history", item.mediaId);
            const caption = historyCaption(item);
            return (
              <MediaRow
                key={item.mediaId}
                data-history-details={item.mediaId}
                source={item.url}
                art={<MediaArtwork thumbnail={item.thumbnail} title={item.title} />}
                artFit="contain"
                shape={shape}
                own={historyShape(item)}
                title={caption.title}
                meta={metaLine(caption.meta, progress(item))}
                primary={{ label: "Details", href, onClick: () => details.open(href) }}
                menu={menu(item, { press: "Details" })}
              />
            );
          })}
        </MediaList>
      )}
    </section>
  );
}
