import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { DelayControl } from "./PlaybackSettings";
import type { SoundState } from "../shared/sound";

export function SoundSettings({ credentials, connected }: { credentials: { origin: string; token: string }; connected: boolean }) {
  const [state, setState] = useState<SoundState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const mutation = useRef<AbortController | null>(null);
  const { origin, token } = credentials;
  useEffect(() => {
    setState(null); setError(null); setReadError(null); setPending(false);
    return () => mutation.current?.abort();
  }, [origin, token, connected]);
  useEffect(() => {
    if (!connected || pending) return;
    const controller = new AbortController();
    let reading = false;
    const read = async () => {
      if (reading) return;
      reading = true;
      try {
        const response = await fetch(`${origin}/api/sound`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5_000)]) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        if (!controller.signal.aborted) { setState(result); setReadError(null); }
      } catch (reason) { if (!controller.signal.aborted) setReadError(reason instanceof Error ? reason.message : "Cannot read the TV outputs."); }
      finally { reading = false; }
    };
    void read();
    const timer = setInterval(read, 750);
    return () => { controller.abort(); clearInterval(timer); };
  }, [origin, token, connected, pending, refresh]);
  async function change(path: string, body: unknown) {
    const controller = new AbortController(); mutation.current = controller;
    setPending(true); setError(null);
    try {
      const response = await fetch(`${origin}/api/sound/${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5_000)]) });
      const result = await response.json();
      if (controller.signal.aborted) return false;
      if (!response.ok) throw new Error(result.error);
      setState(result); return true;
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Sound test failed."); return false; }
    finally { if (!controller.signal.aborted) { setPending(false); setRefresh(value => value + 1); } }
  }
  const active = state?.test && ["starting", "playing"].includes(state.test.status);
  return <section className="space-y-4">
    <h3>TV sound</h3>
    <p>A three-second left/right tone affects everyone watching this TV. Stop media first. Testing an output does not select it for Couch playback or change system volume.</p>
    {state?.routing && <div role="status">
      <p>Selected output: {state.outputs.find(output => output.id === state.routing!.selectedOutput)?.name || state.routing.selectedOutput || "Checking…"}</p>
      <p>{state.routing.error || (state.routing.observedOutput ? "The audio server confirms Couch playback on the selected output." : "Saved for playback. No active audio stream to confirm.")}</p>
      <p>Output selection, TV volume, mute and delay affect everyone watching this TV. Shared volume and mute are beside playback controls.</p>
    </div>}
    {state?.audioDelay !== undefined && <DelayControl id="sound-audio-delay" label="TV audio delay · everyone watching" value={state.audioDelay} disabled={!connected || pending} onApply={delay => change("delay", { delay })} />}
    {(error || readError) && <p role="alert">{error || readError}</p>}
    {!connected && <p>Reconnect to inspect the TV audio session.</p>}
    {state && !state.canTest && !active && <p>Stop playback before testing sound.</p>}
    {state?.test && <div role="status" className="space-y-2"><p>{state.test.status === "starting" ? "Starting test; routing has not been confirmed." : state.test.status === "playing" ? "The audio server confirms the test stream is on the requested output. Check that you can hear it." : state.test.message}</p>{active && <Button disabled={!connected || pending} onClick={() => change("stop", { testId: state.test!.id })}>Stop sound test</Button>}</div>}
    {!!state?.profiles?.length && <div className="space-y-2"><h4>Other outputs on this sound card</h4><p>Switching between HDMI and the built-in output pauses media. Resume when the output is ready.</p>{state.profiles.filter(profile => profile.selectable && !profile.active).map(profile => <Button key={`${profile.card}/${profile.id}`} disabled={!connected || pending || !!active || !profile.available} onClick={() => change("profile", { profile: { card: profile.card, profile: profile.id } })}>{profile.name}{profile.available ? "" : " · Unavailable"}</Button>)}</div>}
    {state?.outputs.length === 0 && <p>The audio server reports no outputs.</p>}
    {state?.outputs.map(output => <div key={output.id} className="space-y-2"><p>{output.name}{state.defaultOutput === output.id ? " · System default" : ""}</p><p>{output.availability === "unavailable" ? "Unavailable" : output.availability === "available" ? "Available" : "Connection status not reported"} · {output.muted ? "Muted" : "Not muted"} · System volume {output.volume === null ? "unknown" : `${output.volume}%`}</p>{output.testBlocked && <p>{output.testBlocked}</p>}{state.routing && <Button disabled={!connected || pending || !!active || output.availability === "unavailable"} onClick={() => change("output", { output: output.id })}>Use {output.name}</Button>}<Button disabled={!connected || pending || !state.canTest || !!output.testBlocked || output.availability === "unavailable" || output.muted} onClick={() => change("test", { output: output.id })}>Test {output.name}</Button></div>)}
    <p>The test uses a fixed quiet level and respects output mute and volume. A confirmed route does not prove audible sound. Reconnecting an output does not resume playback.</p>
  </section>;
}
