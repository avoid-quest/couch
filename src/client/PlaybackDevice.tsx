import { Fragment, createContext, useContext, useEffect, useRef, useState, type FormEvent, type PropsWithChildren } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Monitor, ChevronDown, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useNavigation } from "./navigation";
import { Popover, PopoverTrigger, PopoverContent, PopoverHeader, PopoverTitle, PopoverDescription } from "@/components/ui/popover";
import { isNativeHost } from "./native-context";
import type { Credentials } from "./session";
import { loadedBuild } from "../shared/build";
import { UpdatesSettings } from "./UpdatesSettings";
import { useUpdateActivity } from "./update-activity";

type Choice = { mode: "local" | "remote" | null; address: string | null; targets: string[]; localSetupComplete: boolean };
type Device = Choice & { pending: boolean; error: string | null; choose: (mode: "local" | "remote", address?: string, confirm?: boolean) => Promise<boolean>; retry: () => void; show: () => void; dismiss: () => void; completeLocalSetup: () => Promise<void> };
const Context = createContext<Device | null>(null);
const message = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);
export const usePlaybackDevice = () => useContext(Context);

export function NativeModeGate({ children }: PropsWithChildren) {
  const native = isNativeHost();
  const [choice, setChoice] = useState<Choice | null>(null);
  const [pending, setPending] = useState(native);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [localEpoch, setLocalEpoch] = useState(0);
  const [selecting, setSelecting] = useState(false);
  const sequence = useRef(0);
  const busy = useRef(false);
  useEffect(() => {
    if (!native) return;
    let disposed = false;
    void invoke<Choice>("playback_device").then(value => { if (!disposed) setChoice(value); })
      .catch(reason => { if (!disposed) setError(message(reason)); })
      .finally(() => { if (!disposed) setPending(false); });
    return () => { disposed = true; };
  }, [native]);
  useEffect(() => {
    if (!choice?.mode || selecting) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const connect = async () => {
      const current = ++sequence.current;
      setPending(true);
      try {
        await invoke("retry_playback_device");
        if (!disposed && current === sequence.current) setError(null);
      } catch (reason) {
        if (!disposed && current === sequence.current) {
          setError(message(reason));
          // Automatic retries stay with the chosen remote; only the user can select local mode.
          if (choice.mode === "remote") timer = setTimeout(() => void connect(), Math.min(2_000 * 2 ** failures++, 15_000));
        }
      } finally { if (!disposed && current === sequence.current) setPending(false); }
    };
    void connect();
    return () => { disposed = true; clearTimeout(timer); sequence.current++; };
  }, [choice?.mode, choice?.address, attempt, selecting]);
  if (!native) return children;
  if (!choice) return <main className="grid min-h-dvh place-items-center p-6"><Card className="max-w-md space-y-3 p-6"><h1 className="text-xl font-semibold">Couch</h1><p role="status">{error ?? "Loading playback device…"}</p>{error && <Button onClick={() => location.reload()}>Retry</Button>}</Card></main>;
  const device: Device = {
    ...choice, pending, error,
    choose: async (mode, address, confirm = false) => {
      if (busy.current) return false;
      busy.current = true; setPending(true); setError(null); sequence.current++;
      try {
        const next = await invoke<Choice>("select_playback_device", { mode, address: address ?? null, confirmInterrupt: confirm });
        setChoice(next); setSelecting(false); setAttempt(value => value + 1); if (mode === "local") setLocalEpoch(value => value + 1); return true;
      } catch (reason) { const text = message(reason); setError(text); if (text.startsWith("confirmation-required:")) throw reason; return false; }
      finally { busy.current = false; setPending(false); }
    },
    retry: () => setAttempt(value => value + 1),
    show: () => { setSelecting(true); setPending(false); void invoke("show_playback_device").catch(reason => setError(message(reason))); },
    dismiss: () => setSelecting(false),
    completeLocalSetup: async () => setChoice(await invoke<Choice>("complete_local_setup")),
  };
  return <Context.Provider value={device}>
    {choice.mode !== "local" && <ModeNavigation />}
    {choice.mode === "local" ? <Fragment key={localEpoch}>{children}</Fragment> : choice.mode === "remote" ? <main className="min-h-dvh bg-background">
      <header className="flex h-[88px] items-center justify-between gap-3 border-b px-4" aria-label="App playback device controls">
        <div className="min-w-0"><p className="truncate text-sm font-medium">Playing on {choice.address}</p><p className="text-xs text-muted-foreground" role="status">{pending ? "Connecting…" : error ? "Connection needs attention" : "Media plays on the other computer"}</p></div>
        <div className="flex shrink-0 gap-2"><InstallationUpdates /><PlaybackDevice /><Button variant="outline" onClick={device.retry} disabled={pending}>Retry</Button><Button variant="outline" onClick={() => void device.choose("local")} disabled={pending}>Use this computer</Button></div>
      </header>
      <div className="mx-auto max-w-xl space-y-4 p-6"><h1 className="text-xl font-semibold">Another Couch</h1>
        <p>Pair using the code shown on the playback computer. This app has the same permissions as a browser remote.</p>
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <p className="text-sm text-muted-foreground">If the page stays blank, update this app and its system webview. You can always retry, choose another address, or use this computer. Check the current QR or address on the playback computer if its address changed.</p>
      </div>
    </main> : <main className="grid min-h-dvh place-items-center p-6"><Card className="w-full max-w-md space-y-5 p-6"><h1 className="text-2xl font-semibold">Where do you want to play?</h1><p className="text-muted-foreground">Play on this computer, or control another Couch on your network.</p><DeviceForm firstUse /></Card></main>}
  </Context.Provider>;
}

function InstallationUpdates() {
  const device = usePlaybackDevice()!;
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useUpdateActivity(credentials, !!credentials);
  useEffect(() => {
    const stop = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const connect = async () => {
      try {
        const connection = await invoke<Credentials>("connection_info");
        if (stop.signal.aborted) return;
        if (!connection?.origin || !connection.token) throw new Error("This installation's updater is starting.");
        const response = await fetch(`${connection.origin}/api/maintenance/frontend`, { method: "POST", headers: { Authorization: `Bearer ${connection.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ build: loadedBuild }), signal: AbortSignal.any([stop.signal, AbortSignal.timeout(10_000)]) });
        if (!response.ok) throw new Error("This installation's running build could not be verified.");
        setCredentials(connection); setError(null);
      } catch (reason) { if (!stop.signal.aborted) { setError(message(reason)); timer = setTimeout(() => void connect(), 2_000); } }
    };
    void connect();
    return () => { stop.abort(); clearTimeout(timer); };
  }, []);
  useEffect(() => {
    if (!credentials || open) return;
    const stop = new AbortController();
    // Controlling another app or reconnecting is activity, even when its page is isolated.
    const activity = () => { void fetch(`${credentials.origin}/api/activity`, { method: "POST", headers: { Authorization: `Bearer ${credentials.token}` }, signal: stop.signal }).catch(() => {}); };
    activity();
    const timer = setInterval(activity, 5_000);
    return () => { stop.abort(); clearInterval(timer); };
  }, [credentials, open]);
  const change = (value: boolean) => { setOpen(value); if (value) device.show(); else device.dismiss(); };
  return <Dialog open={open} onOpenChange={change}>
    <DialogTrigger asChild><Button variant="outline">Update this app</Button></DialogTrigger>
    <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader><DialogTitle>Updates for this computer</DialogTitle><DialogDescription>The selected playback computer updates independently. Your saved playback device stays selected.</DialogDescription></DialogHeader>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {credentials ? <UpdatesSettings credentials={credentials} connected showTools={false} /> : <p role="status">Connecting to this installation…</p>}
    </DialogContent>
  </Dialog>;
}

function ModeNavigation() {
  useNavigation(() => {});
  useEffect(() => { document.documentElement.style.setProperty("--interface-scale", "1"); }, []);
  return null;
}

function DeviceForm({ firstUse = false, onDone }: { firstUse?: boolean; onDone?: () => void }) {
  const device = usePlaybackDevice()!;
  const [address, setAddress] = useState(device.address ?? "");
  const [remote, setRemote] = useState(!firstUse && device.mode === "remote");
  const [confirm, setConfirm] = useState<string | null>(null);
  const selectRemote = async (confirmed = false) => {
    try { if (await device.choose("remote", address, confirmed)) onDone?.(); }
    catch (reason) { if (message(reason).startsWith("confirmation-required:")) setConfirm(message(reason).split(":")[1]!); }
  };
  const submit = (event: FormEvent) => { event.preventDefault(); void selectRemote(); };
  return <div className="space-y-4">
    <div className="flex flex-wrap gap-2"><Button disabled={device.pending} onClick={() => void device.choose("local").then(done => { if (done) onDone?.(); })}>This computer</Button><Button variant="outline" disabled={device.pending} onClick={() => setRemote(true)}>Another Couch</Button></div>
    {remote && <form className="space-y-3" onSubmit={submit}><Label htmlFor="playback-address">Couch address</Label><Input id="playback-address" autoFocus value={address} onChange={event => { setAddress(event.target.value); setConfirm(null); }} placeholder="192.168.1.10:4100" autoComplete="url" spellCheck={false} required disabled={device.pending} /><p className="text-xs text-muted-foreground">Use the LAN address shown on the playback computer. A custom domain must point to that LAN. Sources, saved items and queues stay on each computer.</p>
      {confirm ? <Alert><AlertDescription>{confirm === "playback,sharing" ? "Switching stops playback on this computer and disconnects its remotes." : confirm === "playback" ? "Switching stops playback on this computer." : "Switching turns off this computer's remote control until you return to local mode."}<div className="mt-3 flex gap-2"><Button type="button" disabled={device.pending} onClick={() => void selectRemote(true)}>Stop and switch</Button><Button type="button" variant="outline" onClick={() => { setConfirm(null); onDone?.(); }}>Keep this computer</Button></div></AlertDescription></Alert> : <Button type="submit" disabled={device.pending || !address.trim()}>{device.pending ? "Connecting…" : "Connect"}</Button>}
    </form>}
    {device.error && !device.error.startsWith("confirmation-required:") && <Alert variant="destructive"><AlertDescription>{device.error}</AlertDescription></Alert>}
  </div>;
}

export function PlaybackDevice() {
  const device = usePlaybackDevice();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<"address" | "confirmation" | null>(null);
  const [address, setAddress] = useState("");
  const [warning, setWarning] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  if (!device) return null;
  const close = () => { setOpen(false); setDialog(null); device.dismiss(); };
  const select = async (mode: "local" | "remote", target?: string, confirmed = false) => {
    try {
      if (await device.choose(mode, target, confirmed)) close();
      else if (target) { setAddress(target); setOpen(false); setDialog("address"); }
    } catch (reason) {
      if (message(reason).startsWith("confirmation-required:")) {
        setAddress(target!); setWarning(message(reason).split(":")[1]!); setOpen(false); setDialog("confirmation");
      }
    }
  };
  const label = device.mode === "local" ? "This computer" : device.address ?? "Another Couch";
  const targets = [...new Set([...device.targets, ...(device.address ? [device.address] : [])])];
  return <>
    <Popover open={open} onOpenChange={value => { setOpen(value); if (value) device.show(); else if (!dialog) device.dismiss(); }}>
      <PopoverTrigger asChild><Button ref={trigger} variant="outline" size="sm" className="max-w-full"><Monitor aria-hidden="true" /><span className="truncate">Play on: {label}</span><ChevronDown aria-hidden="true" /></Button></PopoverTrigger>
      <PopoverContent align="end" onCloseAutoFocus={event => { if (dialog) event.preventDefault(); }} className="w-80 max-w-[calc(100vw-2rem)] gap-2" onInteractOutside={event => { if (device.pending) event.preventDefault(); }}>
        <PopoverHeader><PopoverTitle>Playback device</PopoverTitle><PopoverDescription>Each computer keeps its own queue and saved items.</PopoverDescription></PopoverHeader>
        <Button variant="ghost" className="justify-between" aria-pressed={device.mode === "local"} disabled={device.pending} onClick={() => void select("local")}><span>This computer</span>{device.mode === "local" && <Check aria-label="Selected" />}</Button>
        {targets.map(target => <Button key={target} variant="ghost" className="justify-between" aria-pressed={device.mode === "remote" && device.address === target} disabled={device.pending} onClick={() => void select("remote", target)}><span className="truncate">{target}</span>{device.mode === "remote" && device.address === target && <Check aria-label="Selected" />}</Button>)}
        <Button variant="outline" disabled={device.pending} onClick={() => { setAddress(""); setDialog("address"); setOpen(false); }}>Another Couch</Button>
        {device.error && !device.error.startsWith("confirmation-required:") && <p role="alert" className="text-destructive">{device.error}</p>}
      </PopoverContent>
    </Popover>
    <Dialog open={dialog !== null} onOpenChange={value => { if (!value) close(); }}>
      <DialogContent className="sm:max-w-xl" showCloseButton={!device.pending} onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus(); }} onInteractOutside={event => { if (device.pending) event.preventDefault(); }} onEscapeKeyDown={event => { if (device.pending) event.preventDefault(); }}>
        <DialogHeader><DialogTitle>{dialog === "confirmation" ? "Switch playback device?" : "Another Couch"}</DialogTitle><DialogDescription>{dialog === "confirmation" ? warning === "playback,sharing" ? "Switching stops playback on this computer and disconnects its remotes." : warning === "playback" ? "Switching stops playback on this computer." : "Switching turns off this computer's remote control until you return to local mode." : "Enter the LAN address shown on the playback computer, then pair there. A custom domain must point to that LAN."}</DialogDescription></DialogHeader>
        {dialog === "confirmation" ? <DialogFooter><Button variant="outline" onClick={close} disabled={device.pending}>Keep this computer</Button><Button onClick={() => void select("remote", address, true)} disabled={device.pending}>Stop and switch</Button></DialogFooter> : <form className="space-y-4" onSubmit={event => { event.preventDefault(); void select("remote", address); }}>
          <div className="space-y-2"><Label htmlFor="another-couch-address">Couch address</Label><Input id="another-couch-address" autoFocus value={address} onChange={event => setAddress(event.target.value)} placeholder="192.168.1.10:4100" autoComplete="url" spellCheck={false} required disabled={device.pending} /></div>
          {device.error && !device.error.startsWith("confirmation-required:") && <Alert variant="destructive"><AlertDescription>{device.error}</AlertDescription></Alert>}
          <DialogFooter><Button type="button" variant="outline" onClick={close} disabled={device.pending}>Cancel</Button><Button type="submit" disabled={device.pending || !address.trim()}>{device.pending ? "Connecting…" : "Connect"}</Button></DialogFooter>
        </form>}
      </DialogContent>
    </Dialog>
  </>;
}

export function LocalSharingPrompt({ credentials, onRemoteControlChange }: { credentials: Credentials | null; onRemoteControlChange?: (enabled: boolean) => void }) {
  const device = usePlaybackDevice();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(false);
  const setSharing = async (enabled: boolean) => {
    if (!credentials || !device || active.current) return;
    active.current = true; setPending(true); setError(null);
    try {
      const response = await fetch(`${credentials.origin}/api/settings/sharing`, { method: "POST", headers: { Authorization: `Bearer ${credentials.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ enabled }), signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error((await response.json()).error ?? "Could not save remote control.");
      onRemoteControlChange?.(enabled);
      await device.completeLocalSetup();
    } catch (reason) { setError(message(reason)); }
    finally { active.current = false; setPending(false); }
  };
  if (!device || device.mode !== "local" || device.localSetupComplete || !credentials) return null;
  return <Dialog open><DialogContent className="sm:max-w-xl" showCloseButton={false} onEscapeKeyDown={event => event.preventDefault()} onInteractOutside={event => event.preventDefault()}><DialogHeader><DialogTitle>Allow remote control?</DialogTitle><DialogDescription>Browsers and other Couch apps on your LAN can pair to control this computer. You can change this later in Settings.</DialogDescription></DialogHeader>{error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}<DialogFooter><Button variant="outline" disabled={pending} onClick={() => void setSharing(false)}>Keep private</Button><Button disabled={pending} onClick={() => void setSharing(true)}>Allow remote control</Button></DialogFooter></DialogContent></Dialog>;
}
