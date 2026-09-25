import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, type ApiCredentials } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DelayControl } from "./DelayControl";
import type { SoundOutput, SoundProfile, SoundState } from "../../../../shared/sound";

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

export function SoundSettings({ credentials, connected, hostName }: { credentials: ApiCredentials; connected: boolean; hostName: string }) {
  const queryClient = useQueryClient();
  const queryKey = ["sound", credentials.origin, credentials.token];
  const sound = useQuery({
    queryKey,
    enabled: connected,
    queryFn: () => apiFetch(credentials, "/api/sound").then(response => response.json() as Promise<SoundState>),
    refetchInterval: 750,
    refetchIntervalInBackground: false,
    retry: false,
  });
  const [state, setState] = useState<SoundView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const readError = sound.error instanceof Error ? sound.error.message : sound.error ? `Cannot read ${hostName}'s outputs.` : null;

  useEffect(() => {
    setState(null); setError(null); setPending(false);
  }, [credentials.origin, credentials.token, connected]);

  useEffect(() => {
    if (!connected || pending || !sound.data) return;
    setState(previous => updateSound(previous, sound.data!));
  }, [connected, pending, sound.data, sound.dataUpdatedAt]);

  async function change(path: string, body: unknown) {
    if (!connected || pending) return false;
    setPending(true); setError(null);
    try {
      const result = await apiFetch(credentials, `/api/sound/${path}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      }).then(response => response.json() as Promise<SoundState>);
      setState(previous => updateSound(previous, result));
      await queryClient.invalidateQueries({ queryKey });
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `Could not change sound on ${hostName}.`);
      return false;
    } finally { setPending(false); }
  }
  const active = state?.test && ["starting", "playing"].includes(state.test.status);
  const selected = state?.routing?.selectedOutput;
  const selectedChoice = state?.choices.find(choice => "output" in choice && choice.output.id === selected);
  const selectedOutput = state?.outputs.find(output => output.id === selected);
  const observedOutput = state?.outputs.find(output => output.id === state.routing?.observedOutput);
  const unavailableSelected = selected && !selectedChoice;
  return <section className="space-y-4" aria-label={`Sound on ${hostName}`}>
    <div className="settings-choice-row grid grid-cols-[16rem_minmax(0,1fr)] items-start gap-4 border-t border-border py-3 max-[900px]:grid-cols-1">
      <div className="space-y-1"><h3 className="font-medium">Sound output</h3><p className="text-sm text-muted-foreground">Choose where {hostName} plays sound.</p></div>
      <Select value={selectedChoice?.key ?? ""} disabled={!connected || pending || !!active || !state?.routing || !state.choices.length} onValueChange={key => {
        const choice = state?.choices.find(choice => choice.key === key);
        if (choice) void ("output" in choice ? change("output", { output: choice.output.id }) : change("profile", { profile: { card: choice.profile.card, profile: choice.profile.id } }));
      }}>
        <SelectTrigger aria-label="Sound output" className="min-h-11 w-full"><SelectValue placeholder={unavailableSelected ? `${selectedOutput?.name ?? "Previously selected output"} · Unavailable` : "Choose a sound output"} /></SelectTrigger>
        <SelectContent position="popper">{state?.choices.map(choice => <SelectItem key={choice.key} value={choice.key} className="min-h-11">
          {"output" in choice ? choice.output.name : `${choice.profile.name} · Pauses playback`}
        </SelectItem>)}</SelectContent>
      </Select>
    </div>
    {(error || readError) && <div className="space-y-2"><p role="alert">{hostName}: {error || readError}</p><Button variant="outline" disabled={!connected || pending} onClick={() => void queryClient.invalidateQueries({ queryKey })}>Refresh outputs</Button></div>}
    {!connected && <p>Reconnect to choose a sound output.</p>}
    {connected && !state && !readError && <p role="status">Loading sound outputs…</p>}
    {state?.routing?.error && <p role="status">{hostName}: {state.routing.error}</p>}
    {unavailableSelected && <p className="text-sm text-muted-foreground">Selected output unavailable. Reconnect it or choose another output.</p>}
    {observedOutput && <p className="text-sm text-muted-foreground">Playing on {observedOutput.name}{observedOutput.muted ? " · Muted" : observedOutput.volume !== null ? ` · Volume ${observedOutput.volume}%` : ""}</p>}
    {selectedOutput?.volumeWritable === false && <p className="text-sm text-muted-foreground">{selectedOutput.name} has no writable output volume. Check in System Settings on {hostName}.</p>}
    {selectedOutput?.muteWritable === false && <p className="text-sm text-muted-foreground">{selectedOutput.name} has no writable output mute. Check in System Settings on {hostName}.</p>}
    {selectedOutput?.configurationAvailable === false && <p className="text-sm text-muted-foreground">{selectedOutput.name} exposes no selectable output-only data source to Couch. Check in System Settings on {hostName} for other hardware settings.</p>}
    {state && !state.choices.length && <p>No available sound outputs found.</p>}
    <p className="text-sm text-muted-foreground">Pair a speaker in Bluetooth to add it here.</p>
    <Collapsible className="border-t border-border pt-3">
      <CollapsibleTrigger asChild><Button variant="ghost" className="min-h-11 w-full justify-start px-0 font-medium">Sound test and audio delay</Button></CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 pt-3">
        {state?.audioDelay !== undefined && <DelayControl id="sound-audio-delay" label="Audio delay" value={state.audioDelay} disabled={!connected || pending} onApply={delay => change("delay", { delay })} />}
        <p className="text-sm text-muted-foreground">Play a three-second left/right tone on an output. This does not select it for playback or change its volume.</p>
        {state && !state.canTest && !active && <p>{state.testUnavailableReason || "Stop playback before testing sound."}</p>}
        {state?.test && <div role="status" className="space-y-2"><p>{state.test.status === "starting" ? "Starting test; routing has not been confirmed." : state.test.status === "playing" ? "Playing the test tone. Check that you can hear it." : state.test.message}</p>{active && <Button disabled={!connected || pending} onClick={() => change("stop", { testId: state.test!.id })}>Stop sound test</Button>}</div>}
        <div className="flex flex-wrap gap-2">{state?.outputs.map(output => <Button key={output.id} variant="outline" disabled={!connected || pending || !state.canTest || !!active || !!output.testBlocked || output.availability === "unavailable" || output.muted} onClick={() => change("test", { output: output.id })}>Test {output.name}</Button>)}</div>
      </CollapsibleContent>
    </Collapsible>
  </section>;
}
