import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiSend, type ApiCredentials } from "@/api/client";
import { SettingsRow } from "@/components/SettingsRow";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { ADMIN_ONLY } from "@/copy";

type Props = { credentials: ApiCredentials; connected: boolean; administrator: boolean; couch: string; enabled: boolean; locked: boolean };

/** The Couch app's TV mode. Core asks the app to save it and restart; a TV launcher keeps it on. */
export function TvModeSettings({ credentials, connected, administrator, couch, enabled, locked }: Props) {
  const [requested, setRequested] = useState<boolean | null>(null);
  const saving = useMutation({ mutationFn: (value: boolean) => apiSend(credentials, "/api/settings/tv-mode", { enabled: value }) });
  const busy = saving.isPending || saving.isSuccess;
  const description = locked ? `Set by ${couch}'s launcher.`
    : `${couch} opens fullscreen and paired devices can use Remote. Changing it restarts Couch and briefly disconnects devices.${administrator ? "" : ` ${ADMIN_ONLY}`}`;
  return <>
    <SettingsRow data-tv-local-only label="TV mode" description={description}>
      <Switch aria-label="TV mode" checked={enabled} disabled={locked || !administrator || !connected || busy} onCheckedChange={value => { saving.reset(); setRequested(value); }} />
    </SettingsRow>
    <AlertDialog open={requested !== null} onOpenChange={open => { if (!open && !busy) setRequested(null); }}>
      <AlertDialogContent data-tv-local-only onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}>
        <AlertDialogHeader>
          <AlertDialogTitle>{requested ? `Restart ${couch} in TV mode?` : `Restart ${couch} in desktop mode?`}</AlertDialogTitle>
          <AlertDialogDescription>Couch will stop playback and briefly disconnect paired devices. Your library, pairing and network sharing settings stay saved.</AlertDialogDescription>
        </AlertDialogHeader>
        {saving.error && <Alert variant="destructive"><AlertDescription>{saving.error.message}</AlertDescription></Alert>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={busy} onClick={event => { event.preventDefault(); if (requested !== null) saving.mutate(requested); }}>{busy ? "Restarting…" : "Restart Couch"}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}
