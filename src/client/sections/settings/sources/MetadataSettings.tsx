import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiSend } from "@/api/client";
import { metadataProviderQuery } from "@/api/library";
import tmdbLogo from "../../../tmdb-logo.svg";
import type { SourceCredentials } from "@/components/sourceTypes";

type Props = { credentials: SourceCredentials | null; connected: boolean; canManage: boolean };
const empty: SourceCredentials = { origin: "", token: "" };

export function MetadataSettings({ credentials, connected, canManage }: Props) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const available = connected && canManage && !!credentials;
  const page = useQuery({ ...metadataProviderQuery(credentials ?? empty), enabled: available });
  const saving = useMutation({
    mutationFn: (clear: boolean) => apiSend<{ configured: boolean; provider: string }>(credentials!, "/api/metadata/provider", { token: clear ? "" : token }),
    onSuccess: value => { queryClient.setQueryData(metadataProviderQuery(credentials!).queryKey, value); setToken(""); setConfirmClear(false); },
  });
  const pending = saving.isPending;
  const error = saving.error ? saving.error.message || "Could not save metadata setup." : null;
  const notice = saving.isSuccess ? saving.variables ? "TMDB token cleared. Saved metadata remains available." : "TMDB token saved on the TV. Use a video's metadata editor to search and preview a match." : null;

  function save(event: FormEvent, clear = false) {
    event.preventDefault();
    if (credentials && available && !pending) saving.mutate(clear);
  }

  return (
    <section aria-label="TMDB metadata settings" className="space-y-3 border-t pt-4" data-tv-local-only>
      <h3 className="font-semibold">Movie and episode metadata</h3>
      <p className="text-sm text-muted-foreground">Manual corrections and exports work offline. TMDB search requires your authorized API Read Access Token. The saved token stays on the TV and is never returned to remotes.</p>
      {canManage ? (
        <form className="space-y-3" onSubmit={save}>
          <p className="text-sm" role="status">{page.isFetching ? "Checking TMDB setup…" : page.data?.configured ? "TMDB token configured" : "TMDB is not configured"}</p>
          <Label htmlFor="metadata-token">TMDB API Read Access Token</Label>
          <Input autoComplete="new-password" className="min-h-11" disabled={!available || pending} id="metadata-token" maxLength={2048} onChange={event => setToken(event.target.value)} spellCheck={false} type="password" value={token} />
          <div className="flex flex-wrap gap-2">
            <Button className="min-h-11" disabled={!available || pending || !token} type="submit">Save TMDB token</Button>
            {page.data?.configured && !confirmClear && <Button className="min-h-11" disabled={!available || pending} onClick={() => setConfirmClear(true)} type="button" variant="outline">Clear TMDB token</Button>}
          </div>
          {confirmClear && <div role="group" aria-label="Confirm clearing TMDB token" className="space-y-2 border-t pt-3"><p>Clear the saved TMDB token? Saved metadata stays available.</p><div className="flex flex-wrap gap-2"><Button type="button" variant="destructive" disabled={!available || pending} onClick={event => void save(event, true)}>Clear token</Button><Button type="button" variant="outline" disabled={pending} onClick={() => setConfirmClear(false)}>Cancel</Button></div></div>}
        </form>
      ) : <p className="text-sm">Use an administrator remote to configure TMDB.</p>}
      {(page.error || error) && <Alert variant="destructive"><AlertDescription>{error ?? "Could not read metadata setup."}</AlertDescription></Alert>}
      {notice && <p className="text-sm" role="status">{notice}</p>}
      <div aria-label="TMDB credits" className="space-y-2 text-xs text-muted-foreground">
        <a className="inline-block min-h-11 content-center" href="https://www.themoviedb.org" rel="noreferrer" target="_blank"><img alt="TMDB" className="w-24" src={tmdbLogo} /></a>
        <p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
      </div>
    </section>
  );
}
