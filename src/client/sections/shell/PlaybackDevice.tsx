import { Fragment, createContext, useContext, useEffect, useRef, useState, type FormEvent, type PropsWithChildren } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Monitor, ChevronDown, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverTrigger, PopoverContent, PopoverHeader, PopoverTitle, PopoverDescription } from "@/components/ui/popover";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { isNativeHost } from "@/session/native-context";
import type { Credentials } from "@/session/session";
import { buildInfo, loadedBuild } from "../../../shared/build";
import { UpdatesSettings } from "@/sections/settings/system/UpdatesSettings";
import { useLocalUpdateActivity } from "@/update-activity";
import { SoundControls } from "./PlaybackStatus";
import type { Action, SessionState } from "../../../shared/protocol";

export type Choice = { mode: "local" | "remote" | null; address: string | null; targets: string[]; localSetupComplete: boolean };
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
  const [recoveryEpoch, setRecoveryEpoch] = useState(0);
  const [selecting, setSelecting] = useState(false);
  const sequence = useRef(0);
  const busy = useRef(false);
  const failedPreflight = useRef(false);
  useLocalUpdateActivity(native && choice?.mode === "remote");
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
        if (!disposed && current === sequence.current) {
          setError(null);
          if (choice.mode === "remote" && failedPreflight.current) {
            failedPreflight.current = false;
            setRecoveryEpoch(value => value + 1);
          }
        }
      } catch (reason) {
        if (!disposed && current === sequence.current) {
          failedPreflight.current = true;
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
    show: () => { setSelecting(true); setPending(false); },
    dismiss: () => setSelecting(false),
    completeLocalSetup: async () => setChoice(await invoke<Choice>("complete_local_setup")),
  };
  return <Context.Provider value={device}>
    {choice.mode === "local" ? <Fragment key={`local:${localEpoch}`}>{children}</Fragment> : choice.mode === "remote" ? <>
      <Fragment key={`remote:${choice.address}:${recoveryEpoch}`}>{children}</Fragment>
      {error && <aside className="fixed bottom-4 right-4 z-50 w-[min(26rem,calc(100vw-2rem))]" aria-label="Playback device recovery"><Card className="gap-2 p-4 shadow-lg">
        <p className="font-medium">Another Couch needs attention</p>
        <p className="mt-1 text-sm text-muted-foreground" role="alert">{error}</p>
        <p className="mt-1 text-sm text-muted-foreground">Choose another address from Play on{buildInfo.clientOnly ? "." : ", or return to this computer."}</p>
        <div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" onClick={device.retry} disabled={pending}>Retry</Button>{!buildInfo.clientOnly && <Button variant="outline" onClick={() => void device.choose("local")} disabled={pending}>Use this computer</Button>}</div>
      </Card></aside>}
    </> : <main className="flex min-h-dvh flex-col justify-center bg-black px-[clamp(2rem,10vw,8rem)] py-12 text-white" style={{ fontFamily: "'Inter Tight Variable', sans-serif" }} data-tv-navigation-scope>
      <h1 className="text-[clamp(2.3rem,4vw,3rem)] font-semibold tracking-[-.03em]">{buildInfo.clientOnly ? "Connect to another Couch" : "Where do you want to play?"}</h1>
      {buildInfo.clientOnly && <p className="mt-3 max-w-[40rem] text-lg text-white/70">This Client-only app controls another Couch on your network. Local playback is unavailable.</p>}
      <DeviceForm />
    </main>}
  </Context.Provider>;
}

export function InstallationUpdates() {
  const device = usePlaybackDevice()!;
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: "always" } } }));
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => queryClient.clear(), [queryClient]);
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
  const change = (value: boolean) => { setOpen(value); if (value) device.show(); else device.dismiss(); };
  return <QueryClientProvider client={queryClient}><Dialog open={open} onOpenChange={change}>
    <DialogTrigger asChild><Button variant="outline">Update this app</Button></DialogTrigger>
    <DialogContent>
      <DialogHeader><DialogTitle>Updates for this computer</DialogTitle><DialogDescription>This computer updates itself. The selected playback computer has separate updates, and your saved playback device stays selected.</DialogDescription></DialogHeader>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {credentials ? <UpdatesSettings credentials={credentials} connected target="this app" /> : <p role="status">Connecting to this installation…</p>}
    </DialogContent>
  </Dialog></QueryClientProvider>;
}

function DeviceForm() {
  const device = usePlaybackDevice()!;
  const [address, setAddress] = useState(device.address ?? "");
  const [confirm, setConfirm] = useState<string | null>(null);
  const selectRemote = async (confirmed = false) => {
    try { await device.choose("remote", address, confirmed); }
    catch (reason) { if (message(reason).startsWith("confirmation-required:")) setConfirm(message(reason).split(":")[1]!); }
  };
  const submit = (event: FormEvent) => { event.preventDefault(); void selectRemote(); };
  return <div className="mt-8 grid max-w-[48rem] grid-cols-2 gap-8 max-md:grid-cols-1">
    {!buildInfo.clientOnly && <Button variant="ghost" aria-label="This computer" className="first-run-interactive h-auto min-h-40 flex-col items-start justify-start gap-2 rounded-sm border border-white/20 bg-transparent p-6 text-left text-white" disabled={device.pending} onClick={() => void device.choose("local") }><span className="text-[1.4rem] font-medium">This computer</span><span className="whitespace-normal text-[.95rem] font-normal opacity-65">Play here. Phones can pair as remotes.</span></Button>}
    <form className="min-h-40 space-y-3 rounded-sm border border-white/20 p-6" onSubmit={submit}>
      <h2 className="text-[1.4rem] font-medium">Another Couch</h2>
      <Label htmlFor="playback-address" className="sr-only">Couch address</Label>
      <Input id="playback-address" value={address} onChange={event => { setAddress(event.target.value); setConfirm(null); }} placeholder="Another Couch address" autoComplete="url" spellCheck={false} required disabled={device.pending} className="h-12 rounded-none border-0 border-b border-white bg-transparent px-0 text-lg text-white shadow-none placeholder:text-white/40 focus-visible:ring-0" />
      {confirm ? <Alert><AlertDescription>{confirm === "playback,sharing" ? "Switching stops playback on this computer and disconnects its remotes." : confirm === "playback" ? "Switching stops playback on this computer." : "Switching turns off this computer's remote control until you return to local mode."}<div className="mt-3 flex gap-2"><Button type="button" disabled={device.pending} onClick={() => void selectRemote(true)}>Stop and switch</Button><Button type="button" variant="outline" onClick={() => setConfirm(null)}>Keep this computer</Button></div></AlertDescription></Alert> : <Button type="submit" variant="outline" className="first-run-interactive rounded-sm border-white bg-transparent text-white" disabled={device.pending || !address.trim()}>{device.pending ? "Connecting…" : "Connect"}</Button>}
    </form>
    {device.error && !device.error.startsWith("confirmation-required:") && <Alert variant="destructive"><AlertDescription>{device.error}</AlertDescription></Alert>}
  </div>;
}

export function PlaybackDevice({ standardLayout = false, credentials = null, connected = false, installationName, state = null, run }: {
  standardLayout?: boolean;
  credentials?: Credentials | null;
  connected?: boolean;
  installationName?: string;
  state?: SessionState | null;
  run?: (action: Action) => Promise<boolean>;
}) {
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
  const label = device.mode === "local" ? "This computer" : installationName || device.address || "Another Couch";
  const targets = [...new Set([...device.targets, ...(device.address ? [device.address] : [])])];
  return <>
    <Popover open={open} onOpenChange={value => { setOpen(value); if (value) device.show(); else if (!dialog) device.dismiss(); }}>
      <PopoverTrigger asChild><Button ref={trigger} variant={standardLayout ? "ghost" : "outline"} size="sm" className={standardLayout ? "playback-device-trigger max-w-full" : "max-w-full"}><Monitor aria-hidden="true" /><span className="truncate">{standardLayout ? device.mode === "local" ? "Playing here" : `Playing on ${label}` : `Play on: ${label}`}</span><ChevronDown aria-hidden="true" /></Button></PopoverTrigger>
      <PopoverContent align="end" onCloseAutoFocus={event => { if (dialog) event.preventDefault(); }} className="device-menu w-[min(26rem,calc(100vw-2rem))] gap-2" onInteractOutside={event => { if (device.pending) event.preventDefault(); }}>
        {standardLayout ? <p className="device-section-label">Play on</p> : <PopoverHeader><PopoverTitle>Playback device</PopoverTitle><PopoverDescription>Each computer keeps its own queue and saved items.</PopoverDescription></PopoverHeader>}
        {!buildInfo.clientOnly && (standardLayout ? <Button variant="ghost" className="device-row" aria-pressed={device.mode === "local"} disabled={device.pending} onClick={() => void select("local")}><span>{device.mode === "local" && <Check aria-hidden="true" />} {device.mode === "local" ? installationName || "This computer" : "This computer"}</span>{device.mode === "local" && <span className="device-row-hint">Here</span>}</Button> : <Button variant="ghost" className="justify-between" aria-pressed={device.mode === "local"} disabled={device.pending} onClick={() => void select("local")}><span>This computer</span>{device.mode === "local" && <Check aria-label="Selected" />}</Button>)}
        {targets.map(target => standardLayout ? <Button key={target} variant="ghost" className="device-row" aria-pressed={device.mode === "remote" && device.address === target} disabled={device.pending} onClick={() => void select("remote", target)}><span className="truncate">{device.mode === "remote" && device.address === target && <Check aria-hidden="true" />} {device.mode === "remote" && device.address === target && installationName ? installationName : target}</span><span className="device-row-hint truncate">{target}</span></Button> : <Button key={target} variant="ghost" className="justify-between" aria-pressed={device.mode === "remote" && device.address === target} disabled={device.pending} onClick={() => void select("remote", target)}><span className="truncate">{target}</span>{device.mode === "remote" && device.address === target && <Check aria-label="Selected" />}</Button>)}
        {standardLayout ? <form className="device-address" onSubmit={event => { event.preventDefault(); void select("remote", address); }}><Input aria-label="Another Couch address" value={address} onChange={event => setAddress(event.target.value)} placeholder="Another Couch address" autoComplete="url" spellCheck={false} disabled={device.pending} /><Button type="submit" variant="ghost" disabled={device.pending || !address.trim()}>Connect</Button></form> : <Button variant="outline" disabled={device.pending} onClick={() => { setAddress(""); setDialog("address"); setOpen(false); }}>Another Couch</Button>}
        <SoundControls credentials={credentials} connected={connected} open={open} installationName={installationName || label} compact={standardLayout} state={state} run={run} onClose={close} />
        {device.error && !device.error.startsWith("confirmation-required:") && <p role="alert" className="text-destructive">{device.error}</p>}
      </PopoverContent>
    </Popover>
    <Dialog open={dialog !== null} onOpenChange={value => { if (!value) close(); }}>
      <DialogContent showCloseButton={!device.pending} onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus(); }} onInteractOutside={event => { if (device.pending) event.preventDefault(); }} onEscapeKeyDown={event => { if (device.pending) event.preventDefault(); }}>
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
  return <Dialog open><DialogContent showCloseButton={false} onEscapeKeyDown={event => event.preventDefault()} onInteractOutside={event => event.preventDefault()} className="!inset-0 !m-0 !flex !h-dvh !max-h-none !w-screen !max-w-none !translate-x-0 !translate-y-0 !flex-col !justify-center !gap-0 !rounded-none !bg-black !px-[clamp(2rem,10vw,8rem)] !py-12 !text-white !shadow-none !ring-0" style={{ fontFamily: "'Inter Tight Variable', sans-serif" }}>
    <DialogHeader className="max-w-[48rem]"><DialogTitle className="text-[clamp(2.3rem,4vw,3rem)] font-semibold tracking-[-.03em]">Allow remote control?</DialogTitle><DialogDescription className="mt-3 max-w-[40rem] text-xl text-white/70">Phones and computers on this network can pair and control playback. You can change this in Settings, Connections.</DialogDescription></DialogHeader>
    {error && <Alert variant="destructive" className="mt-6 max-w-[40rem]"><AlertDescription>{error}</AlertDescription></Alert>}
    <DialogFooter className="mt-8 flex max-w-[40rem] flex-row justify-start gap-2"><Button disabled={pending} className="rounded-sm bg-white text-black hover:bg-white/85" onClick={() => void setSharing(true)}>Allow remote control</Button><Button variant="ghost" className="first-run-interactive rounded-sm text-white" disabled={pending} onClick={() => void setSharing(false)}>Keep private</Button></DialogFooter>
  </DialogContent></Dialog>;
}
