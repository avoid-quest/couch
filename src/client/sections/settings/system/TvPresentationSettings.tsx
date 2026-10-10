import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { SettingsRow } from "@/components/SettingsRow";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { couchApp } from "@/session/native-context";

export function TvPresentationSettings() {
  const [requested, setRequested] = useState<boolean | null>(null);
  const saving = useMutation({ mutationFn: (enabled: boolean) => couchApp!.setTvPresentation!(enabled) });
  if (!couchApp?.setTvPresentation) return null;
  return <>
    <SettingsRow data-tv-local-only label="TV mode" description={couchApp.tvPresentationLocked ? "Set by this app's launcher." : "Open fullscreen and let paired devices use Remote. Turn on Share on network in Devices to allow connections."}>
      <Switch aria-label="TV mode" checked={couchApp.tvPresentation} disabled={couchApp.tvPresentationLocked || saving.isPending || saving.isSuccess} onCheckedChange={enabled => { saving.reset(); setRequested(enabled); }} />
    </SettingsRow>
    <AlertDialog open={requested !== null} onOpenChange={open => { if (!open && !saving.isPending && !saving.isSuccess) setRequested(null); }}>
      <AlertDialogContent data-tv-local-only onEscapeKeyDown={event => { if (saving.isPending || saving.isSuccess) event.preventDefault(); }}>
        <AlertDialogHeader>
          <AlertDialogTitle>{requested ? "Restart in TV mode?" : "Restart in desktop mode?"}</AlertDialogTitle>
          <AlertDialogDescription>Couch will stop playback and briefly disconnect paired devices. Your library, pairing and network sharing settings stay saved. You can change this again in Settings &gt; General on this computer.</AlertDialogDescription>
        </AlertDialogHeader>
        {saving.error && <Alert variant="destructive"><AlertDescription>{saving.error.message}</AlertDescription></Alert>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={saving.isPending || saving.isSuccess}>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={saving.isPending || saving.isSuccess} onClick={event => { event.preventDefault(); if (requested !== null) saving.mutate(requested); }}>{saving.isPending || saving.isSuccess ? "Restarting…" : "Restart Couch"}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}
