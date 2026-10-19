import { createContext, useContext, useEffect, useRef, useState, type PropsWithChildren } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { useMutation } from "@tanstack/react-query";
import { apiSend } from "@/api/client";
import { forgetConnection } from "@/session/connection";
import { deviceId, loadLocalDeviceName, saveLocalDeviceName, useLocalDeviceName } from "@/session/device-id";
import { defaultDeviceName } from "../../../shared/devices";
import { couchApp, type AppMode } from "@/session/native-context";
import type { Credentials } from "@/session/session";
import { ChevronRight } from "lucide-react";
import { TRY_AGAIN } from "@/copy";
import { Onboarding } from "./Onboarding";
import { AnotherCouchForm, ForgetCouchDialog } from "./CouchForms";
import { StatusLine } from "./StatusLine";
import { useNavigation } from "@/navigation";

export type Choice = AppMode;
type Device = Choice & { pending: boolean; error: string | null; choose: (mode: "local" | "remote", address?: string, confirm?: boolean) => Promise<boolean>; forget: (address: string) => Promise<boolean>; completeLocalSetup: () => Promise<void>; chooseAgain: () => void };
const Context = createContext<Device | null>(null);
const message = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);
export const usePlaybackDevice = () => useContext(Context);

// Tells the app window that a usable screen committed: the mode chooser, or the shell
// once every startup gate passed (`usable`). Their loading, errors and failed renders
// never do (app/renderer-status.ts).
export function useShellReady(usable = true) {
  useEffect(() => { if (usable) void couchApp?.shellReady?.().catch(() => {}); }, [usable]);
}

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
    // The name loads beside the mode; a couch.sqlite failure must not keep the app from starting.
    void loadLocalDeviceName().catch(() => {});
    void couchApp.mode().then(value => { if (!disposed) setChoice(value); })
      .catch(reason => { if (!disposed) setError(message(reason)); })
      .finally(() => { if (!disposed) setPending(false); });
    return () => { disposed = true; };
  }, []);
  if (!couchApp) return children;
  const app = couchApp;
  if (!choice) return <main className="drag-region flex min-h-dvh flex-col bg-background">
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
    // Back from first run's name step shows the chooser again; Main keeps This computer until another choice.
    chooseAgain: () => setChoice({ ...choice, mode: null }),
  };
  return <Context.Provider value={device}>
    {choice.mode ? children : <main className="drag-region flex min-h-dvh flex-col bg-background" data-tv-navigation-scope>
      <Onboarding title="Where is your Couch?"><DeviceForm /></Onboarding>
    </main>}
  </Context.Provider>;
}

const hostOf = (address: string) => address.replace(/^https?:\/\//i, "").replace(/\/$/, "");
// Native choices remember only addresses, so each Couch's name is kept here once seen.
const namesKey = "couch.target-names";
const targetNames = (): Record<string, string> => { try { return Object.fromEntries(Object.entries(JSON.parse(localStorage.getItem(namesKey) || "{}") ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string")); } catch { return {}; } };
const confirmationText = (reason: string) => reason === "playback,sharing" ? "Playback here stops and other devices disconnect." : reason === "playback" ? "Playback here stops." : "Other devices can't reach this Couch until you switch back.";

function DeviceForm() {
  useShellReady();
  const device = usePlaybackDevice()!;
  const [address, setAddress] = useState(device.address ?? "");
  const [confirm, setConfirm] = useState<string | null>(null);
  const [forgetting, setForgetting] = useState<string | null>(null);
  const [names] = useState(targetNames);
  // The shell isn't mounted before a mode is chosen, so the chooser brings the TV remote's arrow keys itself (#644 ticket 12).
  useNavigation(() => {});
  const selectRemote = async (confirmed = false) => {
    try { await device.choose("remote", address, confirmed); }
    catch (reason) { if (message(reason).startsWith("confirmation-required:")) setConfirm(message(reason).split(":")[1]!); }
  };
  return <div className="grid gap-6">
    <div className="-mx-3 border-t">
      <Button autoFocus variant="ghost" aria-label="This computer" className="h-auto w-full justify-between gap-4 rounded-none border-0 border-b px-3 py-4 text-left font-normal whitespace-normal" disabled={device.pending} onClick={() => void device.choose("local")}>
        <span className="grid gap-0.5"><span className="text-base font-medium">This computer</span><span className="text-sm text-muted-foreground">Host Couch here. Phones, browsers and other computers on your network join it.</span></span>
        <ChevronRight aria-hidden="true" />
      </Button>
      {device.targets.map(target => <div key={target} className="flex items-center border-b"><Button variant="ghost" className="h-auto w-full justify-between gap-4 rounded-none border-0 px-3 py-4 text-left font-normal whitespace-normal" disabled={device.pending} onClick={() => void device.choose("remote", target)}>
        <span className="grid gap-0.5"><span className="text-base font-medium">{names[target] || hostOf(target)}</span>{names[target] && <span className="text-sm text-muted-foreground">{hostOf(target)}</span>}</span>
        <ChevronRight aria-hidden="true" />
      </Button><Button variant="ghost" size="sm" disabled={device.pending} aria-label={`Forget ${names[target] || hostOf(target)}`} onClick={() => setForgetting(target)}>Forget</Button></div>)}
      <AnotherCouchForm className="px-3 py-4 md:grid-cols-1 [&_[data-slot=field-label]]:font-medium" description="Join a Couch that runs on another computer. This computer still plays." address={address} onAddressChange={value => { setAddress(value); setConfirm(null); }} onConnect={() => void selectRemote()} pending={device.pending}>
        {confirm && <div className="grid w-full gap-3"><p className="text-sm text-muted-foreground">{confirmationText(confirm)}</p><div className="flex flex-wrap gap-2"><Button type="button" disabled={device.pending} onClick={() => void selectRemote(true)}>Stop and switch</Button><Button type="button" variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button></div></div>}
      </AnotherCouchForm>
    </div>
    <ForgetCouchDialog name={forgetting && (names[forgetting] || hostOf(forgetting))} pending={device.pending} error={device.error} onClose={() => setForgetting(null)} onForget={() => !!forgetting && device.forget(forgetting)}
      onCloseAutoFocus={event => { event.preventDefault(); document.querySelector<HTMLButtonElement>('[aria-label="This computer"]')?.focus(); }} />
    {device.error && !device.error.startsWith("confirmation-required:") && <Alert variant="destructive"><AlertDescription>{device.error}</AlertDescription></Alert>}
  </div>;
}

// Native choices remember only addresses, so the shell records each Couch's name once it is seen.
export function useRememberCouchName(installationName?: string) {
  const device = usePlaybackDevice();
  useEffect(() => {
    if (device?.mode !== "remote" || !device.address || !installationName) return;
    const names = targetNames();
    if (names[device.address] === installationName) return;
    try { localStorage.setItem(namesKey, JSON.stringify({ ...names, [device.address]: installationName })); } catch { /* Names are a convenience; addresses still work. */ }
  }, [device?.mode, device?.address, installationName]);
}

/** Settings → Couch connection in the app: This computer, the Couches it knows, or another Couch's address. */
export function AppCouchChoice({ installationName }: { installationName?: string }) {
  const device = usePlaybackDevice();
  const [dialog, setDialog] = useState<"confirmation" | "forget" | null>(null);
  const [address, setAddress] = useState("");
  const [warning, setWarning] = useState("");
  const [names, setNames] = useState(targetNames);
  if (!device) return null;
  const close = () => setDialog(null);
  // A known Couch that can't be reached puts its address in the field, beside the error.
  const select = async (mode: "local" | "remote", target?: string, confirmed = false) => {
    try {
      if (await device.choose(mode, target, confirmed)) close();
      else if (target) { setAddress(target); close(); }
    } catch (reason) {
      if (message(reason).startsWith("confirmation-required:")) { setAddress(target!); setWarning(message(reason).split(":")[1]!); setDialog("confirmation"); }
    }
  };
  const failure = device.error && !device.error.startsWith("confirmation-required:") ? device.error : null;
  const nameOf = (target: string) => device.mode === "remote" && device.address === target && installationName || names[target];
  const targets = [...new Set([...device.targets, ...(device.address ? [device.address] : [])])];
  const pendingGuard = (event: Event) => { if (device.pending) event.preventDefault(); };
  const inUse = <span className="text-sm text-muted-foreground">In use</span>;
  return <>
    <SettingsSection title="Couch" description="The Couch this window shows." data-tv-local-only>
      <SettingsRow label="This computer" description="Host Couch here. Phones, browsers and other computers on your network join it.">
        {device.mode === "local" ? inUse : <Button variant="outline" disabled={device.pending} onClick={() => void select("local")}>Switch</Button>}
      </SettingsRow>
      {targets.map(target => {
        const named = nameOf(target);
        return <SettingsRow key={target} label={named || hostOf(target)} description={named ? hostOf(target) : undefined}>
          {device.mode === "remote" && device.address === target ? inUse : <Button variant="outline" disabled={device.pending} onClick={() => void select("remote", target)}>Switch</Button>}
          <Button variant="ghost" aria-label={`Forget ${named || hostOf(target)}`} disabled={device.pending} onClick={() => { setAddress(target); setDialog("forget"); }}>Forget</Button>
        </SettingsRow>;
      })}
      <AnotherCouchForm description="Join a Couch that runs on another computer. This computer still plays." address={address} onAddressChange={setAddress} onConnect={() => void select("remote", address)} pending={device.pending} />
      {failure && dialog !== "forget" && <Alert variant="destructive"><AlertDescription>{failure}</AlertDescription></Alert>}
    </SettingsSection>
    <AlertDialog open={dialog === "confirmation"} onOpenChange={value => { if (!value) close(); }}>
      <AlertDialogContent data-tv-local-only onEscapeKeyDown={pendingGuard}>
        <AlertDialogHeader><AlertDialogTitle>Switch to {hostOf(address)}?</AlertDialogTitle><AlertDialogDescription>{confirmationText(warning)}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel disabled={device.pending}>Cancel</AlertDialogCancel><AlertDialogAction onClick={event => { event.preventDefault(); void select("remote", address, true); }} disabled={device.pending}>Stop and switch</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <ForgetCouchDialog name={dialog === "forget" ? nameOf(address) || hostOf(address) : null} pending={device.pending} error={failure} onClose={close} onForget={async () => {
      const done = await device.forget(address);
      if (done) { setNames(targetNames()); setAddress(""); }
      return done;
    }} />
  </>;
}

/** A new local setup asks for this computer's name and whether to share it before anything else. */
export function useLocalSetupPending(credentials: Credentials | null) {
  const device = usePlaybackDevice();
  return !!credentials && device?.mode === "local" && !device.localSetupComplete;
}

// The server bumps the devices revision, which refreshes remoteControlEnabled.
// The app window is this Couch's Device, so its name is asked here, once.
export function LocalSharingPrompt({ credentials }: { credentials: Credentials | null }) {
  const device = usePlaybackDevice();
  const pending = useLocalSetupPending(credentials);
  const savedName = useLocalDeviceName();
  const [name, setName] = useState("");
  const sharing = useMutation({
    mutationFn: async (enabled: boolean) => {
      if (!savedName) await saveLocalDeviceName(name.trim() || defaultDeviceName(deviceId()));
      await apiSend(credentials!, "/api/settings/sharing", { enabled }, "POST", 10_000);
      await device!.completeLocalSetup();
    },
  });
  if (!pending) return null;
  const setSharing = (enabled: boolean) => { if (!sharing.isPending) sharing.mutate(enabled); };
  // Naming comes first: it is the one thing every other Device will show (#644 ticket 12).
  return <Onboarding back={{ label: "Back", onClick: device!.chooseAgain }} title={savedName ? "Share this computer?" : "Name this computer"} description={savedName ? `${savedName} uses the same name with every Couch.` : "Every device on your network shows this name. Leave it empty to keep the one shown."} data-tv-navigation-scope>
    {!savedName && <Field><FieldLabel htmlFor="host-name">Name</FieldLabel><Input id="host-name" autoComplete="off" maxLength={60} placeholder={defaultDeviceName(deviceId())} value={name} onChange={event => setName(event.target.value)} disabled={sharing.isPending} /></Field>}
    <div className="grid gap-0.5">{!savedName && <p className="text-base font-medium">Share it on your network?</p>}<p className="text-sm text-muted-foreground">Phones, browsers and other computers on your network can pair, play and join as speakers. Change it later in Settings → Network.</p></div>
    {sharing.error && <Alert variant="destructive"><AlertDescription>{message(sharing.error)}</AlertDescription></Alert>}
    <div className="flex flex-wrap gap-2"><Button autoFocus disabled={sharing.isPending} onClick={() => setSharing(true)}>Share</Button><Button variant="ghost" disabled={sharing.isPending} onClick={() => setSharing(false)}>Not now</Button></div>
  </Onboarding>;
}
