import { useEffect, useState, type FormEvent } from "react";
import { Check, Pencil, Plus, Trash2, UserRound } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import type { WatchingProfile as Profile } from "../shared/library";
import { personalProfileName, profileDisplayName } from "./profile-name";

export function WatchingProfile({ origin, token, connected, profile, playing, version, caption = false }: {
  origin: string;
  token: string;
  connected: boolean;
  profile: Profile | undefined;
  playing: boolean;
  version: number;
  caption?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [name, setName] = useState("");
  const [personName, setPersonName] = useState("");
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ type: "rename" | "remove"; profile: Profile; name: string } | null>(null);
  const current = profiles.find(item => item.id === edit?.profile.id);
  const stale = !!edit && current?.name !== edit.profile.name;
  const fallback = profiles.find(item => item.id === "household");
  const unnamed = !!profile && !personalProfileName(profile);

  useEffect(() => {
    if (!open || !connected) return;
    const controller = new AbortController();
    setLoading(true);
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
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update watching profiles.");
      return false;
    } finally { setPending(false); setRefresh(value => value + 1); }
  };

  const finishEdit = (removed = false) => {
    setEdit(null);
    requestAnimationFrame(() => {
      const row = removed ? null : document.querySelector(`[data-profile-id="${edit?.profile.id}"]`);
      (row?.querySelector<HTMLButtonElement>(`button[data-action="${edit?.type}"]`) ?? document.querySelector<HTMLInputElement>("#watching-profile-name"))?.focus();
    });
  };

  const saveEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!edit || stale) return;
    if (await update(`/api/profiles/${encodeURIComponent(edit.profile.id)}/${edit.type}`, {
      expectedName: edit.profile.name, ...(edit.type === "rename" ? { name: edit.name } : {}),
    })) {
      setNotice(edit.type === "rename" ? `Name saved as ${edit.name.trim()}.` : `Removed ${profileDisplayName(edit.profile)} and their local history and saved playback preferences.`);
      finishEdit(edit.type === "remove");
    }
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

  const saveName = async (event: FormEvent) => {
    event.preventDefault();
    if (!profile || !personName.trim()) return;
    if (await update(`/api/profiles/${encodeURIComponent(profile.id)}/rename`, { name: personName.trim(), expectedName: profile.name })) {
      setPersonName("");
      setOpen(false);
    }
  };

  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button variant="outline" className="watching-profile min-h-11 max-w-full" disabled={!connected} aria-label={personalProfileName(profile) ? `Watching profile: ${personalProfileName(profile)}` : "Set your name"}><UserRound aria-hidden="true" /><span className="profile-name">{caption && personalProfileName(profile) && <small>Watching as</small>}<span className="truncate">{personalProfileName(profile) ?? "Set your name"}</span></span></Button></DialogTrigger>
    <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl break-words [&>*]:min-w-0">
      <DialogHeader>
        <DialogTitle>Who is watching?</DialogTitle>
        <DialogDescription>Choose the person watching this TV. Their resume points, watched marks and playback preferences stay with their profile. All paired remotes use the same selection.</DialogDescription>
      </DialogHeader>
      <p className="text-sm text-muted-foreground">Your connected Jellyfin account keeps its own history. Changing this profile does not change that account.</p>
      {playing && <Alert><AlertDescription>Stop playback before switching or removing profiles. Pausing keeps the current watching profile. You can still rename a profile.</AlertDescription></Alert>}
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {notice && <p className="text-sm text-primary" role="status">{notice}</p>}
      {loading && <p className="text-sm text-muted-foreground" role="status">Loading profiles…</p>}
      {edit ? <form className="min-w-0 space-y-3" aria-label={edit.type === "rename" ? "Rename watching profile" : "Remove watching profile"} onSubmit={event => void saveEdit(event)}>
        <p className="break-words font-medium">{edit.type === "rename" ? "Rename" : "Remove"} {profileDisplayName(edit.profile)}</p>
        {stale && <Alert><AlertDescription>
          {current ? `Another remote renamed this profile to ${current.name}. Review the name before continuing. Your draft is kept.` : "Another remote removed this profile. Return to the list to choose another profile."}
          {current && <Button type="button" variant="outline" className="mt-2 min-h-11" disabled={pending} onClick={() => { setEdit({ ...edit, profile: current }); setError(null); }}>Use current profile</Button>}
        </AlertDescription></Alert>}
        {edit.type === "rename" ? <>
          <Label htmlFor="watching-profile-rename">Profile name</Label>
          <Input id="watching-profile-rename" autoFocus autoComplete="off" maxLength={60} required value={edit.name} disabled={!connected || pending} onChange={event => setEdit({ ...edit, name: event.target.value })} />
          <p className="text-sm text-muted-foreground">The new name keeps this profile's saved playback preferences, resume points, watched marks and local history.</p>
        </> : <div className="space-y-2 text-sm text-muted-foreground">
          <p>This permanently removes {profileDisplayName(edit.profile)}'s local resume points, watched marks, media history and saved playback preferences from this TV.</p>
          <p>Other viewers' history and preferences stay unchanged. If this profile is selected when removed, {profileDisplayName(fallback)} becomes the watching profile.</p>
          <p>Your Jellyfin account and its history, paired remotes and administrator access stay unchanged.</p>
        </div>}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="min-h-11" autoFocus={edit.type === "remove"} disabled={pending} onClick={() => finishEdit()}>Cancel</Button>
          <Button type="submit" variant={edit.type === "remove" ? "destructive" : "default"} className="min-h-11" disabled={!connected || pending || stale || loading || (edit.type === "remove" ? playing : !edit.name.trim())}>
            {pending ? "Saving…" : edit.type === "rename" ? "Save name" : "Remove profile"}
          </Button>
        </div>
      </form> : <>
      {unnamed && <form className="space-y-3 rounded-lg border p-4" aria-label="Set your name" onSubmit={event => void saveName(event)}>
        <div className="space-y-1"><Label htmlFor="watching-profile-person-name">Your name</Label><p className="text-sm text-muted-foreground">This profile has no personal name yet. Add yours to keep using its existing history and preferences.</p></div>
        <Input id="watching-profile-person-name" autoFocus autoComplete="given-name" maxLength={60} required value={personName} disabled={!connected || pending} onChange={event => setPersonName(event.target.value)} />
        <Button type="submit" className="min-h-11" disabled={!connected || pending || !personName.trim()}>{pending ? "Saving…" : "Save name"}</Button>
      </form>}
      <ul className="grid gap-2" aria-label="Watching profiles" aria-busy={loading}>{profiles.map(item => <li key={item.id} data-profile-id={item.id} className="min-w-0 space-y-1 rounded-lg border p-2">
        <Button variant={profile?.id === item.id ? "secondary" : "outline"} className="min-h-11 h-auto w-full justify-between gap-3 py-3 text-left whitespace-normal" aria-pressed={profile?.id === item.id} disabled={!connected || pending || playing || profile?.id === item.id} onClick={() => void update(`/api/profiles/${encodeURIComponent(item.id)}/select`).then(ok => { if (ok) setOpen(false); })}>
          <span className="min-w-0 break-words">{profileDisplayName(item)}</span>{profile?.id === item.id && <Check aria-hidden="true" />}
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" className="min-h-11" data-action="rename" aria-label={`Rename ${profileDisplayName(item)}`} disabled={!connected || pending} onClick={() => { setError(null); setNotice(null); setEdit({ type: "rename", profile: item, name: personalProfileName(item) ?? "" }); }}><Pencil aria-hidden="true" />Rename</Button>
          {item.id !== "household" && <Button variant="ghost" className="min-h-11" data-action="remove" aria-label={`Remove ${item.name}`} disabled={!connected || pending || playing} onClick={() => { setError(null); setNotice(null); setEdit({ type: "remove", profile: item, name: item.name }); }}><Trash2 aria-hidden="true" />Remove</Button>}
        </div>
      </li>)}</ul>
      <Separator />
      <form className="space-y-2" onSubmit={event => void create(event)}>
        <Label htmlFor="watching-profile-name">New watching profile</Label>
        <div className="flex flex-wrap gap-2">
          <Input id="watching-profile-name" className="min-w-0 flex-1" placeholder="Name" autoComplete="off" maxLength={60} required value={name} disabled={!connected || pending} onChange={event => setName(event.target.value)} />
          <Button type="submit" disabled={!connected || pending || !name.trim()}><Plus aria-hidden="true" />{pending ? "Saving…" : "Add profile"}</Button>
        </div>
      </form>
      </>}
    </DialogContent>
  </Dialog>;
}
