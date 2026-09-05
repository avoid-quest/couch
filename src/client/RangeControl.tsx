import { useState } from "react";
import { Slider } from "@/components/ui/slider";

export function RangeControl({ label, value, max, disabled, onCommit, showValue = true }: {
  label: string;
  value: number;
  max: number;
  disabled: boolean;
  onCommit: (value: number) => Promise<void>;
  showValue?: boolean;
}) {
  const [draft, setDraft] = useState<number | null>(null);
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
    onValueCommit={values => { void onCommit(values[0]!).finally(() => setDraft(null)); }}
    onPointerCancel={() => setDraft(null)}
  />;
}
