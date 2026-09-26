import { Spinner } from "@/components/ui/spinner";
import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ADMIN_ONLY, deviceName } from "@/copy";
import { apiSend } from "@/api/client";
import { metadataProviderQuery } from "@/api/library";
import tmdbLogo from "../../../tmdb-logo.svg";
import type { SourceCredentials, SourceSettingsProps } from "@/components/sourceTypes";

const empty: SourceCredentials = { origin: "", token: "" };

export function MetadataSettings({ credentials, connected, canManage, hostName }: SourceSettingsProps) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const available = connected && canManage && !!credentials;
  const page = useQuery({ ...metadataProviderQuery(credentials ?? empty), enabled: available });
  const saving = useMutation({
    mutationFn: (clear: boolean) => apiSend<{ configured: boolean; provider: string }>(credentials!, "/api/metadata/provider", { token: clear ? "" : token }),
    onSuccess: (value, clear) => { queryClient.setQueryData(metadataProviderQuery(credentials!).queryKey, value); setToken(""); toast(clear ? "Token cleared." : "Token saved. Use Edit details on any video to match it."); },
  });
  const pending = saving.isPending;
  const error = saving.error ? saving.error.message || "Couldn't save the token." : page.error ? "Couldn't read TMDB setup." : null;

  function save(event: FormEvent) {
    event.preventDefault();
    if (credentials && available && !pending) saving.mutate(false);
  }

  return (
    <SettingsSection aria-label="Movie & show info settings" description={`Add a TMDB token to match videos. It stays on ${deviceName(hostName)}.`} data-tv-local-only>
      {canManage ? <SettingsRow label="TMDB token" htmlFor="metadata-token" description={<span role="status" className="flex items-center gap-2">{page.isFetching && <Spinner />}{page.isFetching ? "Checking…" : page.data?.configured ? "Token saved" : "No token"}</span>}>
        <form className="flex w-full flex-wrap items-center gap-2" onSubmit={save}>
          <Input autoComplete="new-password" className="min-w-0 flex-1" disabled={!available || pending} id="metadata-token" maxLength={2048} onChange={event => setToken(event.target.value)} placeholder="TMDB read access token" spellCheck={false} type="password" value={token} />
          <Button type="submit" variant="outline" disabled={!available || pending || !token}>Save</Button>
          {page.data?.configured && <AlertDialog>
            <AlertDialogTrigger asChild><Button type="button" variant="ghost" disabled={!available || pending}>Clear</Button></AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Clear the token?</AlertDialogTitle>
                <AlertDialogDescription>Matched details stay.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => saving.mutate(true)}>Clear</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>}
        </form>
      </SettingsRow> : <p className="text-sm text-muted-foreground">{ADMIN_ONLY}</p>}
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription>{page.error && !saving.error && <AlertAction><Button variant="outline" size="sm" disabled={!available} onClick={() => void page.refetch()}>Try again</Button></AlertAction>}</Alert>}
      <div aria-label="TMDB credits" className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <a href="https://www.themoviedb.org" rel="noreferrer" target="_blank"><img alt="TMDB" className="w-20" src={tmdbLogo} /></a>
        <p className="min-w-0 flex-1">This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
      </div>
    </SettingsSection>
  );
}
