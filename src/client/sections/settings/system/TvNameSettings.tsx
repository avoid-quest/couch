import { useEffect, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiSend, type ApiCredentials } from "@/api/client";

type Props = { credentials: ApiCredentials; connected: boolean; canWrite: boolean; host: boolean; name?: string };

// The name arrives with every session snapshot; saving it bumps the controllers revision.
export function TvNameSettings({ credentials, connected, canWrite, host, name: savedName }: Props) {
  const [draft, setDraft] = useState("");
  const saving = useMutation({ mutationFn: (name: string) => apiSend(credentials, "/api/settings", { name }) });
  const pending = saving.isPending;
  const error = saving.error ? saving.error instanceof Error ? saving.error.message : "Could not save settings." : null;
  const notice = saving.isSuccess ? "Playback device name saved." : null;

  useEffect(() => setDraft(savedName ?? ""), [savedName]);

  function save(event: FormEvent) {
    event.preventDefault();
    if (canWrite && !pending) saving.mutate(draft.trim());
  }

  return (
    <section className="space-y-3">
      {canWrite ? (
        <form className="settings-choice-row grid grid-cols-[16rem_minmax(0,1fr)] items-start gap-4 border-t border-border py-3 max-[900px]:grid-cols-1" onSubmit={save}>
            <Label htmlFor="tv-name">Playback device name</Label>
          <div className="flex flex-wrap items-center gap-2"><Input id="tv-name" className="min-h-11 min-w-48 flex-1" value={draft} onChange={event => setDraft(event.target.value)} maxLength={60} required disabled={!connected || pending} aria-describedby="tv-name-help" /><Button type="submit" className="min-h-11" disabled={!connected || pending || !draft.trim() || draft.trim() === savedName}>{pending ? "Saving…" : "Save"}</Button></div>
          <div className="col-start-2 max-[900px]:col-start-1"><p id="tv-name-help" className="text-muted-foreground">Name shown for the selected playback computer.</p></div>
        </form>
      ) : (
        <div className="space-y-1">
          <h3>Playback device name</h3>
          <p className="break-words" data-settings-tv-name>{savedName || "Couch"}</p>
          <p className="text-muted-foreground">{credentials ? "An administrator can change this playback computer's name." : host ? "Pair this browser to control the playback computer." : "An administrator can change this playback computer's name."}</p>
        </div>
      )}
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
