import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { useState, type FormEvent } from "react";
import { Settings2 } from "lucide-react";
import { useSessionGate } from "@/session/session-context";
import type { GuideSource } from "../../shared/iptv";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ADMIN_ONLY, deviceName } from "@/copy";

export type GuideRequest = (path: string, init?: RequestInit) => Promise<Response>;
type Props = { inline?: boolean; request: GuideRequest; sources: GuideSource[]; host: boolean; connected: boolean };
const updated = (at: number | null) => at ? `Updated ${new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}` : "Not loaded yet";

export function GuideSources({ inline = false, request, sources, host, connected }: Props) {
  const [open, setOpen] = useState(false);
  const { identity, state, details } = useSessionGate();
  const [editing, setEditing] = useState<GuideSource | null>(null);
  const [removing, setRemoving] = useState<GuideSource | null>(null);
  const [name, setName] = useState("");
  const [playlistUrl, setPlaylistUrl] = useState("");
  const [guideUrl, setGuideUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const administrator = identity?.authority === "host" || identity?.authority === "administrator";

  async function mutate(path: string, method: string, value?: unknown) {
    setBusy(true); setError(null);
    try {
      await request(path, { method, body: value === undefined ? undefined : JSON.stringify(value) });
      return true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Couldn't update this source."); return false; }
    finally { setBusy(false); }
  }
  const edit = (source: GuideSource | null) => { setEditing(source); setName(source?.name ?? ""); setPlaylistUrl(""); setGuideUrl(""); setError(null); };
  async function save(event: FormEvent) {
    event.preventDefault();
    if (await mutate(editing ? `sources/${editing.id}` : "sources", "POST", { name, playlistUrl, guideUrl })) edit(null);
  }
  if (!administrator) return <p className="text-sm text-muted-foreground">{ADMIN_ONLY}</p>;
  const disabled = busy || !connected;
  const content = <>
    <SettingsSection aria-label="Live TV sources">
      {!sources.length && <Empty className="py-0"><EmptyHeader><EmptyDescription>No sources yet. Add an M3U channel list and its XMLTV guide below.</EmptyDescription></EmptyHeader></Empty>}
      {sources.map(source => <SettingsRow key={source.id} label={<span className="break-words">{source.name}</span>} description={<>
        {source.channelCount} channels · {source.programCount} programs · {updated(source.updatedAt)}
        {source.error && <span className="block text-destructive">{source.error}</span>}
      </>}>
        <Button variant="outline" disabled={disabled} onClick={() => void mutate(`sources/${source.id}/refresh`, "POST")}>{source.error ? "Try again" : "Refresh"}</Button>
        <Button variant="ghost" disabled={disabled} onClick={() => edit(source)}>Edit</Button>
        <Button variant="ghost" aria-label={`Remove ${source.name}`} disabled={disabled} onClick={() => setRemoving(source)}>Remove</Button>
      </SettingsRow>)}
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    </SettingsSection>
    <form onSubmit={event => void save(event)}>
      <SettingsSection title={editing ? `Edit ${editing.name}` : "Add source"} description={`URLs stay on ${deviceName(state?.installationName ?? details?.name)}. Channel tvg-id must match the XMLTV id.`}>
        <SettingsRow label="Name" htmlFor="guide-source-name"><Input id="guide-source-name" className="w-full" value={name} maxLength={100} required disabled={disabled} onChange={event => setName(event.target.value)} /></SettingsRow>
        <SettingsRow label="M3U URL" htmlFor="guide-playlist-url"><Input id="guide-playlist-url" className="w-full" type="password" autoComplete="off" inputMode="url" spellCheck={false} autoCapitalize="none" value={playlistUrl} maxLength={4096} required disabled={disabled} onChange={event => setPlaylistUrl(event.target.value)} placeholder="https://…" /></SettingsRow>
        <SettingsRow label="XMLTV URL" htmlFor="guide-xmltv-url"><Input id="guide-xmltv-url" className="w-full" type="password" autoComplete="off" inputMode="url" spellCheck={false} autoCapitalize="none" value={guideUrl} maxLength={4096} required disabled={disabled} onChange={event => setGuideUrl(event.target.value)} placeholder="https://…" /></SettingsRow>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={disabled}>{busy ? "Saving…" : editing ? "Save" : "Add"}</Button>
          {editing && <Button type="button" variant="outline" disabled={busy} onClick={() => edit(null)}>Cancel</Button>}
        </div>
      </SettingsSection>
    </form>
    <AlertDialog open={!!removing} onOpenChange={value => { if (!value) setRemoving(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {removing?.name}?</AlertDialogTitle>
          <AlertDialogDescription>Its channels leave Live TV.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => removing && void mutate(`sources/${removing.id}`, "DELETE")}>Remove</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
  if (inline) return <div className="flex min-w-0 flex-col gap-8">{content}</div>;
  return <Dialog open={open} onOpenChange={value => { setOpen(value); if (!value) edit(null); }}>
    <DialogTrigger asChild><Button variant="outline" data-tv-local-only={host || undefined}><Settings2 aria-hidden="true" />Live TV sources</Button></DialogTrigger>
    <DialogContent className="guide-sources" data-tv-local-only={host || undefined}>
      <DialogHeader><DialogTitle>Live TV</DialogTitle><DialogDescription>An M3U channel list plus its XMLTV guide.</DialogDescription></DialogHeader>
      {content}
    </DialogContent>
  </Dialog>;
}
