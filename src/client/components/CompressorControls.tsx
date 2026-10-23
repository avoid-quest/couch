import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { compressorParameters, defaultCompressor, type CompressorParameter, type CompressorSettings } from "../../shared/compressor";
import type { Action } from "../../shared/protocol";

const parameters = Object.keys(compressorParameters) as CompressorParameter[];

export function CompressorControls({ settings, playbackId, unavailable, run }: {
  settings: CompressorSettings;
  playbackId: string;
  unavailable?: string;
  run: (action: Action) => Promise<boolean>;
}) {
  const id = useId();
  const [open, setOpen] = useState(false), [pending, setPending] = useState(false);
  const [draft, setDraft] = useState<Partial<Record<CompressorParameter, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const value = (name: CompressorParameter) => draft[name] ?? String(settings[name]);
  const valid = (name: CompressorParameter) => value(name).trim() !== "" && Number.isFinite(Number(value(name))) && Number(value(name)) >= compressorParameters[name].min && Number(value(name)) <= compressorParameters[name].max;
  const dirty = parameters.filter(name => draft[name] !== undefined && Number(draft[name]) !== settings[name]);
  const disabled = !!unavailable || pending;
  const save = async (patch: Partial<CompressorSettings>, applied = false) => {
    setPending(true); setError(null);
    try {
      if (await run({ type: "compressor", playbackId, settings: patch })) { if (applied) setDraft({}); }
      else setError("Couldn't update the compressor. Try again.");
    } catch { setError("Couldn't update the compressor. Try again."); }
    finally { setPending(false); }
  };
  return <Collapsible open={open} onOpenChange={setOpen} className="mb-2">
    <div data-nav-row className="flex min-h-11 items-center gap-2" title={unavailable}>
      <Label htmlFor={id} className="flex-1 text-base font-normal">Compressor</Label>
      <CollapsibleTrigger asChild><Button variant="ghost" size="sm" aria-label="Advanced compressor settings">Advanced <ChevronDown aria-hidden="true" className={open ? "rotate-180" : undefined} /></Button></CollapsibleTrigger>
      <Switch id={id} disabled={disabled} checked={settings.enabled} onCheckedChange={enabled => void save({ enabled })} aria-describedby={unavailable ? `${id}-unavailable` : undefined} />
    </div>
    {unavailable && <p id={`${id}-unavailable`} className="text-sm text-muted-foreground">{unavailable}</p>}
    <CollapsibleContent className="grid gap-2 pb-2">
      {parameters.map(name => {
        const { label, unit, min, max, step } = compressorParameters[name];
        const number = Number(value(name)), display = Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : settings[name];
        return <div key={name} data-nav-row className="grid min-h-11 grid-cols-[6.5rem_minmax(0,1fr)_5rem_2rem] items-center gap-3 max-sm:grid-cols-[6rem_minmax(0,1fr)_4.5rem_1.5rem] max-sm:gap-2">
          <Label htmlFor={`${id}-${name}`} className="font-normal" title={name === "gain" ? "Gain after compression; browser automatic makeup still applies." : undefined}>{label}</Label>
          <Slider aria-label={label} aria-valuetext={`${display}${unit === ":1" ? unit : ` ${unit}`}`} min={min} max={max} step={step} value={[display]} disabled={disabled} onValueChange={values => setDraft(current => ({ ...current, [name]: String(values[0]!) }))} />
          <Input id={`${id}-${name}`} type="number" inputMode="decimal" min={min} max={max} step={step} value={value(name)} disabled={disabled} aria-invalid={!valid(name)} aria-label={`${label} value`} onChange={event => setDraft(current => ({ ...current, [name]: event.target.value }))} className="px-2 text-right tabular-nums" />
          <span className="text-sm text-muted-foreground">{unit}</span>
        </div>;
      })}
      <div data-nav-row className="flex items-center justify-between gap-2 pt-1">
        <Button variant="ghost" disabled={disabled} onClick={() => setDraft(Object.fromEntries(parameters.map(name => [name, String(defaultCompressor[name])])))}>Reset to default</Button>
        <Button disabled={disabled || !dirty.length || !parameters.every(valid)} onClick={() => void save(Object.fromEntries(dirty.map(name => [name, Number(value(name))])), true)}>{pending ? "Applying…" : "Apply"}</Button>
      </div>
    </CollapsibleContent>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </Collapsible>;
}
