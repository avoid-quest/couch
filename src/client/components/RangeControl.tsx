import { useEffect, useRef, useState } from "react";
import { Slider } from "@/components/ui/slider";

export function RangeControl({ label, value, max, disabled, onCommit, showValue = true, keyboardStep = 1, pageFirst = false }: {
  label: string;
  value: number;
  max: number;
  disabled: boolean;
  onCommit: (value: number) => Promise<boolean>;
  showValue?: boolean;
  keyboardStep?: number;
  pageFirst?: boolean;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  // A focused keyboard edit keeps its target; command acceptance is not a player observation.
  const keyboard = useRef(false);
  const revision = useRef(0);
  const cancel = () => { keyboard.current = false; revision.current++; setDraft(null); };
  useEffect(() => { if (disabled) cancel(); }, [disabled]);
  const current = Math.min(max, draft ?? value);
  const commit = (next: number) => {
    const committed = ++revision.current;
    void onCommit(next).then(
      accepted => { if (committed === revision.current && (!accepted || !keyboard.current)) setDraft(null); },
      () => { if (committed === revision.current) setDraft(null); },
    );
  };
  return <Slider
    data-page-first={pageFirst || undefined}
    aria-label={label}
    aria-valuetext={showValue ? `${Math.round(current)} percent` : `${Math.floor(current / 60)} minutes ${Math.floor(current % 60)} seconds`}
    min={0}
    max={Math.max(1, max)}
    step={1}
    value={[current]}
    disabled={disabled}
    onValueChange={values => setDraft(values[0]!)}
    onKeyDownCapture={event => {
      if (disabled) return;
      if (keyboardStep !== 1 && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault(); event.stopPropagation();
        keyboard.current = true;
        const next = Math.max(0, Math.min(max, current + (event.key === "ArrowLeft" ? -keyboardStep : keyboardStep)));
        setDraft(next); commit(next);
      }
      if (label === "Playback position" && event.key === "ArrowDown") {
        const play = event.currentTarget.closest(".player-page")?.querySelector<HTMLElement>("[data-play-button]:not(:disabled)");
        if (play) { event.preventDefault(); event.stopPropagation(); play.focus(); }
      }
    }}
    onKeyDown={event => { if (!disabled && ["Home", "End", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown"].includes(event.key)) keyboard.current = true; }}
    onPointerDown={() => { keyboard.current = false; revision.current++; }}
    onValueCommit={values => commit(values[0]!)}
    onBlur={cancel}
    onPointerCancel={cancel}
  />;
}
