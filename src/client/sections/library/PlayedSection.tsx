import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { DurationBar } from "@/components/DurationBar";
import { MediaArtwork } from "@/components/MediaArtwork";
import { MediaList, MediaRow } from "@/components/MediaRow";
import { historyQuery } from "@/api/progress";
import { itemLocation, useDetailNavigation } from "@/detail-navigation";
import type { Credentials } from "../../session/session";
import { LibraryEmpty, LibraryError, LibraryStatus } from "./LibraryStatus";

/** History, newest first. Each row opens its History Details, which holds its verbs and Remove from Continue with Undo. */
export function PlayedSection({ origin, token, connected, onFind }: Credentials & { connected: boolean; onFind?: () => void }) {
  // The session invalidates ["progress"] whenever anything plays or a removal changes it.
  const history = useQuery({ ...historyQuery({ origin, token }), enabled: connected });
  const details = useDetailNavigation();
  const items = connected ? history.data?.items ?? [] : [];
  const loading = connected && history.isPending;
  return <section aria-label="Played">
    <LibraryStatus connected={connected} loading={loading} />
    {connected && history.error && <LibraryError message={history.error.message || "Couldn't load Played."} onRetry={() => void history.refetch()} />}
    {connected && !loading && !history.error && !items.length && <LibraryEmpty action={onFind && <Button variant="outline" onClick={onFind}>Search</Button>}>Nothing played yet. What plays on Couch shows here.</LibraryEmpty>}
    {!!items.length && <MediaList aria-label="Played">
      {items.map(item => {
        const href = itemLocation("history", item.mediaId);
        return <MediaRow key={item.mediaId} data-history-details={item.mediaId} art={<MediaArtwork key={item.thumbnail || item.mediaId} thumbnail={item.thumbnail} title={item.title} />} artFit="contain"
          title={item.title} meta={[item.subtitle, item.sourceLabel].filter(Boolean).join(" · ")} primary={{ label: "Details", href, onClick: () => details.open(href) }}>
          <DurationBar duration={item.duration} position={item.position} />
        </MediaRow>;
      })}
    </MediaList>}
  </section>;
}
