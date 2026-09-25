import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** A seconds field with Apply; the settings row supplies its label. */
export function DelayControl({ id, value, disabled, onApply }: {
  id: string; value: number; disabled: boolean; onApply: (delay: number) => Promise<boolean>;
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
    <form className="flex items-center gap-2" onSubmit={event => void apply(event)}>
      <Input id={id} className="w-24" type="number" min={-10} max={10} step={0.1} required value={draft ?? Number(value.toFixed(2))} disabled={disabled || pending} onChange={event => setDraft(event.target.value)} />
      <span className="text-sm text-muted-foreground">s</span>
      <Button type="submit" variant="outline" disabled={disabled || pending || draft === null}>{pending ? "Applying…" : "Apply"}</Button>
    </form>
  );
}
