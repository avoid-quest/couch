import { useMutation } from "@tanstack/react-query";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { couchApp } from "@/session/native-context";

export function QuitAppSettings({ host, couch }: { host: boolean; couch: string }) {
  const quitting = useMutation({ mutationFn: () => couchApp!.quit!() });
  if (!couchApp?.quit) return null;
  return <SettingsSection data-tv-local-only>
    <SettingsRow label="Quit Couch" description={host ? `Stops this app and ${couch}, the Couch it runs. Devices using it will disconnect.` : `Stops this app. ${couch} keeps playing.`}>
      <Button variant="outline" disabled={quitting.isPending} onClick={() => quitting.mutate()}>{quitting.isPending ? "Quitting…" : "Quit Couch"}</Button>
    </SettingsRow>
    {quitting.error && <Alert variant="destructive"><AlertDescription>{quitting.error.message}</AlertDescription></Alert>}
  </SettingsSection>;
}
