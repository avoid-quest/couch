import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { AudioLines, Bluetooth, MonitorSmartphone, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SoundState } from "../../../shared/sound";
import { ApiError, apiSend } from "@/api/client";
import { bluetoothQuery, soundQuery, soundView, type SoundView } from "@/api/settings";
import type { Credentials } from "@/session/session";
import type { Action, SessionState } from "../../../shared/protocol";
import { knownConnection } from "@/session/connection";

function destinationOrigin(address: string): string | null {
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(address.trim()) ? address.trim() : `http://${address.trim()}`);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash ? url.origin : null;
  } catch { return null; }
}

const noCredentials = { origin: "", token: "" };

export function SoundControls({ credentials, connected, open, installationName, compact = false, state, run, onClose }: {
  credentials: Credentials | null;
  connected: boolean;
  open: boolean;
  installationName?: string;
  compact?: boolean;
  state?: SessionState | null;
  run?: (action: Action) => Promise<boolean>;
  onClose?: () => void;
}) {
  const queryClient = useQueryClient();
  const enabled = open && !!credentials && connected;
  const soundRead = useQuery({ ...soundQuery(credentials ?? noCredentials), enabled });
  const bluetoothRead = useQuery({ ...bluetoothQuery(credentials ?? noCredentials), enabled });
  const sound = enabled ? soundRead.data ?? null : null;
  const bluetooth = enabled ? bluetoothRead.data ?? null : null;
  const soundFailure = !soundRead.error ? "" : soundRead.error instanceof ApiError && soundRead.error.status === 403 ? "An administrator is required to choose a sound output." : "Sound needs a connected player.";
  const bluetoothFailed = bluetoothRead.isError;
  const loading = soundRead.isLoading;
  const output = useMutation({
    mutationFn: (value: string) => apiSend<SoundState>(credentials!, "/api/sound/output", { output: value }, "POST", 5_000),
    onSuccess: result => queryClient.setQueryData<SoundView>(soundQuery(credentials!).queryKey, previous => soundView(previous, result)),
  });
  const pending = output.isPending;
  const outputError = output.error ? output.error.message || "Could not change the sound output." : "";

  const outputs = sound?.outputs.filter(output => output.availability !== "unavailable" && !output.testBlocked) ?? [];
  const selected = sound?.routing?.selectedOutput ?? sound?.defaultOutput ?? null;
  const observed = sound?.outputs.find(output => output.id === sound.routing?.observedOutput);
  const connectedDevices = bluetooth?.devices.filter(device => device.connected) ?? [];
  const adapterReady = bluetooth?.adapter === "available";
  const selectOutput = (value: string) => { if (credentials) output.mutate(value); };

  const unavailable = !connected ? "Connect to choose an output." : soundFailure || (loading ? "Checking outputs…" : "No outputs reported.");
  if (compact) {
    const volume = state?.player.volume ?? sound?.routing?.volume ?? null;
    const volumeReady = connected && !!run && volume !== null && state?.player.status !== "unavailable" && state?.systemAudio?.volumeWritable !== false && sound?.routing?.volumeWritable !== false;
    const changeVolume = (step: number) => { if (volumeReady && volume !== null) void run({ type: "volume", volume: Math.max(0, Math.min(100, Math.round(volume + step))) }); };
    return <div className="grid gap-3 border-t border-border pt-3">
      <h3 className="text-sm font-medium">Sound on {installationName || "this Couch"}</h3>
      {outputs.length ? <RadioGroup aria-label="Sound output" value={selected ?? ""} disabled={pending || !connected} onValueChange={selectOutput} className="gap-1">{outputs.map((output, index) => <Field orientation="horizontal" className="min-h-11 items-center" key={output.id}><RadioGroupItem id={`quick-output-${index}`} value={output.id} /><FieldLabel htmlFor={`quick-output-${index}`} className="min-w-0 flex-1 cursor-pointer truncate font-normal">{output.name || output.id}</FieldLabel></Field>)}</RadioGroup> : <p className="text-sm text-muted-foreground">{unavailable}</p>}
      {observed && observed.id !== selected && <p className="text-sm text-muted-foreground">Now playing on {observed.name || observed.id}.</p>}
      <div className="flex items-center justify-between gap-2" role="group" aria-label="Volume"><span>Volume</span><ButtonGroup aria-label="Volume adjustment"><Button variant="ghost" size="icon" aria-label="Decrease volume" disabled={!volumeReady || volume === 0} onClick={() => changeVolume(-5)}>−</Button><span className="min-w-8 self-center text-center tabular-nums" aria-live="polite">{volume === null ? "—" : Math.round(volume)}</span><Button variant="ghost" size="icon" aria-label="Increase volume" disabled={!volumeReady || volume === 100} onClick={() => changeVolume(5)}>+</Button></ButtonGroup></div>
      {outputError && <p role="alert" className="text-sm text-destructive">{outputError}</p>}
      {credentials && <Button variant="ghost" className="justify-start px-0 text-muted-foreground" asChild><Link to="/settings/sound" onClick={onClose}>Sound settings</Link></Button>}
    </div>;
  }
  return <>
    <div className="grid gap-2">
      <p className="text-sm font-medium">Sound output</p>
      {outputs.length
        ? <Select value={selected ?? undefined} onValueChange={selectOutput} disabled={pending || !connected}>
          <SelectTrigger className="w-full" aria-label="Sound output"><SelectValue placeholder="Choose output" /></SelectTrigger>
          <SelectContent>{outputs.map(output => <SelectItem key={output.id} value={output.id}>{output.name || output.id}</SelectItem>)}</SelectContent>
        </Select>
        : <p className="text-muted-foreground">{unavailable}</p>}
      {observed && observed.id !== selected && <p className="text-xs text-muted-foreground">Now playing on {observed.name || observed.id}.</p>}
    </div>
    <div className="grid gap-2">
      <p className="text-sm font-medium">Bluetooth</p>
      {!adapterReady && <p className="text-muted-foreground">{!connected ? "Connect to see Bluetooth devices." : bluetoothFailed ? "Bluetooth needs a connected player." : bluetooth ? bluetooth.adapter === "off" ? "Bluetooth is off on the playback computer." : "Bluetooth is unavailable." : "Checking Bluetooth…"}</p>}
      {adapterReady && !!connectedDevices.length && <ul className="grid gap-1">{connectedDevices.map(device => <li key={device.address} className="flex items-center gap-2 text-muted-foreground"><Bluetooth className="size-4" aria-hidden="true" />{device.name}</li>)}</ul>}
      {adapterReady && !connectedDevices.length && <p className="text-muted-foreground">No devices connected. Pair speakers in settings.</p>}
    </div>
    {outputError && <p role="alert" className="text-sm text-destructive">{outputError}</p>}
    {credentials && <Button variant="outline" className="w-full" asChild><Link to="/settings/sound" onClick={onClose}><Settings2 aria-hidden="true" />Sound settings</Link></Button>}
  </>;
}

// Quick check of where playback runs and where its sound comes out.
// Wi-Fi signal lives in the OS, not here; the LAN address and the audio route are what Couch knows.
export function PlaybackStatus({ credentials, connected, status, installationName, localHost = false, state, run }: {
  credentials: Credentials | null;
  connected: boolean;
  status: string;
  installationName?: string;
  localHost?: boolean;
  state?: SessionState | null;
  run?: (action: Action) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState("");
  const [target, setTarget] = useState<string | null>(null);
  const [addressError, setAddressError] = useState("");
  const name = installationName || "Couch";
  const origin = credentials?.origin ?? location.origin;
  const known = knownConnection();
  const other = known?.origin !== origin ? known : null;
  const choose = (value: string) => {
    const next = destinationOrigin(value);
    if (!next) { setAddressError("Enter a Couch address without a path or pairing details."); return; }
    setAddressError("");
    if (next !== origin) setTarget(next);
  };
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button variant="ghost" className="max-w-full gap-2 text-[.95rem]" aria-label={`Playback on ${name}: ${status}`}>
        <span className={`size-2 shrink-0 rounded-full ${connected ? "bg-current" : "border border-current"}`} aria-hidden="true" />
        <span className="max-w-48 truncate">{localHost ? "Playing here" : `Playing on ${name}`}</span>
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] gap-4 rounded-sm p-4 text-sm shadow-none">
      <PopoverHeader className="flex-row items-start justify-between gap-3">
        <div><PopoverTitle>Play on</PopoverTitle><PopoverDescription role="status">{name} · {status}</PopoverDescription></div>
        <MonitorSmartphone className="size-5 text-muted-foreground" aria-hidden="true" />
      </PopoverHeader>
      <div className="grid gap-2">
        <p className="flex items-center gap-2"><AudioLines className="size-4" aria-hidden="true" />{name} <span className="ml-auto text-muted-foreground">{new URL(origin).host}</span></p>
        {target ? <div className="grid gap-2 border-t border-border pt-3">
          <p>Switch this browser to {new URL(target).host}?</p>
          <p className="text-muted-foreground">Playback on {name} continues. Pair with the other Couch there if needed.</p>
          <div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => location.assign(target)}>Switch Couch</Button><Button size="sm" variant="outline" onClick={() => setTarget(null)}>Keep {name}</Button></div>
        </div> : <>
          {other && <Button variant="ghost" className="justify-start px-0" onClick={() => choose(other.origin)}>Play on {other.details.name} <span className="ml-auto text-muted-foreground">{new URL(other.origin).host}</span></Button>}
          <form onSubmit={event => { event.preventDefault(); choose(address); }}><InputGroup><InputGroupInput aria-label="Another Couch address" value={address} onChange={event => { setAddress(event.target.value); setAddressError(""); }} placeholder="Another Couch address" autoComplete="url" spellCheck={false} /><InputGroupAddon align="inline-end"><InputGroupButton type="submit" disabled={!address.trim()}>Connect</InputGroupButton></InputGroupAddon></InputGroup></form>
          {addressError && <p role="alert" className="text-destructive">{addressError}</p>}
        </>}
      </div>
      <SoundControls credentials={credentials} connected={connected} open={open} installationName={name} compact state={state} run={run} onClose={() => setOpen(false)} />
    </PopoverContent>
  </Popover>;
}
