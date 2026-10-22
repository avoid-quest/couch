import { useContext, useEffect, useRef } from "react";
import { SessionGateContext } from "@/session/gate-context";
import { levelOf } from "@/playback-status";
import { cn } from "@/lib/utils";

/**
 * Three bars that say sound is coming out (index.css): they move while it plays and lie flat while it doesn't. Sized
 * by the font (1em), in the current ink.
 */
export function Level({ moving, className }: { moving: boolean; className?: string }) {
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const level = root.current;
    if (!moving || !level || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    return step(level);
  }, [moving]);
  return <span ref={root} aria-hidden="true" data-level={moving ? "moving" : "flat"} className={cn("level", className)}><span /><span /><span /></span>;
}

/*
 * The bars move in steps, about eight a second, from one clock for every level on the page. A continuous animation
 * (CSS or Web Animations) makes the browser draw every frame for as long as something plays, and the now-playing bar's
 * glass blurs what lies under it again on each of those frames; eight steps keep the bars alive for a fraction of that.
 * Each bar rises and falls at its own pace (seconds per rise and fall) from its own start.
 */
const paces = [{ period: 1.8, phase: 0 }, { period: 1.28, phase: .23 }, { period: 2.2, phase: .23 }];
const levels = new Set<HTMLElement>();
let clock: ReturnType<typeof setInterval> | undefined;
const height = (seconds: number, { period, phase }: { period: number; phase: number }) => .25 + .75 * (.5 - .5 * Math.cos(2 * Math.PI * (seconds / period + phase)));
function tick() {
  const seconds = performance.now() / 1000;
  for (const level of levels) for (const [index, bar] of [...level.children].entries()) (bar as HTMLElement).style.transform = `scaleY(${height(seconds, paces[index]!).toFixed(2)})`;
}
function step(level: HTMLElement) {
  levels.add(level);
  clock ??= setInterval(tick, 125);
  tick();
  return () => {
    levels.delete(level);
    for (const bar of level.children) (bar as HTMLElement).style.removeProperty("transform");
    if (!levels.size) { clearInterval(clock); clock = undefined; }
  };
}

/** The level of an item in a list, by its addresses (levelOf): null unless it is what plays. */
export function useLevel(sources: string | readonly (string | undefined)[] | undefined) {
  const gate = useContext(SessionGateContext);
  if (!sources || !gate) return null;
  return levelOf(gate.state, gate.connected, typeof sources === "string" ? [sources] : sources);
}

/**
 * The level on a playing item's artwork: a black square in its bottom-left corner with the bars in white, flat like
 * every other surface. `className` sizes it. Only while sound comes out: a paused chip's flat bars read as a "…".
 */
export function ArtLevel({ level, className }: { level: "moving" | "flat" | null; className?: string }) {
  if (level !== "moving") return null;
  return <span data-art-level className={cn("absolute bottom-0 left-0 z-10 grid size-7 place-items-center bg-background text-sm text-foreground", className)}><Level moving={level === "moving"} /></span>;
}
