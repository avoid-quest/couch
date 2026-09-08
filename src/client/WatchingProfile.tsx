import { useEffect, useState, type FormEvent } from "react";
import { Check, UserRound } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { WatchingProfile as Profile } from "../shared/library";
import { personDisplayName, storedProfileName } from "./profile-name";

export function WatchingProfile({ origin, token, connected, profile, playing, version }: {
  origin: string;
  token: string;
  connected: boolean;
  profile: Profile | undefined;
  playing: boolean;
  version: number;
}) {
  const [open, setOpen] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [editing, setEditing] = useState<Profile>();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stale = editing?.id !== profile?.id || editing?.name !== profile?.name || editing?.personName !== profile?.personName;
  const startEditing = () => { setEditing(profile); setName(profile?.personName ?? ""); setError(null); };

  useEffect(() => {
    if (!open || !connected) return;
    const controller = new AbortController();
    void fetch(`${origin}/api/profiles`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
    }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error("Could not load existing histories.");
      if (!controller.signal.aborted) setProfiles(result.profiles);
    }).catch(() => {
      if (!controller.signal.aborted) setError("Could not load existing histories. Close and reopen to try again.");
    });
    return () => controller.abort();
  }, [origin, token, connected, open, version]);

  const update = async (path: string, body?: unknown) => {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`${origin}${path}`, {
        method: "POST", signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(response.status === 409 ? "The name or active history changed on another remote. Close and reopen to review it." : result.error || "Could not save. Try again.");
      setOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save. Try again.");
    } finally { setPending(false); }
  };

  const saveName = (event: FormEvent) => {
    event.preventDefault();
    if (!editing || stale || !name.trim()) return;
    void update(`/api/profiles/${encodeURIComponent(editing.id)}/person-name`, { name: name.trim(), expectedName: editing.name });
  };

  return <Dialog open={open} onOpenChange={value => { if (value) startEditing(); setOpen(value); }}>
    <DialogTrigger asChild><Button variant="ghost" className="person-name h-11 min-h-11 min-w-11 max-w-40 gap-2 px-2" disabled={!connected || !profile || pending} aria-label={profile?.personName ? `Your name: ${profile.personName}` : "Your name"} title={personDisplayName(profile)}><UserRound className="shrink-0" aria-hidden="true" /><span className="truncate">{personDisplayName(profile)}</span></Button></DialogTrigger>
    <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-md break-words [&>*]:min-w-0">
      <DialogHeader><DialogTitle>Your name</DialogTitle><DialogDescription>Shown on this TV and connected remotes.</DialogDescription></DialogHeader>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <form className="space-y-3" onSubmit={saveName}>
        <Label htmlFor="watching-person-name">Name</Label>
        <Input id="watching-person-name" autoFocus autoComplete="name" maxLength={60} required value={name} disabled={!connected || pending} onChange={event => setName(event.target.value)} />
        {stale && <Alert><AlertDescription>The active history or name changed. Your draft is kept. <Button type="button" variant="outline" className="mt-2 min-h-11" disabled={pending} onClick={startEditing}>Use current name</Button></AlertDescription></Alert>}
        <Button type="submit" className="min-h-11" disabled={!connected || pending || !editing || stale || !name.trim()}>{pending ? "Saving…" : "Save name"}</Button>
      </form>
      {profiles.length > 1 && <details>
        <summary tabIndex={0} className="min-h-11 cursor-pointer content-center rounded-md text-sm focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2">Existing histories</summary>
        {playing && <p className="mb-2 text-sm text-muted-foreground">Stop playback to change history.</p>}
        <ul className="grid gap-2" aria-label="Existing histories">{profiles.map(item => <li key={item.id}>
          <Button variant={profile?.id === item.id ? "secondary" : "outline"} className="min-h-11 h-auto w-full justify-between gap-3 py-3 text-left whitespace-normal" aria-pressed={profile?.id === item.id} disabled={!connected || pending || playing || profile?.id === item.id} onClick={() => void update(`/api/profiles/${encodeURIComponent(item.id)}/select`)}>
            <span className="min-w-0 break-words">{storedProfileName(item) ?? "Original history"}</span>{profile?.id === item.id && <Check aria-hidden="true" />}
          </Button>
        </li>)}</ul>
      </details>}
    </DialogContent>
  </Dialog>;
}
