import { createContext, useContext, useEffect, useRef, useState, type PropsWithChildren } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { useMutation, useMutationState } from "@tanstack/react-query";
import { SetupQr } from "@/components/SetupQr";
import { RowOptions } from "@/components/RowMenu";
import { useSessionGate } from "@/session/session-context";
import { apiSend } from "@/api/client";
import { forgetConnection } from "@/session/connection";
import { deviceId, loadLocalDeviceName, saveLocalDeviceName, useLocalDeviceName } from "@/session/device-id";
import { defaultDeviceName } from "../../../shared/devices";
import { couchApp, type AppMode } from "@/session/native-context";
import type { Credentials } from "@/session/session";
import { TRY_AGAIN } from "@/copy";
import { Onboarding } from "./Onboarding";
import { NetworkSettings, sharingMutationKey } from "@/sections/settings/couch/NetworkSettings";
import { useSettingsScope } from "@/sections/settings/settings-scope";
import { AnotherCouchForm, ForgetCouchDialog } from "./CouchForms";
import { StatusLine } from "./StatusLine";
import { useNavigation } from "@/navigation";

export type Choice = AppMode;
type Device = Choice & { pending: boolean; error: string | null; choose: (mode: "local" | "remote", address?: string, confirm?: boolean) => Promise<boolean>; forget: (address: string) => Promise<boolean>; completeLocalSetup: () => Promise<void>; chooseAgain: () => void; setupStep: SetupStep; setSetupStep: (step: SetupStep) => void; advanced: boolean; hostHere: (advanced: boolean) => void };
// Advanced setup asks the network step instead of the share step.
type SetupStep = "name" | "share" | "network" | "join";
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
  // First run's step lives here: saving the name reconnects, which remounts the shell under it.
  const [setupStep, setSetupStep] = useState<SetupStep>("name");
  const [advanced, setAdvanced] = useState(false);
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
    chooseAgain: () => { setChoice({ ...choice, mode: null }); setSetupStep("name"); },
    setupStep, setSetupStep, advanced,
    hostHere: next => { setAdvanced(next); void device.choose("local"); },
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
// Where the app's icon lives while its window is closed (app/main.ts makes it).
const trayName = /Mac/.test(navigator.platform) ? "menu bar" : "tray";
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
  // A known Couch that needs confirmation puts its address in the field, beside Stop and switch.
  const selectRemote = async (target: string, confirmed = false) => {
    try { await device.choose("remote", target, confirmed); }
    catch (reason) { if (message(reason).startsWith("confirmation-required:")) { setAddress(target); setConfirm(message(reason).split(":")[1]!); } }
  };
  return <div className="grid w-full gap-10">
    <div className="grid justify-items-start gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button autoFocus size="lg" data-host-here disabled={device.pending} onClick={() => device.hostHere(false)}>Host on this computer</Button>
        <Button size="lg" variant="ghost" className="text-muted-foreground" disabled={device.pending} onClick={() => device.hostHere(true)}>Advanced setup</Button>
      </div>
      <p className="max-w-prose text-sm text-muted-foreground">Phones, TVs and browsers on your network join it. Closing the window keeps Couch running so they still can; quit from its icon in the {trayName}.</p>
    </div>
    <div className="grid w-full">
      {!!device.targets.length && <ul className="grid divide-y border-b">{device.targets.map(target => <li key={target} className="flex items-center gap-2 py-3">
        <span className="grid min-w-0 flex-1 gap-0.5"><span className="text-body break-words">{names[target] || hostOf(target)}</span>{names[target] && <span className="text-meta text-muted-foreground break-all">{hostOf(target)}</span>}</span>
        <Button variant="outline" disabled={device.pending} onClick={() => void selectRemote(target)}>Connect</Button>
        <Button variant="ghost" disabled={device.pending} aria-label={`Forget ${names[target] || hostOf(target)}`} onClick={() => setForgetting(target)}>Forget</Button>
      </li>)}</ul>}
      <AnotherCouchForm className="border-b-0 pt-4 @2xl:grid-cols-1 [&_[data-slot=field-label]]:text-title [&_[data-slot=field-label]]:font-medium" description="Join a Couch that runs on another computer; this one still plays. Its address is in that Couch's Settings, under Devices & network." address={address} onAddressChange={value => { setAddress(value); setConfirm(null); }} onConnect={() => void selectRemote(address)} pending={device.pending}>
        {confirm && <div className="grid w-full gap-3"><p className="text-sm text-muted-foreground">{confirmationText(confirm)}</p><div className="flex flex-wrap gap-2"><Button type="button" disabled={device.pending} onClick={() => void selectRemote(address, true)}>Stop and switch</Button><Button type="button" variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button></div></div>}
      </AnotherCouchForm>
    </div>
    <ForgetCouchDialog name={forgetting && (names[forgetting] || hostOf(forgetting))} pending={device.pending} error={device.error} onClose={() => setForgetting(null)} onForget={() => !!forgetting && device.forget(forgetting)}
      onCloseAutoFocus={event => { event.preventDefault(); document.querySelector<HTMLButtonElement>("[data-host-here]")?.focus(); }} />
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

/** Settings → This device in the app: This computer, the Couches it knows, or another Couch's address. */
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
    <SettingsSection title="Connection" description="The Couch this window shows." data-tv-local-only>
      <SettingsRow label="This computer" description="Host Couch here. Phones, browsers and other computers on your network join it.">
        {device.mode === "local" ? inUse : <Button variant="outline" disabled={device.pending} onClick={() => void select("local")}>Switch</Button>}
      </SettingsRow>
      {targets.map(target => {
        const named = nameOf(target);
        return <SettingsRow key={target} label={named || hostOf(target)} description={named ? hostOf(target) : undefined}>
          {device.mode === "remote" && device.address === target ? <>{inUse}<Button variant="ghost" aria-label={`Forget ${named || hostOf(target)}`} disabled={device.pending} onClick={() => { setAddress(target); setDialog("forget"); }}>Forget</Button></>
            : <><Button variant="outline" disabled={device.pending} onClick={() => void select("remote", target)}>Switch</Button><RowOptions title={named || hostOf(target)} disabled={device.pending} actions={[{ label: "Forget", run: () => { setAddress(target); setDialog("forget"); } }]} /></>}
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
// The app window is this Couch's Device, so its name is asked here, once. Then whether to share it on the network
// and, when shared, how phones and TVs join; Back walks the steps, then returns to the chooser. Advanced setup swaps the
// share step for Devices & network's own network rows.
export function LocalSharingPrompt({ credentials }: { credentials: Credentials | null }) {
  const device = usePlaybackDevice();
  const pending = useLocalSetupPending(credentials);
  const savedName = useLocalDeviceName();
  const { host, details, connected, remoteControlEnabled } = useSessionGate();
  const scope = useSettingsScope();
  const step = device?.setupStep, setStep = device?.setSetupStep ?? (() => {});
  const [name, setName] = useState<string | null>(null);
  const placeholder = defaultDeviceName(deviceId());
  const saveName = useMutation({
    mutationFn: () => saveLocalDeviceName(name?.trim() || savedName || placeholder),
    onSuccess: () => setStep(device?.advanced ? "network" : "share"),
  });
  const sharing = useMutation({
    mutationFn: async (enabled: boolean) => {
      await apiSend(credentials!, "/api/settings/sharing", { enabled }, "POST", 10_000);
      if (enabled) setStep("join"); else await device!.completeLocalSetup();
    },
  });
  const finish = useMutation({ mutationFn: () => device!.completeLocalSetup() });
  // Network's own Share on network save: wait for it, and trust what it saved until the devices revision catches up.
  const networkSave = useMutationState({ filters: { mutationKey: sharingMutationKey }, select: mutation => mutation.state }).at(-1);
  const shared = networkSave?.status === "success" ? networkSave.variables === true : remoteControlEnabled;
  if (!pending) return null;
  const busy = saveName.isPending || sharing.isPending || finish.isPending;
  const error = saveName.error ?? sharing.error ?? finish.error;
  const failure = error && <Alert variant="destructive"><AlertDescription>{message(error)}</AlertDescription></Alert>;
  const shown = savedName ?? placeholder;
  if (step === "name") return <Onboarding key={step} back={{ label: "Back", onClick: device!.chooseAgain, disabled: busy }} step={{ current: 1, total: 3 }} title="Name this computer" description="Phones and TVs show this name when you choose where to play." data-tv-navigation-scope>
    <form className="grid w-full gap-6" onSubmit={event => { event.preventDefault(); if (!busy) saveName.mutate(); }}>
      <Field><FieldLabel htmlFor="host-name" className="sr-only">Name</FieldLabel><Input id="host-name" autoFocus className="h-field text-title" autoComplete="off" maxLength={60} placeholder={shown} value={name ?? savedName ?? ""} onChange={event => setName(event.target.value)} disabled={busy} /></Field>
      {failure}
      <Button size="lg" className="justify-self-start" disabled={busy}>Continue</Button>
    </form>
  </Onboarding>;
  if (step === "share") return <Onboarding key={step} back={{ label: "Back", onClick: () => setStep("name"), disabled: busy }} step={{ current: 2, total: 3 }} title="Share it on your network?" description={<>
    <p>Phones, TVs, browsers and other computers on your network can then pair with {shown}, play on it and join as speakers. Only devices you pair get in.</p>
    <p>Not sharing keeps Couch to this computer. Change it later in Settings, under Devices & network.</p>
  </>} data-tv-navigation-scope>
    {failure}
    <div className="flex flex-wrap gap-2"><Button autoFocus size="lg" disabled={busy} onClick={() => sharing.mutate(true)}>Share</Button><Button size="lg" variant="ghost" disabled={busy} onClick={() => sharing.mutate(false)}>Keep it to this computer</Button></div>
  </Onboarding>;
  if (step === "network") return <Onboarding key={step} back={{ label: "Back", onClick: () => setStep("name"), disabled: busy }} step={{ current: 2, total: 3 }} title="How do devices connect?"
    description={<p>Change any of these later in Settings, under Devices & network.</p>} wide data-tv-navigation-scope>
    {credentials && <div className="grid gap-10"><NetworkSettings credentials={credentials} connected={connected} urls={host?.urls ?? [credentials.origin]} remoteControlEnabled={remoteControlEnabled}
      managedLan={details?.lanError !== undefined} lanError={details?.lanError} device={scope.device} couch={scope.couch} host administrator /></div>}
    {failure}
    <Button size="lg" className="justify-self-start" disabled={busy || networkSave?.status === "pending"} onClick={() => shared ? setStep("join") : finish.mutate()}>{shared ? "Continue" : "Done"}</Button>
  </Onboarding>;
  // The window's own loopback origin stays first until the LAN address arrives over IPC.
  const url = host?.urls.find(value => new URL(value).hostname !== "127.0.0.1");
  return <Onboarding key={step} back={{ label: "Back", onClick: () => setStep(device?.advanced ? "network" : "share"), disabled: busy }} step={{ current: 3, total: 3 }} title="Pair your phone or TV" object={url && credentials ? <SetupQr url={url} credentials={credentials} /> : undefined} description={url ? <>
    <p>On a phone, scan the code. On a TV or another computer, open <span className="whitespace-nowrap text-foreground">{url}</span> and enter the code.</p>
    <p>The browser will warn that the connection isn't private, because Couch makes its own certificate. Continue only for this address.</p>
  </> : <p role="status">Looking for this computer's network address…</p>} data-tv-navigation-scope>
    {failure}
    <div className="grid justify-items-start gap-3">
      <Button autoFocus size="lg" disabled={busy} onClick={() => finish.mutate()}>Done</Button>
      <p className="text-meta text-muted-foreground">Pair more devices later in Settings, under Devices & network.</p>
    </div>
  </Onboarding>;
}
