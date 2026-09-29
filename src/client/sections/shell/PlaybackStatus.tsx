import type { ClientSessionState } from "@/session/session";
import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Field, FieldLabel } from "@/components/ui/field";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SoundState } from "../../../shared/sound";
import { ApiError, apiSend } from "@/api/client";
import { soundQuery, soundView, type SoundView } from "@/api/settings";
import type { Credentials } from "@/session/session";
import type { Action } from "../../../shared/protocol";
import { forgetConnection, knownConnection } from "@/session/connection";
import { deviceName } from "@/copy";
import { playingElsewhere } from "@/session/device-id";
import { useOptionalSessionGate } from "@/session/session-context";
import { PlaybackVolume } from "@/components/PlaybackTransport";
import { DeviceList } from "./Outputs";
import { StatusDot } from "./StatusLine";

function destinationOrigin(address: string): string | null {
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(address.trim()) ? address.trim() : `http://${address.trim()}`);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash ? url.origin : null;
  } catch { return null; }
}

const noCredentials = { origin: "", token: "" };

/** Volume of the looked-at Playback, plus this Couch's sound outputs where it controls them (Linux). */
export function SoundControls({ credentials, connected, open, state, run, onClose }: {
  credentials: Credentials | null;
  connected: boolean;
  open: boolean;
  state?: ClientSessionState | null;
  run?: (action: Action) => Promise<boolean>;
  onClose?: () => void;
}) {
  const queryClient = useQueryClient();
  const gate = useOptionalSessionGate();
  const trigger = useRef<HTMLButtonElement>(null);
  const admin = !!gate?.localHost || gate?.identity?.authority === "host" || gate?.identity?.authority === "administrator";
  // Mac and Windows Couches have no system outputs to choose (#644 ticket 3), so only the volume shows.
  const system = !!gate?.details?.systemAudio;
  const enabled = open && !!credentials && connected && system;
  const soundRead = useQuery({ ...soundQuery(credentials ?? noCredentials), enabled });
  const sound = enabled ? soundRead.data ?? null : null;
  const output = useMutation({
    mutationFn: (value: string) => apiSend<SoundState>(credentials!, "/api/sound/output", { output: value }, "POST", 5_000),
    onSuccess: result => queryClient.setQueryData<SoundView>(soundQuery(credentials!).queryKey, previous => soundView(previous, result)),
  });
  const outputs = sound?.outputs.filter(output => output.availability !== "unavailable" && !output.testBlocked) ?? [];
  const selected = sound?.routing?.selectedOutput ?? sound?.defaultOutput ?? null;
  const observed = sound?.outputs.find(output => output.id === sound.routing?.observedOutput);
  const forbidden = soundRead.error instanceof ApiError && soundRead.error.status === 403;
  const unavailable = soundRead.error ? "Couldn't load outputs."
    : soundRead.isLoading ? "Checking outputs…" : "No outputs.";
  // Offline, the shell's status line already says so; there is nothing to adjust.
  if (!connected) return null;
  return <section aria-labelledby="sound-controls-title" className="grid gap-2 border-t pt-3 first:border-t-0 first:pt-0">
    <h3 id="sound-controls-title" className="text-sm font-medium">Sound</h3>
    {outputs.length ? <RadioGroup aria-label="Sound output" value={selected ?? ""} disabled={output.isPending || !connected} onValueChange={value => { if (credentials) output.mutate(value); }} className="gap-0">{outputs.map((item, index) => <Field orientation="horizontal" className="items-center py-1.5" key={item.id}><RadioGroupItem id={`quick-output-${index}`} value={item.id} /><FieldLabel htmlFor={`quick-output-${index}`} className="min-w-0 flex-1 cursor-pointer truncate font-normal">{item.name || item.id}</FieldLabel></Field>)}</RadioGroup> : system && !forbidden && <p className="text-muted-foreground">{unavailable}</p>}
    {observed && observed.id !== selected && <p className="text-muted-foreground">Playing through {observed.name || observed.id}.</p>}
    {state && run && <PlaybackVolume state={state} connected={connected} run={run} />}
    {output.error && <Alert variant="destructive"><AlertDescription>{output.error.message || "Couldn't change the output."}</AlertDescription></Alert>}
    {credentials && admin && system && <Button variant="ghost" className="-mx-2.5 justify-start text-muted-foreground" asChild><Link to="/settings/sound" onClick={onClose}>Sound settings</Link></Button>}
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
  const gate = useOptionalSessionGate();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [forgetting, setForgetting] = useState<{ origin: string; name: string } | null>(null);
  const [address, setAddress] = useState("");
  const [target, setTarget] = useState<string | null>(null);
  const [addressError, setAddressError] = useState("");
  const name = deviceName(installationName);
  const origin = credentials?.origin ?? location.origin;
  const known = knownConnection();
  const other = known?.origin !== origin ? known : null;
  // Play starts on this Device, so the label names another Device only while it plays (#644 ticket 6).
  const renderer = playingElsewhere(state);
  // Before pairing nothing plays here yet: the button names the Couch this browser is pairing with (#644 ticket 12).
  const unpaired = !credentials || !!gate?.pairingRequired;
  const label = unpaired ? name : renderer?.label ?? "Playing here";
  const choose = (value: string) => {
    const next = destinationOrigin(value);
    if (!next) { setAddressError("Enter just the address, like 192.168.1.10:4100."); return; }
    setAddressError("");
    if (next !== origin) setTarget(next);
  };
  return <><Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button variant="ghost" className="min-w-0 shrink gap-2 touch:min-w-11" aria-label={`${label}: ${status}`}>
        <StatusDot connected={connected} />
        <span className="max-w-48 truncate max-sm:max-w-32">{renderer && !renderer.here && !unpaired ? <><span className="max-sm:sr-only">Playing on </span>{renderer.name}</> : label}</span>
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" className="max-h-(--radix-popover-content-available-height) w-96 gap-4 overflow-y-auto" onCloseAutoFocus={event => { if (forgetting) event.preventDefault(); }}>
      {/* Devices first: looking at another Device's Playback is what this popover is for (#644 ticket 12). */}
      {state && run && <DeviceList state={state} run={run} />}
      <section aria-label="Couch" className="grid gap-3 border-t pt-3 first:border-t-0 first:pt-0">
      <PopoverHeader className="flex-row items-baseline justify-between gap-3"><PopoverTitle>Couch</PopoverTitle><PopoverDescription role="status">{status}</PopoverDescription></PopoverHeader>
      {target ? <div className="grid gap-3">
        <p>Switch this browser to {new URL(target).host}?</p>
        <p className="text-muted-foreground">{name} keeps playing. You may need to pair.</p>
        <div className="flex flex-wrap gap-2"><Button onClick={() => location.assign(target)}>Switch</Button><Button variant="ghost" onClick={() => setTarget(null)}>Cancel</Button></div>
      </div> : <>
        <RadioGroup aria-label="Couch" value={origin} onValueChange={choose} className="gap-0">
          {[{ origin, name }, ...(other ? [{ origin: other.origin, name: other.details.name }] : [])].map((item, index) => <Field key={item.origin} orientation="horizontal" className="items-center py-1.5"><RadioGroupItem id={`play-on-${index}`} value={item.origin} aria-label={item.name} /><FieldLabel htmlFor={`play-on-${index}`} className="min-w-0 flex-1 cursor-pointer justify-between gap-2 font-normal"><span className="truncate">{item.name}</span><span className="truncate text-muted-foreground">{new URL(item.origin).host}</span></FieldLabel>{(item.origin !== origin || !localHost && credentials && gate) && <Button variant="ghost" size="sm" className="text-muted-foreground" aria-label={`Forget ${item.name}`} onClick={() => { setForgetting(item); setOpen(false); }}>Forget</Button>}</Field>)}
        </RadioGroup>
        <form onSubmit={event => { event.preventDefault(); choose(address); }}><InputGroup><InputGroupInput aria-label="Another Couch address" value={address} onChange={event => { setAddress(event.target.value); setAddressError(""); }} placeholder="Another Couch address" autoComplete="url" spellCheck={false} /><InputGroupAddon align="inline-end"><InputGroupButton type="submit" disabled={!address.trim()}>Connect</InputGroupButton></InputGroupAddon></InputGroup></form>
        {addressError && <Alert variant="destructive"><AlertDescription>{addressError}</AlertDescription></Alert>}
      </>}
      </section>
      {/* Sound last: a focused slider owns the arrow keys, so a TV remote reaches everything above it first. */}
      <SoundControls credentials={credentials} connected={connected} open={open} state={state} run={run} onClose={() => setOpen(false)} />
    </PopoverContent>
  </Popover><AlertDialog open={forgetting !== null} onOpenChange={value => { if (!value) setForgetting(null); }}>
    <AlertDialogContent onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus(); }}>
      <AlertDialogHeader><AlertDialogTitle>Forget {forgetting?.name}?</AlertDialogTitle><AlertDialogDescription>That Couch keeps playing. You'll need to pair again to reconnect.</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => { if (forgetting) { forgetConnection(forgetting.origin); if (forgetting.origin === origin) gate?.unpair(); } setForgetting(null); }}>Forget</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog></>;
}
