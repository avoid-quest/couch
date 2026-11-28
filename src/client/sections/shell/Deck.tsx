import type { ReactNode } from "react";
import { Level } from "@/components/Level";
import { LiveClock } from "@/components/LiveClock";
import {
  LiveParticipation,
  PlaybackTime,
  PlaybackTimeline,
  PlaybackTransport,
  PlaybackVolume,
  sharesLive,
} from "@/components/PlaybackTransport";
import { cn } from "@/lib/utils";
import { livePlayback, playbackControls } from "@/session/playback-controls";
import type { ClientSessionState } from "@/session/session";
import { isRadio } from "../../../shared/radio";
import type { Action, QueueEntry } from "../../../shared/protocol";

type Props = {
  state: ClientSessionState;
  connected: boolean;
  run: (action: Action) => Promise<boolean>;
};

/** Who shares what plays here: its device's name, or the source's own (an AirPlay sender's). */
export function sharedFrom(state: ClientSessionState, entry: QueueEntry) {
  const source = state.liveSources?.find((item) => item.id === entry.liveSourceId);
  return state.devices?.find((device) => device.id === source?.deviceId)?.name ?? source?.name;
}

/** The words at the transport's end: the time, or for what has no end how it goes, with the level beside them. */
export function DeckClock({ children, moving }: { children: ReactNode; moving?: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-2 pr-2.5 text-meta whitespace-nowrap text-subtle-foreground tabular-nums">
      {moving !== undefined && <Level moving={moving} className="shrink-0" />}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** "23:09 / 25:27", or what an endless item, a share or Live audio says in its place. */
function Clock({ state }: Pick<Props, "state">) {
  const current = state.queue.find((entry) => entry.id === state.currentEntryId);
  const playing = state.player.status === "playing" && !state.player.buffering;
  if (!current) return null;
  const source = state.liveSources?.find((item) => item.id === current.liveSourceId);
  if (livePlayback(state))
    return playbackControls(state).leave ? (
      <DeckClock moving={playing}>Your sound, on this device</DeckClock>
    ) : (
      <DeckClock moving={false}>
        <LiveClock startedAt={source?.startedAt} />
      </DeckClock>
    );
  if (current.liveSourceId) {
    const from = sharedFrom(state, current);
    const playback = state.playbacks?.find((item) => item.id === state.playback);
    return (
      <DeckClock moving={playing}>
        {playback?.delivery === "scheduled"
          ? `In sync, a few seconds behind ${from ?? "its source"}`
          : `As it happens${from ? ` on ${from}` : ""}`}
      </DeckClock>
    );
  }
  if (current.endless || isRadio(current))
    return <DeckClock moving={playing}>{isRadio(current) ? "On air now" : "On now"}</DeckClock>;
  return (
    <DeckClock>
      <PlaybackTime state={state} />
    </DeckClock>
  );
}

/**
 * The deck, the desk's foot: Volume on its own row, the timeline as a bare line, then the transport, icons of one size
 * from the corner, with the time or "On air now" at its end. A Live listener's Volume is its own ("Your volume") once it
 * joined, and Join, Leave or Tap to hear stand where Play is. `bar` takes the transport's place (the capsule's own bar).
 */
export function Deck({ state, connected, run, bar }: Props & { bar?: ReactNode }) {
  const live = livePlayback(state);
  const joined = playbackControls(state).leave;
  const volume = !sharesLive(state) && (!live || joined);
  return (
    <div className="desk-deck shrink-0 border-t pt-1 first:border-t-0">
      {volume && (
        <PlaybackVolume
          state={state}
          connected={connected}
          run={run}
          className="-ml-2.5 h-11 gap-2 text-meta text-subtle-foreground"
        />
      )}
      <PlaybackTimeline
        state={state}
        connected={connected}
        className="[&_[data-time-labels]]:hidden"
      />
      {bar ?? (
        <div
          data-nav-row
          role="group"
          aria-label="Player"
          className="-mx-2.5 flex h-11 items-center gap-0.5"
        >
          {live ? (
            <LiveParticipation state={state} connected={connected} run={run} quiet />
          ) : (
            <PlaybackTransport state={state} connected={connected} run={run} quiet />
          )}
          <span className="flex-1" />
          <Clock state={state} />
        </div>
      )}
    </div>
  );
}

/** The desk's glass: where it plays above, the deck at its foot (Desk.tsx, Deck). */
export function DeskPanel({
  className,
  children,
  label = "Where it plays",
}: {
  className?: string;
  children: ReactNode;
  label?: string;
}) {
  return (
    <section
      aria-label={label}
      className={cn(
        "desk lit-panel relative flex min-h-0 shrink flex-col px-3.5 pt-1.5 pb-2",
        className,
      )}
    >
      {children}
    </section>
  );
}
