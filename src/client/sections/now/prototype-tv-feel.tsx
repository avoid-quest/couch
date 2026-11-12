// PROTOTYPE, throwaway (branch prototype/tv-controller-feel, never main): the TV's volume gauge (L1/R1), Info over a
// video (Triangle) and the rest when nothing plays (/prototype-rest?variant=A|B|C), all on real session data.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Volume2, VolumeX } from "lucide-react";
import { Description } from "@/components/DetailHeader";
import { titleFit, titleLength } from "@/components/Stage";
import { MediaArtwork } from "@/components/MediaArtwork";
import { CouchMark } from "@/components/CouchMark";
import { DigitalClock } from "@/components/DigitalClock";
import { Button } from "@/components/ui/button";
import { useSessionGate } from "@/session/session-context";
import { deviceId } from "@/session/device-id";
import type { ClientSessionState } from "@/session/session";
import type { QueueEntry } from "../../../shared/protocol";

const ceiling = 80;

/** L1/R1 step the volume by 2; the gauge shows for 2 s after any change, from here or another device. */
export function PrototypeVolumeGauge() {
  const { state, run } = useSessionGate();
  const level = Math.round(state?.player.volume ?? 0);
  const [shownAt, setShownAt] = useState(0);
  const [, rerender] = useState(0);
  const previous = useRef(level);
  useEffect(() => {
    if (previous.current === level) return;
    previous.current = level;
    setShownAt(Date.now());
  }, [level]);
  useEffect(() => {
    const step = (event: Event) => {
      const by = (event as CustomEvent<{ by: number; repeat: boolean }>).detail;
      setShownAt(Date.now());
      // Holding never raises past the ceiling; a fresh press does.
      if (by.repeat && by.by > 0 && level >= ceiling) return;
      void run({ type: "volume", volume: Math.max(0, Math.min(100, level + by.by)) });
    };
    window.addEventListener("couch-volume-step", step);
    return () => window.removeEventListener("couch-volume-step", step);
  }, [level, run]);
  useEffect(() => {
    if (!shownAt) return;
    const timer = setTimeout(() => rerender((n) => n + 1), 2000);
    return () => clearTimeout(timer);
  }, [shownAt]);
  if (!state || !shownAt || Date.now() - shownAt >= 2000) return null;
  const sounding = state.outputs?.find((output) => output.sound)?.deviceId ?? deviceId();
  const where = state.devices?.find((device) => device.id === sounding)?.name;
  const muted = state.devices?.find((device) => device.id === sounding)?.muted;
  return (
    <div
      role="status"
      aria-label={`Volume ${level}`}
      className="fixed top-1/2 right-[max(2rem,var(--gutter))] z-50 grid w-20 -translate-y-1/2 justify-items-center gap-3 rounded-full bg-(--bar)/90 py-5 shadow-[var(--float-shadow)] backdrop-blur"
    >
      {muted ? <VolumeX className="size-6" /> : <Volume2 className="size-6" />}
      <div className="relative h-64 w-4 overflow-hidden rounded-full bg-white/15">
        <div className="absolute inset-x-0 bottom-0 bg-white" style={{ height: `${level}%` }} />
        <div
          className="absolute -inset-x-1 h-px bg-destructive"
          style={{ bottom: `${ceiling}%` }}
        />
      </div>
      <span className="font-display text-3xl font-bold tabular-nums">{level}</span>
      {where && <span className="px-2 text-center text-xs text-muted-foreground">{where}</span>}
    </div>
  );
}

/** Info over a picture: what plays, its facts and end time, its description and what plays next. */
export function PrototypeVideoInfo({
  state,
  current,
  title,
  byline,
  context,
  ends,
  details,
}: {
  state: ClientSessionState;
  current: QueueEntry;
  title: string;
  byline: string;
  context: ReactNode;
  ends: ReactNode;
  details: ReactNode;
}) {
  const index = state.queue.findIndex((entry) => entry.id === state.currentEntryId);
  const next =
    state.queue[index + 1] ?? (state.autoplay?.enabled ? state.autoplay.upcoming[0] : undefined);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
  }, []);
  return (
    <div
      ref={panel}
      data-prototype-info
      className="absolute inset-x-0 bottom-0 z-30 grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] items-end gap-12 bg-linear-to-t from-black/95 from-55% to-transparent px-(--gutter) pt-24 pb-10 duration-200 motion-safe:animate-in motion-safe:fade-in-0"
    >
      <div className="grid min-w-0 gap-3">
        <h2
          data-length={titleLength(title)}
          style={titleFit(title)}
          className="display-title min-w-0 text-balance"
        >
          {title}
        </h2>
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 text-base text-muted-foreground [&_[data-media-context]]:text-base">
          {byline && <span>{byline}</span>}
          {context}
          <span className="tabular-nums">{ends}</span>
        </div>
        <Description text={current.description} />
        <div className="mt-2 flex gap-2">{details}</div>
      </div>
      {next && (
        <div
          className="grid justify-self-end gap-2 text-sm text-muted-foreground"
          style={{ width: "62%" }}
        >
          <span>Up next</span>
          {next.thumbnail && (
            <div className="aspect-video overflow-hidden rounded-md">
              <MediaArtwork thumbnail={next.thumbnail} title={next.title} />
            </div>
          )}
          <span className="line-clamp-2 text-base text-foreground">{next.title}</span>
          {next.subtitle && <span className="truncate">{next.subtitle}</span>}
        </div>
      )}
    </div>
  );
}

const variants = [
  { key: "A", name: "Mark" },
  { key: "B", name: "Clock" },
  { key: "C", name: "Clock and mark" },
];

/** Nothing plays: what the TV rests on. */
export function PrototypeRest({ variant }: { variant: string }) {
  const { connected, state } = useSessionGate();
  const navigate = useNavigate();
  const name = state?.devices?.find((device) => device.id === deviceId())?.name;
  const at = variants.findIndex((item) => item.key === variant);
  const go = (by: number) =>
    void navigate({
      to: "/prototype-rest",
      search: { variant: variants[(at + by + variants.length) % variants.length]!.key },
      replace: true,
    });
  return createPortal(
    <div className="fixed inset-0 z-50 bg-background">
      {variant === "A" && (
        <div className="grid h-full place-items-center">
          <CouchMark connected={connected} className="size-28" />
        </div>
      )}
      {variant === "B" && (
        <div className="absolute bottom-[12%] left-(--gutter) grid gap-2">
          <DigitalClock className="font-display text-[9rem] leading-none font-extrabold tracking-[-0.04em] text-foreground normal-nums" />
          {name && <span className="text-xl text-muted-foreground">{name}</span>}
        </div>
      )}
      {variant === "C" && (
        <div className="grid h-full place-items-center">
          <div className="grid justify-items-center gap-6">
            <CouchMark connected={connected} className="size-14" />
            <DigitalClock className="font-display text-[6rem] leading-none font-bold tracking-[-0.03em] text-foreground normal-nums" />
            {name && <span className="text-lg text-muted-foreground">{name}</span>}
          </div>
        </div>
      )}
      <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-dashed border-white/40 bg-black/80 px-2 py-1 text-sm">
        <Button variant="ghost" size="icon" aria-label="Previous variant" onClick={() => go(-1)}>
          <ChevronLeft />
        </Button>
        <span>
          Prototype {variants[at]?.key} ({variants[at]?.name})
        </span>
        <Button variant="ghost" size="icon" aria-label="Next variant" onClick={() => go(1)}>
          <ChevronRight />
        </Button>
      </div>
    </div>,
    document.body,
  );
}
