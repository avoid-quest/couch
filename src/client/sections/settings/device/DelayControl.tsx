import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function DelayControl({ id, label, value, disabled, onApply }: {
  id: string; label: string; value: number; disabled: boolean; onApply: (delay: number) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function apply(event: FormEvent) {
    event.preventDefault();
    if (draft === null) return;
    setPending(true);
    try { if (await onApply(Number(draft))) setDraft(null); } finally { setPending(false); }
  }

  return (
    <form className="grid gap-2" onSubmit={event => void apply(event)}>
      <Label htmlFor={id}>{label} <span className="font-normal text-muted-foreground">seconds</span></Label>
      <div className="flex gap-2 [&_input]:min-w-0">
        <Input id={id} className="min-h-11" type="number" min={-10} max={10} step={0.1} required value={draft ?? Number(value.toFixed(2))} disabled={disabled || pending} onChange={event => setDraft(event.target.value)} />
        <Button type="submit" variant="secondary" className="min-h-11" disabled={disabled || pending || draft === null}>{pending ? "Applying…" : "Apply"}</Button>
      </div>
    </form>
  );
}
