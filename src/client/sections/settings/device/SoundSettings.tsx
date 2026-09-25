import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiSend, type ApiCredentials } from "@/api/client";
import { soundQuery, soundView, type SoundView } from "@/api/settings";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DelayControl } from "./DelayControl";
import type { SoundState } from "../../../../shared/sound";

export function SoundSettings({ credentials, connected, hostName }: { credentials: ApiCredentials; connected: boolean; hostName: string }) {
  const queryClient = useQueryClient();
  const sound = useQuery({ ...soundQuery(credentials), enabled: connected });
  const mutation = useMutation({
    mutationFn: ({ path, body }: { path: string; body: unknown }) => apiSend<SoundState>(credentials, `/api/sound/${path}`, body),
    onSuccess: result => queryClient.setQueryData<SoundView>(soundQuery(credentials).queryKey, previous => soundView(previous, result)),
  });
  const state = connected ? sound.data ?? null : null;
  const pending = mutation.isPending;
  const error = mutation.error ? mutation.error instanceof Error ? mutation.error.message : `Could not change sound on ${hostName}.` : null;
  const readError = sound.error instanceof Error ? sound.error.message : sound.error ? `Cannot read ${hostName}'s outputs.` : null;
  const change = (path: string, body: unknown) => connected && !pending ? mutation.mutateAsync({ path, body }).then(() => true, () => false) : Promise.resolve(false);
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
    {(error || readError) && <div className="space-y-2"><p role="alert">{hostName}: {error || readError}</p><Button variant="outline" disabled={!connected || pending} onClick={() => void sound.refetch()}>Refresh outputs</Button></div>}
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
