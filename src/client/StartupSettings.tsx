import { useEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { StartupState } from "../shared/startup";

type Props = { credentials: { origin: string; token: string }; connected: boolean };
export function StartupSettings({ credentials: { origin, token }, connected }: Props) {
  const mutation = useRef<AbortController | null>(null);
  const [state, setState] = useState<StartupState | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    mutation.current?.abort();
    setState(null); setError(null); setNotice(null); setPending(false);
    if (!connected) return;
    const controller = new AbortController();
    void fetch(`${origin}/api/settings/startup`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not read TV startup.");
      if (!controller.signal.aborted) setState(result);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not read TV startup."); });
    return () => { controller.abort(); mutation.current?.abort(); };
  }, [origin, token, connected, refresh]);

  const save = async () => {
    if (!state || !connected || pending) return;
    const controller = new AbortController();
    mutation.current = controller;
    setPending(true); setError(null); setNotice(null);
    try {
      const response = await fetch(`${origin}/api/settings/startup`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !state.enabled }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save TV startup. Refresh to check the effective setting.");
      if (controller.signal.aborted) return;
      setState(result); setNotice("Saved and read back from LightDM. Applies at the next boot or graphical session. Current playback continues.");
    } catch (reason) { if (controller.signal.aborted) return; setState(null); setError(reason instanceof Error ? reason.message : "Could not save TV startup. Refresh to check the effective setting."); }
    finally { if (!controller.signal.aborted) setPending(false); if (mutation.current === controller) mutation.current = null; }
  };
  return <div className="space-y-3">
    <p className="font-medium">Start Couch automatically without a login password</p>
    <p className="text-muted-foreground">Applies to the dedicated TV session at the next boot or graphical session. Your SSH administrator password stays the same.</p>
    {state && <>
      <p data-startup-mode>Effective startup: {state.enabled ? "Couch starts automatically" : "Login screen; Couch does not start automatically"}.</p>
      <p data-startup-fullscreen>{state.enabled && state.fullscreenAtLaunch ? "Couch starts fullscreen at boot." : state.fullscreenAtLaunch ? "Couch opens fullscreen when its TV session is launched." : "Couch opens in a window."} Current TV window: {state.fullscreenNow === null ? "unavailable" : state.fullscreenNow ? "fullscreen" : "windowed"}.</p>
      <Button variant="outline" className="min-h-11" disabled={!connected || pending} onClick={() => void save()}>{pending ? "Saving startup…" : state.enabled ? "Disable automatic startup" : "Enable automatic startup"}</Button>
    </>}
    {!state && !error && <p className="text-muted-foreground">{connected ? "Reading TV startup…" : "Reconnect to read TV startup."}</p>}
    <p className="text-muted-foreground">After disabling, launch Couch again from SSH with your administrator account: run <code>sudo couch-session autostart enable</code>, then <code>sudo systemctl restart lightdm</code>. The second command ends the current graphical session. For app recovery, use <code>sudo couch-session logs</code> and <code>sudo couch-session restart</code> from SSH.</p>
    {notice && <p role="status">{notice}</p>}
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    <Button variant="outline" className="min-h-11" disabled={!connected || pending} onClick={() => setRefresh(value => value + 1)}>Refresh startup</Button>
  </div>;
}
