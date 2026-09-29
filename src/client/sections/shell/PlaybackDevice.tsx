import type { ClientSessionState } from "@/session/session";
import { createContext, useContext, useEffect, useRef, useState, type FormEvent, type PropsWithChildren } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Field, FieldLabel } from "@/components/ui/field";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverTrigger, PopoverContent, PopoverHeader, PopoverTitle } from "@/components/ui/popover";
import { useMutation } from "@tanstack/react-query";
import { apiSend } from "@/api/client";
import { forgetConnection } from "@/session/connection";
import { deviceId } from "@/session/device-id";
import { defaultDeviceName } from "../../../shared/devices";
import { couchApp, type AppMode } from "@/session/native-context";
import type { Credentials } from "@/session/session";
import { ChevronRight } from "lucide-react";
import { TRY_AGAIN } from "@/copy";
import { SoundControls } from "./PlaybackStatus";
import { Onboarding } from "./Onboarding";
import { DeviceList } from "./Outputs";
import { StatusDot, StatusLine } from "./StatusLine";
import type { Action } from "../../../shared/protocol";
import { playingElsewhere } from "@/session/device-id";

export type Choice = AppMode;
type Device = Choice & { pending: boolean; error: string | null; choose: (mode: "local" | "remote", address?: string, confirm?: boolean) => Promise<boolean>; forget: (address: string) => Promise<boolean>; completeLocalSetup: () => Promise<void> };
const Context = createContext<Device | null>(null);
const message = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);
export const usePlaybackDevice = () => useContext(Context);

// The app window shows this computer's Couch (Full mode) or another Couch's own
// page (Client mode). Switching reloads the window, so the page never outlives its mode.
export function NativeModeGate({ children }: PropsWithChildren) {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [pending, setPending] = useState(!!couchApp);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  useEffect(() => {
    if (!couchApp) return;
    let disposed = false;
    void couchApp.mode().then(value => { if (!disposed) setChoice(value); })
      .catch(reason => { if (!disposed) setError(message(reason)); })
      .finally(() => { if (!disposed) setPending(false); });
    return () => { disposed = true; };
  }, []);
  if (!couchApp) return children;
  const app = couchApp;
  if (!choice) return <main className="flex min-h-dvh flex-col bg-background">
    <Onboarding title="Couch">{error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription><AlertAction><Button variant="ghost" size="sm" onClick={() => location.reload()}>{TRY_AGAIN}</Button></AlertAction></Alert> : <StatusLine busy>Loading…</StatusLine>}</Onboarding>
  </main>;
  const device: Device = {
    ...choice, pending, error,
    choose: async (mode, address, confirm = false) => {
      if (busy.current) return false;
      busy.current = true; setPending(true); setError(null);
      try {
        // No answer means the window is loading the chosen Couch.
        const next = await app.choose(mode, address ?? null, confirm);
        if (next) { setChoice(next); setPending(false); }
        return true;
      } catch (reason) { const text = message(reason); setError(text); setPending(false); if (text.startsWith("confirmation-required:")) throw reason; return false; }
      finally { busy.current = false; }
    },
    forget: async address => {
      if (busy.current) return false;
      busy.current = true; setPending(true); setError(null);
      try {
        const next = await app.forget(address);
        try {
          const names = targetNames();
          delete names[address];
          localStorage.setItem(namesKey, JSON.stringify(names));
        } catch { /* Storage may be unavailable. The app still forgets the address. */ }
        forgetConnection(address);
        if (next) setChoice(next);
        return true;
      } catch (reason) { setError(message(reason)); return false; }
      finally { busy.current = false; setPending(false); }
    },
    completeLocalSetup: async () => setChoice(await app.completeLocalSetup()),
  };
  return <Context.Provider value={device}>
    {choice.mode ? children : <main className="flex min-h-dvh flex-col bg-background" data-tv-navigation-scope>
      <Onboarding title="Where do you want to play?"><DeviceForm /></Onboarding>
    </main>}
  </Context.Provider>;
}

const hostOf = (address: string) => address.replace(/^https?:\/\//i, "").replace(/\/$/, "");
// Native choices remember only addresses, so each Couch's name is kept here once seen.
const namesKey = "couch.target-names";
const targetNames = (): Record<string, string> => { try { return Object.fromEntries(Object.entries(JSON.parse(localStorage.getItem(namesKey) || "{}") ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string")); } catch { return {}; } };
const confirmationText = (reason: string) => reason === "playback,sharing" ? "Playback here stops and its remotes disconnect." : reason === "playback" ? "Playback here stops." : "Remotes can't reach this computer until you switch back.";

function DeviceForm() {
  const device = usePlaybackDevice()!;
  const [address, setAddress] = useState(device.address ?? "");
  const [confirm, setConfirm] = useState<string | null>(null);
  const [forgetting, setForgetting] = useState<string | null>(null);
  const [names] = useState(targetNames);
  const selectRemote = async (confirmed = false) => {
    try { await device.choose("remote", address, confirmed); }
    catch (reason) { if (message(reason).startsWith("confirmation-required:")) setConfirm(message(reason).split(":")[1]!); }
  };
  const submit = (event: FormEvent) => { event.preventDefault(); void selectRemote(); };
  return <div className="grid gap-6">
    <div className="-mx-3 border-t">
      <Button variant="ghost" aria-label="This computer" className="h-auto w-full justify-between gap-4 rounded-none border-0 border-b px-3 py-4 text-left font-normal whitespace-normal" disabled={device.pending} onClick={() => void device.choose("local")}>
        <span className="grid gap-0.5"><span className="text-base font-medium">This computer</span><span className="text-sm text-muted-foreground">Play here. Phones can pair as remotes.</span></span>
        <ChevronRight aria-hidden="true" />
      </Button>
      {device.targets.map(target => <div key={target} className="flex items-center border-b"><Button variant="ghost" className="h-auto w-full justify-between gap-4 rounded-none border-0 px-3 py-4 text-left font-normal whitespace-normal" disabled={device.pending} onClick={() => void device.choose("remote", target)}>
        <span className="grid gap-0.5"><span className="text-base font-medium">{names[target] || hostOf(target)}</span>{names[target] && <span className="text-sm text-muted-foreground">{hostOf(target)}</span>}</span>
        <ChevronRight aria-hidden="true" />
      </Button><Button variant="ghost" size="sm" disabled={device.pending} aria-label={`Forget ${names[target] || hostOf(target)}`} onClick={() => setForgetting(target)}>Forget</Button></div>)}
      <form className="grid gap-3 border-b px-3 py-4" onSubmit={submit}>
        <div className="grid gap-0.5"><Label htmlFor="playback-address" className="text-base font-medium">Another Couch</Label><p className="text-sm text-muted-foreground">Control a Couch on your network.</p></div>
        <div className="flex gap-2"><Input id="playback-address" aria-label="Couch address" value={address} onChange={event => { setAddress(event.target.value); setConfirm(null); }} placeholder="192.168.1.10:4100" autoComplete="url" spellCheck={false} required disabled={device.pending} />
          {!confirm && <Button type="submit" disabled={device.pending || !address.trim()}>{device.pending ? "Connecting…" : "Connect"}</Button>}
        </div>
        {confirm && <div className="grid gap-3"><p className="text-sm text-muted-foreground">{confirmationText(confirm)}</p><div className="flex flex-wrap gap-2"><Button type="button" disabled={device.pending} onClick={() => void selectRemote(true)}>Stop and switch</Button><Button type="button" variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button></div></div>}
      </form>
    </div>
    <AlertDialog open={forgetting !== null} onOpenChange={open => { if (!open && !device.pending) setForgetting(null); }}>
      <AlertDialogContent data-tv-local-only onCloseAutoFocus={event => { event.preventDefault(); document.querySelector<HTMLButtonElement>('[aria-label="This computer"]')?.focus(); }}>
        <AlertDialogHeader><AlertDialogTitle>Forget {forgetting && hostOf(forgetting)}?</AlertDialogTitle><AlertDialogDescription>That Couch keeps playing. You'll need to pair again to reconnect.</AlertDialogDescription></AlertDialogHeader>
        {device.error && <Alert variant="destructive"><AlertDescription>{device.error}</AlertDescription></Alert>}
        <AlertDialogFooter><AlertDialogCancel disabled={device.pending}>Cancel</AlertDialogCancel><AlertDialogAction disabled={device.pending} onClick={event => { event.preventDefault(); if (forgetting) void device.forget(forgetting).then(done => { if (done) setForgetting(null); }); }}>Forget</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    {device.error && !device.error.startsWith("confirmation-required:") && <Alert variant="destructive"><AlertDescription>{device.error}</AlertDescription></Alert>}
  </div>;
}

export function PlaybackDevice({ credentials = null, connected = false, installationName, state = null, run }: {
  credentials?: Credentials | null;
  connected?: boolean;
  installationName?: string;
  state?: ClientSessionState | null;
  run?: (action: Action) => Promise<boolean>;
  /** Offer this app's own updater (a remote-mode desktop app). */
}) {
  const device = usePlaybackDevice();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<"address" | "confirmation" | "forget" | null>(null);
  const [address, setAddress] = useState("");
  const [warning, setWarning] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const [names, setNames] = useState(targetNames);
  useEffect(() => {
    if (device?.mode !== "remote" || !device.address || !installationName || names[device.address] === installationName) return;
    const next = { ...names, [device.address]: installationName };
    setNames(next);
    try { localStorage.setItem(namesKey, JSON.stringify(next)); } catch { /* Names are a convenience; addresses still work. */ }
  }, [device?.mode, device?.address, installationName, names]);
  if (!device) return null;
  const close = () => { setOpen(false); setDialog(null); };
  const openDialog = (value: NonNullable<typeof dialog>) => { setOpen(false); setDialog(value); };
  const select = async (mode: "local" | "remote", target?: string, confirmed = false) => {
    try {
      if (await device.choose(mode, target, confirmed)) close();
      else if (target) { setAddress(target); openDialog("address"); }
    } catch (reason) {
      if (message(reason).startsWith("confirmation-required:")) { setAddress(target!); setWarning(message(reason).split(":")[1]!); openDialog("confirmation"); }
    }
  };
  const failure = device.error && !device.error.startsWith("confirmation-required:") ? device.error : null;
  const nameOf = (target: string) => device.mode === "remote" && device.address === target && installationName || names[target];
  const target = installationName || (device.address ? hostOf(device.address) : "Couch");
  const elsewhere = playingElsewhere(state);
  const targets = [...new Set([...device.targets, ...(device.address ? [device.address] : [])])];
  const pendingGuard = (event: Event) => { if (device.pending) event.preventDefault(); };
  return <>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Button ref={trigger} data-tv-local-only variant="ghost" className="min-w-0 shrink gap-2 touch:min-w-11"><StatusDot connected={connected} /><span className="max-w-48 truncate max-sm:max-w-32">{device.mode === "local" ? elsewhere ? <><span className="max-sm:sr-only">Playing on </span>{elsewhere.name}</> : "Playing here" : <><span className="max-sm:sr-only">Playing on </span>{target}</>}</span></Button></PopoverTrigger>
      <PopoverContent data-tv-local-only align="end" onCloseAutoFocus={event => { if (dialog) event.preventDefault(); }} onInteractOutside={pendingGuard} className="w-96 gap-4">
        <PopoverHeader><PopoverTitle>Play on</PopoverTitle></PopoverHeader>
        <RadioGroup aria-label="Play on" value={device.mode === "local" ? "local" : device.mode === "remote" ? `remote:${device.address}` : ""} disabled={device.pending} onValueChange={value => { if (value === "local") void select("local"); else void select("remote", value.slice(7)); }} className="gap-0">
          <Field orientation="horizontal" className="items-center py-1.5"><RadioGroupItem id="play-on-local" value="local" aria-label="This computer" /><FieldLabel htmlFor="play-on-local" className="min-w-0 flex-1 cursor-pointer justify-between font-normal"><span>This computer</span><span className="text-muted-foreground">Here</span></FieldLabel></Field>
          {targets.map((target, index) => {
            const named = nameOf(target);
            return <Field orientation="horizontal" className="items-center py-1.5" key={target}><RadioGroupItem id={`play-on-remote-${index}`} value={`remote:${target}`} aria-label={target} /><FieldLabel htmlFor={`play-on-remote-${index}`} className="min-w-0 flex-1 cursor-pointer justify-between gap-2 font-normal"><span className="truncate">{named || hostOf(target)}</span>{named && <span className="truncate text-muted-foreground">{hostOf(target)}</span>}</FieldLabel><Button variant="ghost" size="sm" className="text-muted-foreground" aria-label={`Forget ${named || hostOf(target)}`} disabled={device.pending} onClick={() => { setAddress(target); openDialog("forget"); }}>Forget</Button></Field>;
          })}
        </RadioGroup>
        <form onSubmit={event => { event.preventDefault(); void select("remote", address); }}><InputGroup><InputGroupInput aria-label="Another Couch address" value={address} onChange={event => setAddress(event.target.value)} placeholder="Another Couch address" autoComplete="url" spellCheck={false} disabled={device.pending} /><InputGroupAddon align="inline-end"><InputGroupButton type="submit" disabled={device.pending || !address.trim()}>Connect</InputGroupButton></InputGroupAddon></InputGroup></form>
        {failure && <Alert variant="destructive"><AlertDescription>{failure}</AlertDescription></Alert>}
        {state && run && <DeviceList state={state} run={run} />}
        <SoundControls credentials={credentials} connected={connected} open={open} state={state} run={run} onClose={close} />
      </PopoverContent>
    </Popover>
    <AlertDialog open={dialog === "confirmation"} onOpenChange={value => { if (!value) close(); }}>
      <AlertDialogContent data-tv-local-only onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus(); }} onEscapeKeyDown={pendingGuard}>
        <AlertDialogHeader><AlertDialogTitle>Switch to {hostOf(address)}?</AlertDialogTitle><AlertDialogDescription>{confirmationText(warning)}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel disabled={device.pending}>Cancel</AlertDialogCancel><AlertDialogAction onClick={event => { event.preventDefault(); void select("remote", address, true); }} disabled={device.pending}>Stop and switch</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <AlertDialog open={dialog === "forget"} onOpenChange={value => { if (!value) close(); }}>
      <AlertDialogContent data-tv-local-only onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus(); }} onEscapeKeyDown={pendingGuard}>
        <AlertDialogHeader><AlertDialogTitle>Forget {nameOf(address) || hostOf(address)}?</AlertDialogTitle><AlertDialogDescription>This computer will forget its address and pairing. That Couch keeps playing. You'll need to pair again to reconnect.</AlertDialogDescription></AlertDialogHeader>
        {failure && <Alert variant="destructive"><AlertDescription>{failure}</AlertDescription></Alert>}
        <AlertDialogFooter><AlertDialogCancel disabled={device.pending}>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={async event => { event.preventDefault(); if (await device.forget(address)) { setNames(targetNames()); setAddress(""); close(); } }} disabled={device.pending}>{device.pending ? "Forgetting…" : "Forget"}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <Dialog open={dialog === "address"} onOpenChange={value => { if (!value) close(); }}>
      <DialogContent data-tv-local-only showCloseButton={!device.pending} onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus(); }} onInteractOutside={pendingGuard} onEscapeKeyDown={pendingGuard}>
        <DialogHeader><DialogTitle>Another Couch</DialogTitle><DialogDescription>Enter the address shown on that Couch.</DialogDescription></DialogHeader>
        <form className="grid gap-4" onSubmit={event => { event.preventDefault(); void select("remote", address); }}>
          <Field><FieldLabel htmlFor="another-couch-address">Couch address</FieldLabel><Input id="another-couch-address" autoFocus value={address} onChange={event => setAddress(event.target.value)} placeholder="192.168.1.10:4100" autoComplete="url" spellCheck={false} required disabled={device.pending} /></Field>
          {failure && <Alert variant="destructive"><AlertDescription>{failure}</AlertDescription></Alert>}
          <DialogFooter><Button type="button" variant="ghost" onClick={close} disabled={device.pending}>Cancel</Button><Button type="submit" disabled={device.pending || !address.trim()}>{device.pending ? "Connecting…" : "Connect"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}

/** A new local setup asks about remotes before anything else. */
export function useLocalSetupPending(credentials: Credentials | null) {
  const device = usePlaybackDevice();
  return !!credentials && device?.mode === "local" && !device.localSetupComplete;
}

// The server bumps the devices revision, which refreshes remoteControlEnabled.
// The app window is this Couch's Device, so its name is asked here, once.
export function LocalSharingPrompt({ credentials }: { credentials: Credentials | null }) {
  const device = usePlaybackDevice();
  const pending = useLocalSetupPending(credentials);
  const [name, setName] = useState("");
  const sharing = useMutation({
    mutationFn: async (enabled: boolean) => {
      await apiSend(credentials!, "/api/settings", { name: name.trim() || defaultDeviceName(deviceId()) }, "POST", 10_000);
      await apiSend(credentials!, "/api/settings/sharing", { enabled }, "POST", 10_000);
      await device!.completeLocalSetup();
    },
  });
  if (!pending) return null;
  const setSharing = (enabled: boolean) => { if (!sharing.isPending) sharing.mutate(enabled); };
  return <Onboarding title="Allow remotes?" description="Phones on your network can pair and control playback. Change it in Settings → Devices." data-tv-navigation-scope>
    <Field><FieldLabel htmlFor="host-name">Name this computer</FieldLabel><Input id="host-name" autoComplete="off" maxLength={60} placeholder={defaultDeviceName(deviceId())} value={name} onChange={event => setName(event.target.value)} disabled={sharing.isPending} /></Field>
    {sharing.error && <Alert variant="destructive"><AlertDescription>{message(sharing.error)}</AlertDescription></Alert>}
    <div className="flex flex-wrap gap-2"><Button autoFocus disabled={sharing.isPending} onClick={() => setSharing(true)}>Allow</Button><Button variant="ghost" disabled={sharing.isPending} onClick={() => setSharing(false)}>Not now</Button></div>
  </Onboarding>;
}
