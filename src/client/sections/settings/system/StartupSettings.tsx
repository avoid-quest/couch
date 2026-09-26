import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SettingsRow } from "@/components/SettingsRow";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import { TRY_AGAIN } from "@/copy";
import { apiSend } from "@/api/client";
import { startupQuery } from "@/api/settings";
import type { StartupState } from "../../../../shared/startup";
import type { ApiCredentials } from "@/api/client";

type Props = { credentials: ApiCredentials; connected: boolean };

export function StartupSettings({ credentials, connected }: Props) {
  const queryClient = useQueryClient();
  const startup = useQuery({ ...startupQuery(credentials), enabled: connected });
  const state = startup.data;
  const saving = useMutation({
    mutationFn: (enabled: boolean) => apiSend<StartupState>(credentials, "/api/settings/startup", { enabled }),
    onSuccess: result => { queryClient.setQueryData(startupQuery(credentials).queryKey, result); },
  });
  const error = saving.error ? saving.error.message || "Couldn't save. Try again." : startup.error ? "Couldn't read startup." : null;
  const fullscreen = state && (state.fullscreenAtLaunch ? "Opens fullscreen." : "Opens in a window.");

  return <>
    <SettingsRow label="Start on boot" description={<><span data-startup-mode>{state?.enabled ? "Couch starts automatically." : "Login screen at boot."}</span> {fullscreen}</>}>
      <Switch aria-label="Start on boot" checked={saving.isPending ? saving.variables : !!state?.enabled} disabled={!connected || !state || saving.isPending} onCheckedChange={enabled => saving.mutate(enabled)} />
    </SettingsRow>
    <Collapsible>
      <CollapsibleTrigger asChild><Button variant="ghost" className="-ml-2.5 text-muted-foreground">Startup recovery</Button></CollapsibleTrigger>
      <CollapsibleContent className="pt-2 text-sm text-muted-foreground">
        Over SSH: <code>sudo couch-session autostart enable</code>, then <code>sudo systemctl restart lightdm</code>. For logs and restarts: <code>sudo couch-session logs</code>, <code>sudo couch-session restart</code>.
      </CollapsibleContent>
    </Collapsible>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription><AlertAction><Button variant="outline" size="sm" disabled={!connected} onClick={() => { saving.reset(); void startup.refetch(); }}>{TRY_AGAIN}</Button></AlertAction></Alert>}
  </>;
}
