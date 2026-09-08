import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DelayControl } from "./PlaybackSettings";
import type { SoundOutput, SoundProfile, SoundState } from "../shared/sound";

type SoundChoice = { key: string; output: SoundOutput } | { key: string; profile: SoundProfile };
type SoundView = SoundState & { choices: SoundChoice[] };
function updateSound(previous: SoundView | null, next: SoundState): SoundView {
  const outputs = next.outputs.filter(output => output.availability !== "unavailable" && !output.testBlocked);
  const current = new Map<string, SoundChoice>([
    ...outputs.map(output => [`output:${output.id}`, { key: `output:${output.id}`, output }] as const),
    ...(next.profiles ?? []).filter(profile => profile.selectable && profile.available && !profile.active && !(profile.bluetoothAddress && outputs.some(output => output.card === profile.card))).map(profile => {
      const key = `profile:${profile.card}/${profile.id}`;
      return [key, { key, profile }] as const;
    }),
  ]);
  // Keep existing targets in place; inventory polls may return a different order.
  const choices = (previous?.choices ?? []).flatMap(choice => {
    const updated = current.get(choice.key);
    current.delete(choice.key);
    return updated ? [updated] : [];
  }).concat([...current.values()]);
  return { ...next, choices };
}

export function SoundSettings({ credentials, connected }: { credentials: { origin: string; token: string }; connected: boolean }) {
  const [state, setState] = useState<SoundView | null>(null);
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
        if (!controller.signal.aborted) { setState(previous => updateSound(previous, result)); setReadError(null); }
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
      setState(previous => updateSound(previous, result)); return true;
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not change the TV sound."); return false; }
    finally { if (!controller.signal.aborted) { setPending(false); setRefresh(value => value + 1); } }
  }
  const active = state?.test && ["starting", "playing"].includes(state.test.status);
  const selected = state?.routing?.selectedOutput;
  const selectedChoice = state?.choices.find(choice => "output" in choice && choice.output.id === selected);
  const selectedOutput = state?.outputs.find(output => output.id === selected);
  const observedOutput = state?.outputs.find(output => output.id === state.routing?.observedOutput);
  const unavailableSelected = selected && !selectedChoice;
  return <section className="space-y-4" aria-label="TV sound">
    <div className="space-y-1">
      <h3 className="font-medium">Sound output</h3>
      <p className="text-sm text-muted-foreground">Choose where the TV plays sound. Volume and mute beside playback control this output.</p>
    </div>
    {(error || readError) && <div className="space-y-2"><p role="alert">{error || readError}</p><Button variant="outline" disabled={!connected || pending} onClick={() => setRefresh(value => value + 1)}>Refresh outputs</Button></div>}
    {!connected && <p>Reconnect to choose a sound output.</p>}
    {connected && !state && !readError && <p role="status">Loading sound outputs…</p>}
    {state?.routing?.error && <p role="status">{state.routing.error}</p>}
    <Select value={selectedChoice?.key ?? ""} disabled={!connected || pending || !!active || !state?.routing || !state.choices.length} onValueChange={key => {
      const choice = state?.choices.find(choice => choice.key === key);
      if (choice) void ("output" in choice ? change("output", { output: choice.output.id }) : change("profile", { profile: { card: choice.profile.card, profile: choice.profile.id } }));
    }}>
      <SelectTrigger aria-label="Sound output" className="min-h-11 w-full"><SelectValue placeholder={unavailableSelected ? `${selectedOutput?.name ?? "Previously selected output"} · Unavailable` : "Choose a sound output"} /></SelectTrigger>
      <SelectContent position="popper">{state?.choices.map(choice => <SelectItem key={choice.key} value={choice.key} className="min-h-11">
        {"output" in choice ? choice.output.name : `${choice.profile.name} · Pauses playback`}
      </SelectItem>)}</SelectContent>
    </Select>
    {unavailableSelected && <p className="text-sm text-muted-foreground">Selected output unavailable. Reconnect it or choose another output.</p>}
    {observedOutput && <p className="text-sm text-muted-foreground">Playing on {observedOutput.name}{observedOutput.muted ? " · Muted" : observedOutput.volume !== null ? ` · Volume ${observedOutput.volume}%` : ""}</p>}
    {state && !state.choices.length && <p>No available sound outputs found.</p>}
    <p className="text-sm text-muted-foreground">Pair a speaker in Bluetooth to add it here.</p>
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
