import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Slider } from "@/components/ui/slider";
import { isTvPresentation } from "@/session/presentation";

// The timeline can observe drafts without lifting hover state into its slider or labels.
export const RangePreviewContext = createContext<((value: number | null) => void) | null>(null);

// A remote moves volume and faders 5 per press; the playback position passes its own 10 s step.
export function RangeControl({ label, value, max, disabled, onCommit, showValue = true, keyboardStep = isTvPresentation() ? 5 : 1, pageFirst = false, orientation, buffered }: {
  label: string;
  value: number;
  max: number;
  disabled: boolean;
  onCommit: (value: number) => Promise<boolean>;
  showValue?: boolean;
  keyboardStep?: number;
  pageFirst?: boolean;
  orientation?: "horizontal" | "vertical";
  buffered?: number | null;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const preview = useContext(RangePreviewContext);
  const updateDraft = (next: number | null) => { setDraft(next); preview?.(next); };
  // A focused keyboard edit keeps its target; command acceptance is not a player observation.
  const keyboard = useRef(false);
  const revision = useRef(0);
  const canceled = useRef(false);
  const pointer = useRef<number | null>(null);
  const cancel = () => { canceled.current = true; pointer.current = null; keyboard.current = false; revision.current++; updateDraft(null); };
  useEffect(() => () => { revision.current++; }, []);
  useEffect(() => { if (disabled) cancel(); }, [disabled]);
  const current = Math.max(0, Math.min(max, draft ?? value));
  const [less, more] = orientation === "vertical" ? ["ArrowDown", "ArrowUp"] : ["ArrowLeft", "ArrowRight"];
  const commit = (next: number) => {
    if (disabled || canceled.current) return;
    const committed = ++revision.current;
    void onCommit(Math.max(0, Math.min(max, next))).then(
      accepted => { if (committed === revision.current && (!accepted || !keyboard.current)) updateDraft(null); },
      () => { if (committed === revision.current) updateDraft(null); },
    );
  };
  return <Slider
    orientation={orientation}
    buffered={buffered}
    data-page-first={pageFirst || undefined}
    aria-label={label}
    aria-valuetext={showValue ? `${Math.round(current)} percent` : `${Math.floor(current / 60)} minutes ${Math.floor(current % 60)} seconds`}
    min={0}
    max={Math.max(1, max)}
    step={1}
    value={[current]}
    disabled={disabled}
    onValueChange={values => { if (!disabled && !canceled.current) updateDraft(values[0]!); }}
    onKeyDownCapture={event => {
      if (disabled) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancel(); return; }
      canceled.current = false;
      if (keyboardStep !== 1 && (event.key === less || event.key === more)) {
        event.preventDefault(); event.stopPropagation();
        keyboard.current = true;
        const next = Math.max(0, Math.min(max, current + (event.key === less ? -keyboardStep : keyboardStep)));
        updateDraft(next); commit(next);
      }
      if (label === "Playback position" && event.key === "ArrowDown") {
        const play = event.currentTarget.closest(".player-page")?.querySelector<HTMLElement>("[data-play-button]:not(:disabled)");
        if (play) { event.preventDefault(); event.stopPropagation(); play.focus(); }
      }
    }}
    onKeyDown={event => { if (!disabled && ["Home", "End", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown"].includes(event.key)) keyboard.current = true; }}
    onPointerDown={event => { if (disabled || event.button !== 0) { event.preventDefault(); return; } canceled.current = false; pointer.current = event.pointerId; keyboard.current = false; revision.current++; }}
    onPointerUp={() => { pointer.current = null; }}
    onLostPointerCapture={() => { if (pointer.current !== null) cancel(); }}
    onValueCommit={values => commit(values[0]!)}
    onBlur={cancel}
    onPointerCancel={cancel}
  />;
}
