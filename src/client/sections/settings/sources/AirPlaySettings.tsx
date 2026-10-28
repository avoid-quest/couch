import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiSend, type ApiCredentials } from "@/api/client";
import { airplayQuery } from "@/api/settings";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ADMIN_ONLY } from "@/copy";
import type { AirPlayAvailability, AirPlayState } from "../../../../shared/airplay";

/** The Couch receives AirPlay sound as a shared source; only an admin turns it on. */
export function AirPlaySettings({ availability, credentials, connected, administrator, couch }: { availability?: AirPlayAvailability; credentials: ApiCredentials | null; connected: boolean; administrator: boolean; couch: string }) {
  if (!availability || availability === "unsupported") return null;
  const description = `Play sound from an iPhone, iPad or Mac on this network through ${couch}. It appears in Shared sources while a device plays.`;
  if (!administrator || !credentials) return availability === "unavailable"
    ? <SettingsSection><SettingsRow label="AirPlay" description="The AirPlay receiver isn't available on this Couch." /></SettingsSection>
    : <SettingsSection title="AirPlay" description={description}><SettingsRow label="Receive AirPlay" description={ADMIN_ONLY} /></SettingsSection>;
  return <AirPlayControls credentials={credentials} connected={connected} description={description} />;
}

function AirPlayControls({ credentials, connected, description }: { credentials: ApiCredentials; connected: boolean; description: string }) {
  const client = useQueryClient();
  const query = useQuery({ ...airplayQuery(credentials), enabled: connected });
  const saved = (result: AirPlayState) => client.setQueryData(airplayQuery(credentials).queryKey, result);
  const toggle = useMutation({ mutationFn: (enabled: boolean) => apiSend<AirPlayState>(credentials, "/api/settings/airplay", { enabled }), onSuccess: saved });
  const renew = useMutation({ mutationFn: () => apiSend<AirPlayState>(credentials, "/api/settings/airplay/code", {}), onSuccess: saved });
  const state = query.data;
  const usable = !!state && state.status !== "unsupported" && state.status !== "unavailable";
  const status = !state ? null
    : state.status === "receiving" ? `${state.sender} is sending sound. Playback starts automatically on this Couch.`
    : state.status === "ready" ? `Ready. On your device, choose ${state.name} in AirPlay and enter ${state.code} the first time.`
    : state.status === "starting" ? "Starting AirPlay…"
    : state.status === "waiting" ? "Waiting for Share on network. AirPlay listens only while this Couch is shared on the network."
    : null;
  const failure = state?.error ?? query.error?.message ?? toggle.error?.message ?? renew.error?.message;
  // Off where it can't run: another platform hides it, a build or computer without the receiver says why in one line.
  if (state?.status === "unsupported" && !state.enabled) return null;
  if (state?.status === "unavailable" && !state.enabled) return <SettingsSection><SettingsRow label="AirPlay" description={state.error} /></SettingsSection>;
  return <SettingsSection title="AirPlay" description={description}>
    <SettingsRow label="Receive AirPlay" description={<span role="status">{status ?? "Sound only. It plays a few seconds behind the sending device."}</span>}>
      <Switch aria-label="Receive AirPlay" checked={toggle.isPending ? toggle.variables : state?.enabled ?? false} disabled={!connected || !state || !usable && !state.enabled || toggle.isPending || renew.isPending} onCheckedChange={enabled => toggle.mutate(enabled)} />
    </SettingsRow>
    {state?.enabled && usable && <SettingsRow label="Code" description="A device asks for it as its AirPlay password the first time it plays here. A new code makes every device enter it again.">
      <span className="mr-auto text-sm tabular-nums">{state.code}</span>
      {/* The trigger takes focus back when the dialog closes, so it stays enabled while the change is sent. */}
      <AlertDialog>
        <AlertDialogTrigger asChild><Button variant="outline" disabled={!connected || toggle.isPending}>{renew.isPending ? "Changing…" : "New code"}</Button></AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change the AirPlay code?</AlertDialogTitle>
            <AlertDialogDescription>AirPlay restarts now{state?.sender ? `, so ${state.sender} stops playing here` : ""}. Every device that played here before must enter the new code the next time.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={renew.isPending} onClick={() => renew.mutate()}>New code</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsRow>}
    {failure && <Alert variant="destructive"><AlertDescription>{failure}</AlertDescription>{query.isError && <AlertAction><Button variant="outline" onClick={() => void query.refetch()}>Try again</Button></AlertAction>}</Alert>}
  </SettingsSection>;
}
