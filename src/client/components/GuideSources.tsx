import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { useRef, useState, type FormEvent, type RefObject } from "react";
import { useSessionGate } from "@/session/session-context";
import type { GuideSource } from "../../shared/iptv";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { ItemMenu, useItemMenu } from "@/components/RowMenu";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ADMIN_ONLY, deviceName } from "@/copy";
import { notice } from "@/toasts";

export type GuideRequest = (path: string, init?: RequestInit) => Promise<Response>;
type Props = { request: GuideRequest; sources: GuideSource[]; connected: boolean };
const updated = (at: number | null) => at ? `updated ${new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}` : "not loaded yet";
const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** A source's Edit and Remove beside its Refresh, behind its "…". Edit reveals the form after the menu closes. */
function Options({ source, disabled, nameField, onEdit, onRemove }: { source: GuideSource; disabled: boolean; nameField: RefObject<HTMLInputElement | null>; onEdit: () => void; onRemove: () => void }) {
  const menu = useItemMenu([
    { label: "Edit", run: () => { onEdit(); nameField.current?.focus(); } },
    { label: "Remove", run: onRemove },
  ]);
  return <ItemMenu menu={menu} title={source.name} disabled={disabled} runAfterClose />;
}

export function GuideSources({ request, sources, connected }: Props) {
  const { identity, state, details } = useSessionGate();
  const [editing, setEditing] = useState<GuideSource | null>(null);
  const [removing, setRemoving] = useState<GuideSource | null>(null);
  const [name, setName] = useState("");
  const [playlistUrl, setPlaylistUrl] = useState("");
  const [guideUrl, setGuideUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const nameField = useRef<HTMLInputElement>(null);
  // Where the last error belongs: the form that submitted, or the source list.
  const [error, setError] = useState<{ at: "form" | "list"; message: string } | null>(null);
  const administrator = identity?.authority === "host" || identity?.authority === "administrator";

  async function mutate(path: string, method: string, value?: unknown, at: "form" | "list" = "list") {
    setBusy(true); setError(null);
    try {
      const response = await request(path, { method, body: value === undefined ? undefined : JSON.stringify(value) });
      const { source, skipped } = method === "POST" ? await response.json().catch(() => ({})) as { source?: GuideSource; skipped?: { headers: number; duplicates: number } } : {};
      // The list shows what was added; only what was left out is unexpected.
      if (source && skipped && skipped.headers + skipped.duplicates) {
        const count = skipped.headers + skipped.duplicates, channels = `${count} channel${count === 1 ? "" : "s"}`;
        notice(!skipped.duplicates ? `Skipped ${channels} needing custom headers or DRM.` : !skipped.headers ? `Skipped ${channels} with a repeated tvg-id.` : `Skipped ${channels}: custom headers, DRM or a repeated tvg-id.`);
      }
      return true;
    } catch (reason) { setError({ at, message: reason instanceof Error ? reason.message : "Couldn't update this source." }); return false; }
    finally { setBusy(false); }
  }
  const edit = (source: GuideSource | null) => { setEditing(source); setName(source?.name ?? ""); setPlaylistUrl(""); setGuideUrl(""); setError(null); };
  async function save(event?: FormEvent, removeGuide = false) {
    event?.preventDefault();
    // null tells Core to remove the saved guide; a blank URL keeps it.
    if (await mutate(editing ? `sources/${editing.id}` : "sources", "POST", { name, playlistUrl, guideUrl: removeGuide ? null : guideUrl }, "form")) edit(null);
  }
  if (!administrator) return <SettingsSection><SettingsRow label="Channel lists" description={ADMIN_ONLY} /></SettingsSection>;
  const disabled = busy || !connected;
  // Saved URLs never come back from Core, so Edit keeps them unless a new one is typed.
  const placeholder = editing ? "Leave blank to keep it" : "https://…";
  return <div className="flex min-w-0 flex-col gap-8">
    <SettingsSection aria-label="Live TV sources">
      {!sources.length && <Empty className="py-0"><EmptyHeader><EmptyDescription>No sources yet. Add an M3U channel list below, with its XMLTV guide if you have one.</EmptyDescription></EmptyHeader></Empty>}
      {sources.map(source => <SettingsRow key={source.id} label={<span className="break-words">{source.name}</span>} description={<>
        {[count(source.channelCount, "channel"), count(source.programCount, "program"), updated(source.updatedAt)].join(", ")}
        {source.error && <span className="block text-destructive">{source.error}</span>}
      </>}>
        <Button variant="outline" disabled={disabled} onClick={() => void mutate(`sources/${source.id}/refresh`, "POST")}>{source.error ? "Try again" : "Refresh"}</Button>
        <Options source={source} disabled={disabled} nameField={nameField} onEdit={() => edit(source)} onRemove={() => setRemoving(source)} />
      </SettingsRow>)}
      {error?.at === "list" && <Alert variant="destructive"><AlertDescription>{error.message}</AlertDescription></Alert>}
    </SettingsSection>
    <form onSubmit={event => void save(event)}>
      <SettingsSection title={editing ? `Edit ${editing.name}` : "Add source"} description={`URLs stay on ${deviceName(state?.installationName ?? details?.name)}. The XMLTV guide is optional; channel tvg-id must match its id.`}>
        <SettingsRow label="Name" htmlFor="guide-source-name"><Input ref={nameField} id="guide-source-name" className="w-full" value={name} maxLength={100} required disabled={disabled} onChange={event => setName(event.target.value)} /></SettingsRow>
        <SettingsRow label="M3U URL" htmlFor="guide-playlist-url"><Input id="guide-playlist-url" className="w-full" type="password" inputMode="url" autoComplete="off" spellCheck={false} autoCapitalize="none" value={playlistUrl} maxLength={4096} required={!editing} disabled={disabled} onChange={event => setPlaylistUrl(event.target.value)} placeholder={placeholder} /></SettingsRow>
        <SettingsRow label="XMLTV URL" htmlFor="guide-xmltv-url"><Input id="guide-xmltv-url" className="w-full" type="password" inputMode="url" autoComplete="off" spellCheck={false} autoCapitalize="none" value={guideUrl} maxLength={4096} disabled={disabled} onChange={event => setGuideUrl(event.target.value)} placeholder={editing ? placeholder : "Optional"} /></SettingsRow>
        {error?.at === "form" && <Alert variant="destructive"><AlertDescription>{error.message}</AlertDescription></Alert>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={disabled}>{busy ? "Saving…" : editing ? "Save" : "Add"}</Button>
          {editing?.hasGuide && <Button type="button" variant="outline" disabled={disabled} onClick={() => void save(undefined, true)}>Remove guide</Button>}
          {editing && <Button type="button" variant="ghost" disabled={busy} onClick={() => edit(null)}>Cancel</Button>}
        </div>
      </SettingsSection>
    </form>
    <AlertDialog open={!!removing} onOpenChange={value => { if (!value) setRemoving(null); }}>
      <AlertDialogContent data-tv-local-only>
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
  </div>;
}
