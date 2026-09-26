import type { ClientSessionState } from "@/session/session";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Field, FieldLabel } from "@/components/ui/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SoundState } from "../../../shared/sound";
import { ApiError, apiSend } from "@/api/client";
import { soundQuery, soundView, type SoundView } from "@/api/settings";
import type { Credentials } from "@/session/session";
import type { Action } from "../../../shared/protocol";
import { knownConnection } from "@/session/connection";
import { ADMIN_ONLY, deviceName } from "@/copy";
import { StatusDot } from "./StatusLine";

function destinationOrigin(address: string): string | null {
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(address.trim()) ? address.trim() : `http://${address.trim()}`);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash ? url.origin : null;
  } catch { return null; }
}

const noCredentials = { origin: "", token: "" };

/** Output and volume of the Couch that plays, inside the Play on popover. */
export function SoundControls({ credentials, connected, open, state, run, onClose }: {
  credentials: Credentials | null;
  connected: boolean;
  open: boolean;
  state?: ClientSessionState | null;
  run?: (action: Action) => Promise<boolean>;
  onClose?: () => void;
}) {
  const queryClient = useQueryClient();
  const enabled = open && !!credentials && connected;
  const soundRead = useQuery({ ...soundQuery(credentials ?? noCredentials), enabled });
  const sound = enabled ? soundRead.data ?? null : null;
  const output = useMutation({
    mutationFn: (value: string) => apiSend<SoundState>(credentials!, "/api/sound/output", { output: value }, "POST", 5_000),
    onSuccess: result => queryClient.setQueryData<SoundView>(soundQuery(credentials!).queryKey, previous => soundView(previous, result)),
  });
  const outputs = sound?.outputs.filter(output => output.availability !== "unavailable" && !output.testBlocked) ?? [];
  const selected = sound?.routing?.selectedOutput ?? sound?.defaultOutput ?? null;
  const observed = sound?.outputs.find(output => output.id === sound.routing?.observedOutput);
  const unavailable = soundRead.error ? soundRead.error instanceof ApiError && soundRead.error.status === 403 ? ADMIN_ONLY : "Couldn't load outputs."
    : soundRead.isLoading ? "Checking outputs…" : "No outputs.";
  const volume = state?.player.volume ?? sound?.routing?.volume ?? null;
  const volumeReady = connected && !!run && volume !== null && state?.player.status !== "unavailable" && state?.systemAudio?.volumeWritable !== false && sound?.routing?.volumeWritable !== false;
  const changeVolume = (step: number) => { if (volumeReady && volume !== null) void run({ type: "volume", volume: Math.max(0, Math.min(100, Math.round(volume + step))) }); };
  // Offline, the shell's status line already says so; there is nothing to adjust.
  if (!connected) return null;
  return <section aria-labelledby="sound-controls-title" className="grid gap-2 border-t pt-3">
    <h3 id="sound-controls-title" className="text-sm font-medium">Sound</h3>
    {outputs.length ? <RadioGroup aria-label="Sound output" value={selected ?? ""} disabled={output.isPending || !connected} onValueChange={value => { if (credentials) output.mutate(value); }} className="gap-0">{outputs.map((item, index) => <Field orientation="horizontal" className="items-center py-1.5" key={item.id}><RadioGroupItem id={`quick-output-${index}`} value={item.id} /><FieldLabel htmlFor={`quick-output-${index}`} className="min-w-0 flex-1 cursor-pointer truncate font-normal">{item.name || item.id}</FieldLabel></Field>)}</RadioGroup> : <p className="text-muted-foreground">{unavailable}</p>}
    {observed && observed.id !== selected && <p className="text-muted-foreground">Playing through {observed.name || observed.id}.</p>}
    <div className="flex items-center justify-between gap-2" role="group" aria-label="Volume"><span>Volume</span><ButtonGroup aria-label="Volume adjustment"><Button variant="ghost" size="icon" aria-label="Decrease volume" disabled={!volumeReady || volume === 0} onClick={() => changeVolume(-5)}><Minus aria-hidden="true" /></Button><span className="min-w-8 self-center text-center tabular-nums" aria-live="polite">{volume === null ? "—" : Math.round(volume)}</span><Button variant="ghost" size="icon" aria-label="Increase volume" disabled={!volumeReady || volume === 100} onClick={() => changeVolume(5)}><Plus aria-hidden="true" /></Button></ButtonGroup></div>
    {output.error && <Alert variant="destructive"><AlertDescription>{output.error.message || "Couldn't change the output."}</AlertDescription></Alert>}
    {credentials && <Button variant="ghost" className="-mx-2.5 justify-start text-muted-foreground" asChild><Link to="/settings/sound" onClick={onClose}>Sound settings</Link></Button>}
  </section>;
}

// Quick check of where playback runs and where its sound comes out.
// Wi-Fi signal lives in the OS, not here; the LAN address and the audio route are what Couch knows.
export function PlaybackStatus({ credentials, connected, status, installationName, localHost = false, state, run }: {
  credentials: Credentials | null;
  connected: boolean;
  status: string;
  installationName?: string;
  localHost?: boolean;
  state?: ClientSessionState | null;
  run?: (action: Action) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState("");
  const [target, setTarget] = useState<string | null>(null);
  const [addressError, setAddressError] = useState("");
  const name = deviceName(installationName);
  const origin = credentials?.origin ?? location.origin;
  const known = knownConnection();
  const other = known?.origin !== origin ? known : null;
  const label = localHost ? "Playing here" : `Playing on ${name}`;
  const choose = (value: string) => {
    const next = destinationOrigin(value);
    if (!next) { setAddressError("Enter just the address, like 192.168.1.10:4100."); return; }
    setAddressError("");
    if (next !== origin) setTarget(next);
  };
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button variant="ghost" className="min-w-0 gap-2" aria-label={`${label}: ${status}`}>
        <StatusDot connected={connected} />
        <span className="max-w-48 truncate max-sm:max-w-32">{localHost ? label : <><span className="max-sm:sr-only">Playing on </span>{name}</>}</span>
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" className="w-96 gap-4">
      <PopoverHeader><PopoverTitle>Play on</PopoverTitle><PopoverDescription role="status">{status}</PopoverDescription></PopoverHeader>
      {target ? <div className="grid gap-3">
        <p>Switch this browser to {new URL(target).host}?</p>
        <p className="text-muted-foreground">{name} keeps playing. You may need to pair.</p>
        <div className="flex flex-wrap gap-2"><Button onClick={() => location.assign(target)}>Switch</Button><Button variant="ghost" onClick={() => setTarget(null)}>Cancel</Button></div>
      </div> : <>
        <RadioGroup aria-label="Play on" value={origin} onValueChange={choose} className="gap-0">
          {[{ origin, name }, ...(other ? [{ origin: other.origin, name: other.details.name }] : [])].map((item, index) => <Field key={item.origin} orientation="horizontal" className="items-center py-1.5"><RadioGroupItem id={`play-on-${index}`} value={item.origin} aria-label={item.name} /><FieldLabel htmlFor={`play-on-${index}`} className="min-w-0 flex-1 cursor-pointer justify-between gap-2 font-normal"><span className="truncate">{item.name}</span><span className="truncate text-muted-foreground">{new URL(item.origin).host}</span></FieldLabel></Field>)}
        </RadioGroup>
        <form onSubmit={event => { event.preventDefault(); choose(address); }}><InputGroup><InputGroupInput aria-label="Another Couch address" value={address} onChange={event => { setAddress(event.target.value); setAddressError(""); }} placeholder="Another Couch address" autoComplete="url" spellCheck={false} /><InputGroupAddon align="inline-end"><InputGroupButton type="submit" disabled={!address.trim()}>Connect</InputGroupButton></InputGroupAddon></InputGroup></form>
        {addressError && <Alert variant="destructive"><AlertDescription>{addressError}</AlertDescription></Alert>}
      </>}
      <SoundControls credentials={credentials} connected={connected} open={open} state={state} run={run} onClose={() => setOpen(false)} />
    </PopoverContent>
  </Popover>;
}
