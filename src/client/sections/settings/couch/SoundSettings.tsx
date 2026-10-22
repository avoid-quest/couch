import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiSend, type ApiCredentials } from "@/api/client";
import { soundQuery, soundView, type SoundView } from "@/api/settings";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { TRY_AGAIN } from "@/copy";
import { DelayControl } from "@/components/DelayControl";
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
  const error = mutation.error ? mutation.error.message || "Couldn't change sound." : sound.error ? sound.error.message || `Couldn't read speakers on ${hostName}.` : null;
  const change = (path: string, body: unknown) => connected && !pending ? mutation.mutateAsync({ path, body }).then(() => true, () => false) : Promise.resolve(false);
  const active = state?.test && ["starting", "playing"].includes(state.test.status);
  const selected = state?.routing?.selectedOutput;
  const selectedChoice = state?.choices.find(choice => "output" in choice && choice.output.id === selected);
  const selectedOutput = state?.outputs.find(output => output.id === selected);
  const observedOutput = state?.outputs.find(output => output.id === state.routing?.observedOutput);
  const unavailableSelected = selected && !selectedChoice;
  const playing = observedOutput && `Playing on ${observedOutput.name}${observedOutput.muted ? " · Muted" : observedOutput.volume !== null ? ` · Volume ${observedOutput.volume}%` : ""}`;

  return <>
    <SettingsSection>
      {(state || !error) && <SettingsRow label="Output" description={playing || "Add speakers in Bluetooth below."}>
        {state ? state.choices.length ? (
          <Select value={selectedChoice?.key ?? ""} disabled={!connected || pending || !!active || !state.routing} onValueChange={key => {
            const choice = state.choices.find(choice => choice.key === key);
            if (choice) void ("output" in choice ? change("output", { output: choice.output.id }) : change("profile", { profile: { card: choice.profile.card, profile: choice.profile.id } }));
          }}>
            <SelectTrigger aria-label="Sound output" className="w-full max-w-sm"><SelectValue placeholder={unavailableSelected ? `${selectedOutput?.name ?? "Output"} · Unavailable` : "Choose output"} /></SelectTrigger>
            <SelectContent position="popper">{state.choices.map(choice => <SelectItem key={choice.key} value={choice.key}>
              {"output" in choice ? choice.output.name : `${choice.profile.name} · Pauses playback`}
            </SelectItem>)}</SelectContent>
          </Select>
        ) : <Empty className="py-0"><EmptyHeader><EmptyDescription>No outputs found. Add speakers in Bluetooth below.</EmptyDescription></EmptyHeader></Empty>
          : connected && <span role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Loading…</span>}
      </SettingsRow>}
      {unavailableSelected && <Alert><AlertDescription>Output unavailable. Reconnect it or pick another.</AlertDescription></Alert>}
      {state?.routing?.error && <Alert><AlertDescription>{state.routing.error}</AlertDescription></Alert>}
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription><AlertAction><Button variant="outline" size="sm" disabled={!connected || pending} onClick={() => { mutation.reset(); void sound.refetch(); }}>{TRY_AGAIN}</Button></AlertAction></Alert>}
    </SettingsSection>
    {state && <SettingsSection title="Test & delay">
      {state.audioDelay !== undefined && <SettingsRow label="Audio delay" htmlFor="sound-audio-delay" description="Positive values play sound later.">
        <DelayControl id="sound-audio-delay" value={state.audioDelay} disabled={!connected || pending} onApply={delay => change("delay", { delay })} />
      </SettingsRow>}
      <SettingsRow label="Test tone" description={!state.canTest && !active ? state.testUnavailableReason || "Stop playback to test sound." : "Plays a 3-second left/right tone."}>
        {state.outputs.map(output => <Button key={output.id} variant="outline" disabled={!connected || pending || !state.canTest || !!active || !!output.testBlocked || output.availability === "unavailable" || output.muted} onClick={() => void change("test", { output: output.id })}>Test {output.name}</Button>)}
      </SettingsRow>
      {state.test && <div role="status" className="flex flex-wrap items-center gap-3 text-sm">
        {active && <Spinner />}
        <span className={active ? "text-muted-foreground" : undefined}>{state.test.status === "starting" ? "Starting…" : state.test.status === "playing" ? "Playing tone…" : state.test.message}</span>
        {active && <Button variant="outline" size="sm" disabled={!connected || pending} onClick={() => void change("stop", { testId: state.test!.id })}>Stop</Button>}
      </div>}
    </SettingsSection>}
  </>;
}
