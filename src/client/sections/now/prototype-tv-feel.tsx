// PROTOTYPE, throwaway (branch prototype/clean-player, never main): Info over a video and the rest when nothing plays (/prototype-rest?variant=A|B|C), all on real session data.
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
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
      className={`absolute inset-x-0 bottom-0 z-30 grid items-end gap-x-12 gap-y-6 bg-linear-to-t from-black/95 from-55% to-transparent px-(--gutter) pt-24 pb-10 duration-200 motion-safe:animate-in motion-safe:fade-in-0 ${next ? "sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]" : ""}`}
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
          className="grid gap-2 text-sm text-muted-foreground max-sm:hidden sm:justify-self-end"
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
