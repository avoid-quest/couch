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

  return <SettingsSection title="Sendspin hosting" description="Make this Core available for synchronized audio groups.">
    <SettingsRow label="Host Sendspin" description={state?.restartRequired ? "Saved. Restart Core to start Sendspin hosting." : state?.active ? "Hosting is active." : "Hosting is off."}>
      <Switch aria-label="Host Sendspin" checked={state?.enabled ?? false} disabled={!connected || !state || save.isPending} onCheckedChange={enabled => save.mutate(enabled)} />
    </SettingsRow>
    {state?.configuredExternally && <p className="text-sm text-muted-foreground">Existing Sendspin configuration supplies the address and name.</p>}
    {state?.error && <Alert variant="destructive"><AlertDescription>{state.error}</AlertDescription></Alert>}
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription>{hosting.error && <AlertAction><Button variant="outline" size="sm" disabled={!connected || hosting.isFetching} onClick={() => void hosting.refetch()}>Try again</Button></AlertAction>}</Alert>}
  </SettingsSection>;
}
