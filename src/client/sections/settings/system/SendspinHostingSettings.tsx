import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiSend, type ApiCredentials } from "@/api/client";
import { sendspinHostingQuery } from "@/api/settings";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { SendspinHostingState } from "../../../../shared/sendspin";

export function SendspinHostingSettings({ credentials, connected }: { credentials: ApiCredentials; connected: boolean }) {
  const queryClient = useQueryClient();
  const hosting = useQuery({ ...sendspinHostingQuery(credentials), enabled: connected });
  const save = useMutation({
    mutationFn: (enabled: boolean) => apiSend<SendspinHostingState>(credentials, "/api/settings/sendspin", { enabled }),
    onSuccess: state => queryClient.setQueryData(sendspinHostingQuery(credentials).queryKey, state),
  });
  const state = connected ? hosting.data : undefined;
  const error = save.error?.message || hosting.error?.message;

  return <SettingsSection title="Synchronized audio (Sendspin)" description="Let this Couch play audio on multiple devices together.">
    <SettingsRow label="Enable synchronized audio" description={state?.error ? "Unavailable. Check the error below." : state?.active ? "Available for synchronized audio." : state?.enabled ? "Ready when needed." : "Off."}>
      <Switch aria-label="Enable synchronized audio" checked={state?.enabled ?? false} disabled={!connected || !state || save.isPending} onCheckedChange={enabled => save.mutate(enabled)} />
    </SettingsRow>
    {state?.configuredExternally && <p className="text-sm text-muted-foreground">Existing Sendspin configuration supplies the address and name.</p>}
    {state?.error && <Alert variant="destructive"><AlertDescription>{state.error}</AlertDescription></Alert>}
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription>{hosting.error && <AlertAction><Button variant="outline" size="sm" disabled={!connected || hosting.isFetching} onClick={() => void hosting.refetch()}>Try again</Button></AlertAction>}</Alert>}
  </SettingsSection>;
}
