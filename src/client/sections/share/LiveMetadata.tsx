import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorText, useSessionGate } from "@/session/session-context";
import type { LiveMetadata, LiveSource } from "../../../shared/live-input";

export function LiveMetadataFields({ value, onChange, disabled, readOnly }: { value: LiveMetadata; onChange: (value: LiveMetadata) => void; disabled?: boolean; readOnly?: boolean }) {
  const id = useId();
  return <div className="grid min-w-0 gap-3">
    {([["title", "Title"], ["description", "Now playing"]] as const).map(([key, label]) => <div key={key} className="grid min-w-0 gap-1.5">
      <label htmlFor={`${id}-${key}`} className="text-body">{label}</label>
      <Input id={`${id}-${key}`} value={value[key] ?? ""} placeholder="Optional" maxLength={200} disabled={disabled} readOnly={readOnly}
        onChange={event => onChange({ ...value, [key]: event.target.value })} />
    </div>)}
  </div>;
}

export function LiveMetadataEditor({ source }: { source: LiveSource }) {
  const { connected, command } = useSessionGate();
  const [draft, setDraft] = useState<LiveMetadata>(source.metadata ?? {});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const dirty = (draft.title?.trim() || "") !== (source.metadata?.title ?? "") || (draft.description?.trim() || "") !== (source.metadata?.description ?? "");
  return <form className="grid min-w-0 gap-3" onSubmit={async event => {
    event.preventDefault();
    if (!connected || busy.current || !dirty) return;
    busy.current = true; setPending(true); setError(null);
    try { await command({ type: "updateLiveMetadata", sourceId: source.id, metadata: { title: draft.title ?? "", description: draft.description ?? "" } }); }
    catch (reason) { setError(errorText(reason)); }
    finally { busy.current = false; setPending(false); }
  }}>
    <LiveMetadataFields value={draft} onChange={setDraft} disabled={!connected} readOnly={pending} />
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button type="submit" variant="secondary" className="justify-self-end" disabled={!connected || !dirty} aria-disabled={pending || undefined} aria-busy={pending || undefined}>{pending ? "Saving…" : "Save details"}</Button>
  </form>;
}
