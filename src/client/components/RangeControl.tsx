import { useEffect, useRef, useState } from "react";
import { Slider } from "@/components/ui/slider";

export function RangeControl({ label, value, max, disabled, onCommit, showValue = true }: {
  label: string;
  value: number;
  max: number;
  disabled: boolean;
  onCommit: (value: number) => Promise<boolean>;
  showValue?: boolean;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  // A focused keyboard edit keeps its target; command acceptance is not a player observation.
  const keyboard = useRef(false);
  const revision = useRef(0);
  const cancel = () => { keyboard.current = false; revision.current++; setDraft(null); };
  useEffect(() => { if (disabled) cancel(); }, [disabled]);
  const current = Math.min(max, draft ?? value);
  return <Slider
    aria-label={label}
    aria-valuetext={showValue ? `${Math.round(current)} percent` : `${Math.floor(current / 60)} minutes ${Math.floor(current % 60)} seconds`}
    min={0}
    max={Math.max(1, max)}
    step={1}
    value={[current]}
    disabled={disabled}
    onValueChange={values => setDraft(values[0]!)}
    onKeyDown={event => { if (!disabled && ["Home", "End", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown"].includes(event.key)) keyboard.current = true; }}
    onPointerDown={() => { keyboard.current = false; revision.current++; }}
    onValueCommit={values => {
      const committed = ++revision.current;
      void onCommit(values[0]!).then(
        accepted => { if (committed === revision.current && (!accepted || !keyboard.current)) setDraft(null); },
        () => { if (committed === revision.current) setDraft(null); },
      );
    }}
    onBlur={cancel}
    onPointerCancel={cancel}
  />;
}
