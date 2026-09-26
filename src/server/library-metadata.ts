import type { LibraryItem } from "../shared/library";
import type { QueueEntry } from "../shared/protocol";

/** Public library descriptions travel with playback, never filesystem paths. */
export function libraryMetadata(item?: LibraryItem | null): Pick<QueueEntry, "subtitle" | "description" | "artworkId" | "duration"> {
  if (!item) return {};
  const subtitle = (item.kind === "audio" ? [item.artist, item.album] : [item.video?.show?.title]).filter(Boolean).join(" · ").slice(0, 300);
  return {
    ...(subtitle ? { subtitle } : {}), ...(item.video?.plot ? { description: item.video.plot.slice(0, 2000) } : {}),
    ...(item.artworkId ? { artworkId: item.artworkId } : {}), ...(item.duration == null ? {} : { duration: item.duration }),
  };
}
