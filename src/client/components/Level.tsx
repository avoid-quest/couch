import { useContext } from "react";
import { SessionGateContext } from "@/session/gate-context";
import { levelOf } from "@/playback-status";
import { cn } from "@/lib/utils";

/**
 * Three bars that say sound is coming out (index.css): they move while it plays and lie flat while it doesn't. Sized
 * by the font (1em), in the current ink.
 */
export function Level({ moving, className }: { moving: boolean; className?: string }) {
  return <span aria-hidden="true" data-level={moving ? "moving" : "flat"} className={cn("level", className)}><span /><span /><span /></span>;
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
