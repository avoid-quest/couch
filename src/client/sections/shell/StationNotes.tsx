import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { radioProgrammesQuery, radioStationQuery } from "@/api/radio";
import { RadioProgress, RadioSlot } from "@/components/RadioSchedule";
import { RadioRecognition } from "@/components/RadioRecognition";
import { SearchNames } from "@/components/SearchNames";
import { metaLine } from "@/media-caption";
import { useRadioClock } from "@/radio-clock";
import type { ClientSessionState } from "@/session/session";
import { useShell } from "./shell-context";
import { useUncut } from "./uncut";
import type { QueueEntry } from "../../../shared/protocol";
import { radioNext, radioShowNames, type RadioProgrammeDetails } from "../../../shared/radio";

/**
 * A station's notes, where the side player keeps Up next for everything else: the show's time left, labels, host and
 * synopsis (else the station's tags), the song, what Identify song found, and the next show in its guide. Its name is
 * under the title and "On air now" at the transport's end.
 */
export function StationNotes({
  state,
  connected,
  station,
  show,
  identify,
}: {
  state: ClientSessionState;
  connected: boolean;
  station: QueueEntry;
  show: RadioProgrammeDetails | null;
  /** Where Identify song's button goes, beside Volume. */
  identify: HTMLElement | null;
}) {
  const { credentials } = useShell();
  const id = station.source.startsWith("radio:") ? station.source.slice(6) : "";
  const guides = useQuery({
    ...radioProgrammesQuery(credentials),
    enabled: connected && !!id,
    refetchInterval: 60_000,
  });
  const tags = useQuery({
    ...radioStationQuery(credentials, id),
    enabled: connected && !!id && !show,
  }).data?.tags;
  const guide = id ? guides.data?.[id] : undefined;
  const next = radioNext(guide, useRadioClock(guide ? [guide] : []));
  const { player } = state;
  const song = [player.nowPlaying?.artist, player.nowPlaying?.title].filter(Boolean).join(" — ");
  // A show's styles and host search everything for them, as in the full player; a station's tags are words.
  const names = radioShowNames(show);
  const about = show
    ? names.length > 0 && <SearchNames names={names} />
    : metaLine(...(tags ?? []));
  const box = useRef<HTMLElement>(null);
  // Notes the panel would cut wait unseen, so Up next after the station keeps its room.
  useUncut(box, "[data-note]", JSON.stringify([show?.title, names, tags, song, next?.id]));
  return (
    <section
      ref={box}
      aria-label={station.title}
      className="mt-4 grid min-h-[6.5rem] shrink-[100] content-start gap-1.5 overflow-hidden px-3.5 text-meta text-muted-foreground"
    >
      <div data-note className="empty:hidden">
        <RadioProgress show={show} />
      </div>
      {about && (
        <p data-note className="text-foreground">
          {about}
        </p>
      )}
      {show?.description && (
        <p data-note className="line-clamp-4 text-pretty">
          {show.description}
        </p>
      )}
      {song && (
        <p data-note className="text-foreground">
          {song}
        </p>
      )}
      {player.playbackId && (
        <RadioRecognition
          key={JSON.stringify([
            credentials.origin,
            credentials.token,
            player.playbackId,
            station.id,
          ])}
          credentials={credentials}
          playbackId={player.playbackId}
          connected={connected}
          controls={identify}
        />
      )}
      {next && (
        <p data-note className="text-subtle-foreground">
          Next <RadioSlot show={next} className="text-foreground" />
        </p>
      )}
    </section>
  );
}
