import { useEffect, useRef, useState } from "react";
import { Check, Speaker } from "lucide-react";
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
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not change the TV sound."); return false; }
    finally { if (!controller.signal.aborted) { setPending(false); setRefresh(value => value + 1); } }
  }
  const active = state?.test && ["starting", "playing"].includes(state.test.status);
  const selected = state?.routing?.selectedOutput;
  const profiles = state?.profiles?.filter(profile => profile.selectable && !profile.active) ?? [];
  const missingSelected = selected && !state?.outputs.some(output => output.id === selected);
  return <section className="space-y-4" aria-label="TV sound">
    <div className="space-y-1">
      <h3 className="font-medium">Sound output</h3>
      <p className="text-sm text-muted-foreground">Choose where the TV plays sound. Volume and mute beside playback control this output.</p>
    </div>
    {(error || readError) && <div className="space-y-2"><p role="alert">{error || readError}</p><Button variant="outline" disabled={!connected || pending} onClick={() => setRefresh(value => value + 1)}>Refresh outputs</Button></div>}
    {!connected && <p>Reconnect to choose a sound output.</p>}
    {connected && !state && !readError && <p role="status">Loading sound outputs…</p>}
    {state?.routing?.error && <p role="status">{state.routing.error}</p>}
    {missingSelected && <div className="rounded-lg border p-4"><p className="font-medium">Previously selected output</p><p className="text-sm text-muted-foreground">Selected · Disconnected. Reconnect it or choose another output.</p></div>}
    <ul className="grid gap-2" aria-label="Sound outputs">
      {state?.outputs.map(output => {
        const chosen = selected === output.id;
        const playing = state.routing?.observedOutput === output.id;
        const unavailable = output.availability === "unavailable";
        return <li key={output.id}>
          <Button variant="outline" className="h-auto min-h-16 w-full justify-start gap-3 whitespace-normal px-4 py-3 text-left" aria-label={`Use ${output.name}`} aria-pressed={chosen} disabled={!connected || pending || !!active || !state.routing || unavailable || !!output.testBlocked} onClick={() => change("output", { output: output.id })}>
            {chosen ? <Check aria-hidden="true" className="shrink-0" /> : <Speaker aria-hidden="true" className="shrink-0" />}
            <span className="min-w-0"><span className="block break-words font-medium">{output.name}</span><span className="block text-sm font-normal text-muted-foreground">{[chosen && "Selected", playing && "Playing here", unavailable ? "Unavailable" : output.availability === "unknown" ? "Connection status unknown" : "Available", output.muted ? "Muted" : output.volume !== null && `Volume ${output.volume}%`].filter(Boolean).join(" · ")}</span>{output.testBlocked && <span className="block text-sm font-normal">{output.testBlocked}</span>}</span>
          </Button>
        </li>;
      })}
      {profiles.map(profile => <li key={`${profile.card}/${profile.id}`}>
        <Button variant="outline" className="h-auto min-h-16 w-full justify-start gap-3 whitespace-normal px-4 py-3 text-left" aria-label={`Use ${profile.name}`} aria-pressed={false} disabled={!connected || pending || !!active || !state?.routing || !profile.available} onClick={() => change("profile", { profile: { card: profile.card, profile: profile.id } })}>
          <Speaker aria-hidden="true" className="shrink-0" /><span className="min-w-0"><span className="block break-words font-medium">{profile.name}</span><span className="block text-sm font-normal text-muted-foreground">{profile.available ? "Available · Pauses playback when selected" : "Unavailable"}</span></span>
        </Button>
      </li>)}
    </ul>
    {state && !state.outputs.length && !profiles.length && <p>No sound outputs found.</p>}
    <p className="text-sm text-muted-foreground">Pair a speaker in Bluetooth to add it here. If an output disconnects, choose an available output and resume playback.</p>
    <details className="rounded-lg border p-4">
      <summary tabIndex={0} className="min-h-11 cursor-pointer content-center rounded-md font-medium focus-visible:outline-2 focus-visible:outline-ring">Sound test and audio delay</summary>
      <div className="space-y-4 pt-3">
        {state?.audioDelay !== undefined && <DelayControl id="sound-audio-delay" label="TV audio delay" value={state.audioDelay} disabled={!connected || pending} onApply={delay => change("delay", { delay })} />}
        <p className="text-sm text-muted-foreground">Play a three-second left/right tone on an output. This does not select it for playback or change its volume.</p>
        {state && !state.canTest && !active && <p>Stop playback before testing sound.</p>}
        {state?.test && <div role="status" className="space-y-2"><p>{state.test.status === "starting" ? "Starting test; routing has not been confirmed." : state.test.status === "playing" ? "Playing the test tone. Check that you can hear it." : state.test.message}</p>{active && <Button disabled={!connected || pending} onClick={() => change("stop", { testId: state.test!.id })}>Stop sound test</Button>}</div>}
        <div className="flex flex-wrap gap-2">{state?.outputs.map(output => <Button key={output.id} variant="outline" disabled={!connected || pending || !state.canTest || !!active || !!output.testBlocked || output.availability === "unavailable" || output.muted} onClick={() => change("test", { output: output.id })}>Test {output.name}</Button>)}</div>
      </div>
    </details>
  </section>;
}
