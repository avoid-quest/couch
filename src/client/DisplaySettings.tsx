import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { DisplayState } from "../shared/display";

export function DisplaySettings({ credentials, connected }: { credentials: { origin: string; token: string }; connected: boolean }) {
  const [state, setState] = useState<DisplayState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [refresh, setRefresh] = useState(0);
  const { origin, token } = credentials;
  useEffect(() => { setState(null); setError(null); }, [origin, token]);
  useEffect(() => {
    if (!connected) { setState(null); return; }
    const controller = new AbortController();
    let running = false;
    const read = async () => {
      setNow(Date.now());
      if (running || pending) return;
      running = true;
      try {
        const response = await fetch(`${origin}/api/display`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(6_000)]) });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error);
        if (!controller.signal.aborted) { setState(body); setError(null); }
      } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Cannot read displays."); }
      finally { running = false; }
    };
    void read();
    const timer = setInterval(read, 1_000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [origin, token, connected, pending, refresh]);
  async function change(op: string, body: unknown) {
    setPending(true); setError(null);
    try {
      const response = await fetch(`${origin}/api/display/${op}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(6_000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setState(result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Display change failed."); }
    finally { setPending(false); setRefresh(value => value + 1); }
  }
  return <section className="space-y-4">
    <h3>TV screen</h3>
    <p>Move Couch to a connected physical screen. Confirm the picture within 20 seconds or the TV restores the previous usable screen.</p>
    {error && <p role="alert">{error}</p>}
    {!connected && <p>Reconnect to read the TV's displays.</p>}
    {state?.notice && <p role="status">{state.notice}</p>}
    {state?.preview && <div role="status" className="space-y-2"><p>Confirm the picture: {Math.max(0, Math.ceil((state.preview.expiresAt - now) / 1_000))} seconds remaining.</p><Button disabled={pending || !connected} onClick={() => change("confirm", { token: state.preview!.token })}>Keep this screen</Button> <Button disabled={pending || !connected} onClick={() => change("cancel", { token: state.preview!.token })}>Restore previous screen</Button></div>}
    {state?.outputs.map(output => <div key={output.id} className="space-y-2"><p>{output.name} {state.current === output.id ? "· Couch is here" : ""} {state.saved === output.id ? "· Saved" : ""}</p><p>{!output.connected ? "Disconnected" : !output.width ? "Connected, disabled by the desktop session" : `${output.width} × ${output.height} · ${output.refresh === null ? "Refresh rate unavailable" : `${output.refresh} Hz`}`}</p><Button disabled={!connected || pending || !!state.preview || !output.connected || !output.width} onClick={() => change("preview", { output: output.id })}>Preview on {output.name}</Button></div>)}
    <p>The laptop panel stays available for recovery. If the saved screen disappears, Couch uses the panel or the first enabled output and retains the saved choice. This does not change resolution, refresh rate or desktop primary output.</p>
  </section>;
}
