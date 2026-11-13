import { Slider } from "@videojs/react";
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { formatDuration } from "@/time-format";
import { cn } from "@/lib/utils";
import { PlaybackThumbnail } from "./PlaybackThumbnail";

/** One playback/source identity per mount. Video.js owns input; only Couch commits transport. */
export function PlaybackSeekBar({
  value,
  max,
  disabled,
  playbackId,
  buffered,
  pageFirst,
  onCommit,
  children,
}: {
  value: number;
  max: number;
  disabled: boolean;
  playbackId: string | null;
  buffered: number | null;
  pageFirst: boolean;
  onCommit: (position: number) => Promise<boolean>;
  children?: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<number | null>(null);
  const target = useRef<number | null>(null);
  const keyboardFrom = useRef<number | null>(null);
  const pointer = useRef<number | null>(null);
  const released = useRef<number | null>(null);
  const revision = useRef(0);
  const clamp = (position: number) => Math.max(0, Math.min(max, position));
  const current = clamp(draft ?? value);
  const update = (position: number | null, from: number | null = null) => {
    target.current = position;
    keyboardFrom.current = from;
    setDraft(position);
  };
  const cancel = () => {
    revision.current++;
    released.current = null;
    const id = pointer.current;
    pointer.current = null;
    update(null);
    if (id !== null && root.current?.hasPointerCapture(id)) root.current.releasePointerCapture(id);
  };
  useLayoutEffect(() => {
    if (disabled) cancel();
  }, [disabled]);
  useLayoutEffect(() => {
    const from = keyboardFrom.current;
    if (draft === null || from === null) return;
    // An acknowledgement can precede the clock during buffering. Keep repeated
    // keys cumulative until playback reaches the seek, then follow its position.
    const position = clamp(draft);
    const moved =
      position === from ? value !== from : position > from ? value > from : value < from;
    const passed = position > from ? value >= position : position < from && value <= position;
    // Core also confirms within two seconds: mpv can first report after the target.
    if (moved && (passed || Math.abs(value - position) <= 2)) update(null);
  }, [value, draft, max]);
  useLayoutEffect(
    () => () => {
      revision.current++;
      pointer.current = null;
      released.current = null;
    },
    [],
  );
  const commit = (position = released.current, keyboard = false) => {
    // Video.js also commits on lost capture/button loss. Those are cancellations in Couch.
    if (disabled || position === null) return;
    released.current = null;
    pointer.current = null;
    const committed = ++revision.current;
    void onCommit(clamp(position)).then(
      (accepted) => {
        if (committed === revision.current && (!accepted || !keyboard)) update(null);
      },
      () => {
        if (committed === revision.current) update(null);
      },
    );
  };
  // A unit interval keeps fractional durations exact at both endpoints; ARIA and commands use seconds.
  return (
    <div className="relative">
      <Slider.Root
        ref={root}
        data-slot="slider"
        data-playback-seek
        data-seeking={draft !== null || undefined}
        label="Playback position"
        min={0}
        max={1}
        step={1e-9}
        value={current / max}
        disabled={disabled}
        className="group/slider relative flex h-6 w-full cursor-pointer items-center touch:min-h-11 select-none data-disabled:cursor-default data-disabled:opacity-50"
        onValueChange={(fraction) => {
          if (!disabled && pointer.current !== null) update(clamp(fraction * max));
        }}
        onValueCommit={() => commit()}
        onPointerDownCapture={(event) => {
          if (disabled || event.button !== 0 || !event.isPrimary || pointer.current !== null) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          revision.current++;
          released.current = null;
          pointer.current = event.pointerId;
        }}
        onPointerMoveCapture={(event) => {
          if (disabled || (event.pointerType === "touch" && pointer.current === null)) {
            event.stopPropagation();
            return;
          }
          if (pointer.current !== null && event.pointerId !== pointer.current) {
            event.stopPropagation();
            return;
          }
          if (pointer.current !== null && event.pointerType !== "touch" && event.buttons === 0) {
            cancel();
            event.stopPropagation();
          }
        }}
        onPointerUpCapture={(event) => {
          if (disabled || event.pointerId !== pointer.current) {
            event.stopPropagation();
            return;
          }
          // Preserve the displayed seconds even if duration changed during the drag.
          released.current = clamp(target.current ?? value);
        }}
        onPointerCancel={cancel}
        onLostPointerCapture={() => {
          if (pointer.current !== null) cancel();
        }}
        onBlur={cancel}
        onKeyDownCapture={(event) => {
          if (disabled || event.altKey || event.ctrlKey || event.metaKey) return;
          if (event.key === "Escape") {
            if (target.current !== null || pointer.current !== null) {
              event.preventDefault();
              event.stopPropagation();
              cancel();
            }
            return;
          }
          if (event.key === "ArrowDown") {
            const play = event.currentTarget
              .closest(".player-page")
              ?.querySelector<HTMLElement>("[data-play-button]:not(:disabled)");
            if (play) {
              event.preventDefault();
              event.stopPropagation();
              play.focus();
              return;
            }
          }
          const delta = {
            ArrowLeft: -10,
            ArrowRight: 10,
            ArrowUp: 10,
            ArrowDown: -10,
            PageUp: 60,
            PageDown: -60,
          }[event.key];
          if (delta === undefined && event.key !== "Home" && event.key !== "End") return;
          event.preventDefault();
          event.stopPropagation();
          const position = clamp(
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? max
                : clamp(target.current ?? value) + delta!,
          );
          if (pointer.current !== null) cancel();
          update(position === value && target.current === null ? null : position, value);
          commit(position, true);
        }}
      >
        <Slider.Track
          data-slot="slider-track"
          className="relative h-1 w-full rounded-full bg-muted"
        >
          {buffered !== null && (
            <div
              data-slot="slider-buffered"
              className="absolute inset-y-0 left-0 rounded-full bg-foreground/35"
              style={{ width: `${(clamp(buffered) / max) * 100}%` }}
            />
          )}
          <Slider.Fill
            data-slot="slider-range"
            className="absolute inset-y-0 left-0 w-(--media-slider-fill) rounded-full bg-primary"
          />
        </Slider.Track>
        <Slider.Thumb
          data-slot="slider-thumb"
          data-page-first={pageFirst || undefined}
          aria-valuenow={current}
          aria-valuemax={max}
          aria-valuetext={`${Math.floor(current / 60)} minutes ${Math.floor(current % 60)} seconds of ${Math.floor(max / 60)} minutes ${Math.floor(max % 60)} seconds`}
          className="absolute left-(--media-slider-fill) block size-3 -translate-x-1/2 rounded-full border border-ring bg-foreground ring-ring/30 after:absolute after:-inset-2 group-not-data-disabled/slider:group-hover/slider:ring-2 focus-visible:ring-2 focus-visible:outline-hidden"
        />
        <Slider.Preview
          data-timeline-preview
          aria-hidden="true"
          className="bottom-[calc(50%+.5rem)] rounded-sm bg-background text-center text-meta tabular-nums"
          style={
            draft !== null
              ? ({ "--media-slider-pointer": "var(--media-slider-fill)" } as CSSProperties)
              : undefined
          }
          render={(props, state) => (
            <div {...props} hidden={disabled || (!state.pointing && draft === null)} />
          )}
        >
          {/* Value subscribes to pointer position without rendering the track or labels. Its public render
            prop feeds our on-demand cache; standalone Thumbnail keeps same-cue cropping memoized. */}
          <Slider.Value
            type={draft === null ? "pointer" : "current"}
            format={String}
            render={(props, state) => {
              const time =
                disabled || (!state.pointing && draft === null)
                  ? null
                  : clamp(Number(props.children) * max);
              return (
                <div>
                  {playbackId && <PlaybackThumbnail playbackId={playbackId} time={time} />}
                  <output
                    {...props}
                    data-hover-time={time === null ? undefined : ""}
                    className="block px-1.5 py-0.5"
                  >
                    {time === null ? null : formatDuration(Math.round(time))}
                  </output>
                </div>
              );
            }}
          />
        </Slider.Preview>
      </Slider.Root>
      {/* Marks over the track, outside the slider: Video.js restyles the slider's whole subtree on every pointer move. */}
      {children && (
        <div
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2",
            disabled && "opacity-50",
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}
