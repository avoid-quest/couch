import { useEffect, useState, type FormEvent } from "react";
import { Check, Plus, UserRound } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import type { WatchingProfile as Profile } from "../shared/library";

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
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !connected) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void fetch(`${origin}/api/profiles`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
    }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load watching profiles.");
      if (!controller.signal.aborted) setProfiles(result.profiles);
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load watching profiles.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [origin, token, connected, open, profile?.id, version, refresh]);

  const update = async (path: string, body?: unknown) => {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`${origin}${path}`, {
        method: "POST", signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not update watching profiles.");
      setRefresh(value => value + 1);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update watching profiles.");
      return false;
    } finally { setPending(false); }
  };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    if (await update("/api/profiles", { name: trimmed })) {
      setName("");
      setNotice(`Created ${trimmed}. Select it below when you are ready to watch.`);
    }
  };

  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button variant="outline" className="watching-profile min-h-11 max-w-full" disabled={!connected} aria-label={`Watching profile: ${profile?.name ?? "Household"}`}><UserRound aria-hidden="true" /><span className="truncate">{profile?.name ?? "Household"}</span></Button></DialogTrigger>
    <DialogContent className="sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>Who is watching?</DialogTitle>
        <DialogDescription>Resume points, watched marks and local media history belong to the selected profile. Household is the shared default. Everyone paired with this TV controls the same profile.</DialogDescription>
      </DialogHeader>
      <p className="text-sm text-muted-foreground">Your connected Jellyfin account keeps its own history. Changing this profile does not change that account.</p>
      {playing && <Alert><AlertDescription>Stop playback before switching profiles. Pausing keeps the current watching profile.</AlertDescription></Alert>}
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {notice && <p className="text-sm text-primary" role="status">{notice}</p>}
      {loading && <p className="text-sm text-muted-foreground" role="status">Loading profiles…</p>}
      <ul className="grid gap-2" aria-label="Watching profiles" aria-busy={loading}>{profiles.map(item => <li key={item.id}>
        <Button variant={profile?.id === item.id ? "secondary" : "outline"} className="min-h-11 h-auto w-full justify-between gap-3 py-3 text-left whitespace-normal" aria-pressed={profile?.id === item.id} disabled={!connected || pending || playing || profile?.id === item.id} onClick={() => void update(`/api/profiles/${encodeURIComponent(item.id)}/select`).then(ok => { if (ok) setOpen(false); })}>
          <span className="min-w-0 break-words">{item.name}</span>{profile?.id === item.id && <Check aria-hidden="true" />}
        </Button>
      </li>)}</ul>
      <Separator />
      <form className="space-y-2" onSubmit={event => void create(event)}>
        <Label htmlFor="watching-profile-name">New watching profile</Label>
        <div className="flex flex-wrap gap-2">
          <Input id="watching-profile-name" className="min-w-0 flex-1" placeholder="Name" autoComplete="off" maxLength={60} required value={name} disabled={!connected || pending} onChange={event => setName(event.target.value)} />
          <Button type="submit" disabled={!connected || pending || !name.trim()}><Plus aria-hidden="true" />{pending ? "Saving…" : "Add profile"}</Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
