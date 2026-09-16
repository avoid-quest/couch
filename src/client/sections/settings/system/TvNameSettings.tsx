import { useEffect, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch, type ApiCredentials } from "@/api/client";

type Props = { credentials: ApiCredentials; connected: boolean; canWrite: boolean; host: boolean };

export function TvNameSettings({ credentials, connected, canWrite, host }: Props) {
  const queryClient = useQueryClient();
  const queryKey = ["settings", "tv-name", credentials.origin, credentials.token];
  const name = useQuery({
    queryKey,
    enabled: connected,
    queryFn: () => apiFetch(credentials, "/api/settings").then(response => response.json() as Promise<{ name: string }>),
    retry: false,
  });
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const savedName = name.data?.name;

  useEffect(() => setDraft(savedName ?? ""), [savedName]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!canWrite || pending) return;
    setPending(true); setError(null); setNotice(null);
    try {
      await apiFetch(credentials, "/api/settings", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: draft.trim() }),
      });
      await queryClient.invalidateQueries({ queryKey });
      setNotice("TV name saved.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save settings.");
    } finally { setPending(false); }
  }

  return (
    <section className="space-y-3">
      {canWrite ? (
        <form className="space-y-3" onSubmit={event => void save(event)}>
          <div className="space-y-2">
            <Label htmlFor="tv-name">TV name</Label>
            <Input id="tv-name" className="min-h-11" value={draft} onChange={event => setDraft(event.target.value)} maxLength={60} required disabled={!connected || pending} aria-describedby="tv-name-help" />
          </div>
          <p id="tv-name-help" className="text-muted-foreground">Name shown for this TV.</p>
          <Button type="submit" className="min-h-11" disabled={!connected || pending || !draft.trim() || draft.trim() === savedName}>{pending ? "Saving…" : "Save TV name"}</Button>
        </form>
      ) : (
        <div className="space-y-1">
          <p className="font-medium">TV name</p>
          <p className="break-words" data-settings-tv-name>{savedName || "Couch"}</p>
          <p className="text-muted-foreground">{credentials ? "An administrator can change this TV's name." : host ? "Pair this browser to control the TV." : "An administrator can change this TV's name."}</p>
        </div>
      )}
      {(name.error || error) && <Alert variant="destructive"><AlertDescription>{error ?? "Could not load settings."}</AlertDescription></Alert>}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
