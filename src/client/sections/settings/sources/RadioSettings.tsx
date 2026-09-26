import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { avoidRadioPlaylistId, type RadioPlaylist } from "../../../../shared/radio";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ADMIN_ONLY } from "@/copy";
import { apiFetch } from "@/api/client";
import { radioSourcesQuery } from "@/api/radio";
import type { SourceCredentials, SourceSettingsProps } from "@/components/sourceTypes";

const empty: SourceCredentials = { origin: "", token: "" };
const updated = (at: number | null) => at ? `Updated ${new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}` : "Not imported yet";

export function RadioSettings({ credentials, connected, canManage }: SourceSettingsProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [removing, setRemoving] = useState<RadioPlaylist | null>(null);
  const available = connected && canManage && !!credentials;
  const page = useQuery({ ...radioSourcesQuery(credentials ?? empty), enabled: available });
  const mutation = useMutation({
    mutationFn: async ({ path, method, body }: { path: string; method: string; body?: { name: string; url: string } }) => {
      const response = await apiFetch(credentials!, `/api/radio/${path}`, { method, ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
      const result = response.status === 204 ? null : await response.json() as { playlist?: RadioPlaylist };
      if (result?.playlist?.error) throw new Error(result.playlist.error);
      return result?.playlist;
    },
    onSuccess: async (playlist, { method, body }) => {
      toast(method === "DELETE" ? "Removed." : `${playlist?.name}: ${playlist?.stationCount} stations.`);
      if (body) { setName(""); setUrl(""); }
      await queryClient.invalidateQueries({ queryKey: ["radio"] });
    },
  });
  const canWrite = available && !mutation.isPending;
  const update = (path: string, method: string, body?: { name: string; url: string }) => { if (canWrite) mutation.mutate({ path, method, body }); };
  const sources = page.data?.sources ?? [];
  const builtIn = sources.find(source => source.id === avoidRadioPlaylistId);
  const error = mutation.error ? mutation.error.message || "Couldn't update radio playlists." : page.error ? "Couldn't load radio playlists." : null;

  function add(event: FormEvent) {
    event.preventDefault();
    update("playlists", "POST", { name: name.trim(), url: url.trim() });
  }

  if (!canManage) return <p className="text-sm text-muted-foreground">{ADMIN_ONLY}</p>;
  return (
    <div className="flex min-w-0 flex-col gap-8" data-radio-settings>
      <SettingsSection aria-label="Radio playlists">
        {available && page.isPending && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Loading…</p>}
        {page.data && <SettingsRow data-avoid-radio label="avoid radio" description={<>{["Built in", builtIn?.updatedAt && `${builtIn.stationCount} stations`, builtIn?.updatedAt && updated(builtIn.updatedAt)].filter(Boolean).join(" · ")}{builtIn?.error && <span className="block text-destructive">{builtIn.error}</span>}</>}>
          <Button variant="outline" disabled={!canWrite} onClick={() => update("avoid?refresh=true", "GET")}>Update stations</Button>
        </SettingsRow>}
        {sources.filter(source => source.id !== avoidRadioPlaylistId).map(source => (
          <SettingsRow key={source.id} data-radio-source-id={source.id} label={<span className="break-words">{source.name}</span>} description={<>
            <span className="block break-all">{source.url}</span>
            <span className="block">{source.updatedAt ? `${source.stationCount} stations · ${updated(source.updatedAt)}` : updated(null)}</span>
            {source.error && <span className="block text-destructive">{source.error}{source.updatedAt && " Showing the last stations."}</span>}
          </>}>
            <Button variant="outline" disabled={!canWrite} onClick={() => update(`playlists/${encodeURIComponent(source.id)}/refresh`, "POST")}>Update stations</Button>
            <Button variant="ghost" disabled={!canWrite} onClick={() => setRemoving(source)}>Remove</Button>
          </SettingsRow>
        ))}
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      </SettingsSection>
      <form onSubmit={add}>
        <SettingsSection title="Add playlist" description="An extended M3U URL. Adding it again refreshes it.">
          <SettingsRow label="Name" htmlFor="radio-source-name">
            <Input className="w-full" disabled={!canWrite} id="radio-source-name" maxLength={200} onChange={event => setName(event.target.value)} placeholder="My stations" required value={name} />
          </SettingsRow>
          <SettingsRow label="M3U URL" htmlFor="radio-source-url">
            <Input className="w-full" disabled={!canWrite} id="radio-source-url" maxLength={4096} onChange={event => setUrl(event.target.value)} placeholder="https://example.com/playlist.m3u" required type="url" value={url} />
          </SettingsRow>
          <div><Button type="submit" disabled={!canWrite || !name.trim() || !url.trim()}>{mutation.isPending && mutation.variables?.body ? "Adding…" : "Add"}</Button></div>
        </SettingsSection>
      </form>
      <AlertDialog open={!!removing} onOpenChange={open => { if (!open) setRemoving(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing?.name}?</AlertDialogTitle>
            <AlertDialogDescription>Saved stations stay.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => removing && update(`playlists/${encodeURIComponent(removing.id)}`, "DELETE")}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
