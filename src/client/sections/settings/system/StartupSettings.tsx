import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { apiFetch } from "@/api/client";
import type { StartupState } from "../../../../shared/startup";
import type { ApiCredentials } from "@/api/client";

type Props = { credentials: ApiCredentials; connected: boolean };

export function StartupSettings({ credentials, connected }: Props) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const queryKey = ["settings", "startup", credentials.origin, credentials.token];
  const startup = useQuery({
    queryKey,
    enabled: connected,
    queryFn: () => apiFetch(credentials, "/api/settings/startup").then(response => response.json() as Promise<StartupState>),
  });
  const state = startup.data;

  async function save() {
    if (!state || !connected || pending) return;
    setPending(true); setError(null); setNotice(null);
    try {
      await apiFetch(credentials, "/api/settings/startup", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !state.enabled }),
      });
      await queryClient.invalidateQueries({ queryKey: ["settings", "startup"] });
      setNotice("Saved. Applies at the next startup.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save TV startup. Refresh to check the effective setting.");
    } finally { setPending(false); }
  }

  return (
    <div className="space-y-3">
      <h3>Automatic startup</h3>
      <p className="text-muted-foreground">Start Couch when the TV computer turns on, without a login prompt.</p>
      {state && (
        <>
          <p data-startup-mode>Effective startup: {state.enabled ? "Couch starts automatically" : "Login screen; Couch does not start automatically"}.</p>
          <p data-startup-fullscreen>{state.enabled && state.fullscreenAtLaunch ? "Couch starts fullscreen at boot." : state.fullscreenAtLaunch ? "Couch opens fullscreen when its TV session is launched." : "Couch opens in a window."} Current TV window: {state.fullscreenNow === null ? "unavailable" : state.fullscreenNow ? "fullscreen" : "windowed"}.</p>
          <Button variant="outline" className="min-h-11" disabled={!connected || pending} onClick={() => void save()}>{pending ? "Saving startup…" : state.enabled ? "Disable automatic startup" : "Enable automatic startup"}</Button>
        </>
      )}
      {!state && !startup.error && <p className="text-muted-foreground">{connected ? "Reading TV startup…" : "Reconnect to read TV startup."}</p>}
      <Collapsible><CollapsibleTrigger asChild><Button variant="ghost" className="min-h-11 px-0">Startup recovery</Button></CollapsibleTrigger><CollapsibleContent><p className="text-muted-foreground">After disabling, launch Couch again from SSH with your administrator account: run <code>sudo couch-session autostart enable</code>, then <code>sudo systemctl restart lightdm</code>. The second command ends the current graphical session. For app recovery, use <code>sudo couch-session logs</code> and <code>sudo couch-session restart</code> from SSH.</p></CollapsibleContent></Collapsible>
      {notice && <p role="status">{notice}</p>}
      {(startup.error || error) && <Alert variant="destructive"><AlertDescription>{error ?? "Could not read TV startup."}</AlertDescription></Alert>}
      <Button variant="outline" className="min-h-11" disabled={!connected} onClick={() => void queryClient.invalidateQueries({ queryKey: ["settings", "startup"] })}>Refresh startup</Button>
    </div>
  );
}
