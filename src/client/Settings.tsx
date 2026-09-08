import { StartupSettings } from "./StartupSettings";
import { RestartSettings } from "./RestartSettings";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronRight, RefreshCw, Settings2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ConnectionDetails, Controller, ControllerIdentity } from "../shared/controllers";
import type { Action, ConnectionInfo, PlaybackPreferences as Preferences } from "../shared/protocol";
import type { WatchingProfile } from "../shared/library";
import { SettingsSources } from "./SettingsSources";
import { SetupQr } from "./SetupQr";
import { QualitySelect } from "./QualitySelect";
import type { useVideoQualityPreference } from "./video-quality";
import { PlaybackPreferences } from "./PlaybackPreferences";
import { AppearanceSettings } from "./AppearanceSettings";
import type { TvAppearance } from "../shared/appearance";
import { PairedRemotes } from "./PairedRemotes";
import { UpdatesSettings } from "./UpdatesSettings";
import { BluetoothSettings } from "./BluetoothSettings";
import { SoundSettings } from "./SoundSettings";
import { DisplaySettings } from "./DisplaySettings";
import { AdvancedSettings } from "./AdvancedSettings";
import { knownConnection } from "./connection";
import { readUpdateRequest } from "./update-request";
import type { SetupStep } from "../shared/setup";
import { SetupProgress } from "./SetupProgress";

type ClaimCode = { code: string; expiresAt: number };
const settingsGroups = [
  { id: "profile", title: "Watching profile", description: "Saved audio, subtitle and playback defaults", section: "playback" },
  { id: "device", title: "This device", description: "Appearance, connection and online-video quality", section: "appearance" },
  { id: "tv", title: "TV & sources", description: "Sources, shared TV settings and administrator access", section: "general" },
];
const settingsGroup = (section: string) => section === "playback" ? "profile" : ["appearance", "connection", "remote"].includes(section) ? "device" : "tv";
type Props = {
  videoQualityPreference: ReturnType<typeof useVideoQualityPreference>;
  credentials: { origin: string; token: string } | null;
  connected: boolean;
  status: string;
  identity: ControllerIdentity | null;
  details: ConnectionDetails | null;
  pairingRequired: boolean;
  reachable: boolean;
  playerStatus?: string;
  host: ConnectionInfo | null;
  administratorClaimed: boolean;
  name: string;
  version: number;
  appearance?: TvAppearance;
  onReconnect: () => void;
  onPairAgain: () => void;
  profile?: WatchingProfile;
  preferences?: Preferences;
  onCommand: (action: Action) => Promise<boolean>;
  initialOpen?: boolean;
  inline?: boolean;
  active?: boolean;
  onOpenRequest?: () => void;
  setupStep?: SetupStep;
  sourcesRequest?: number;
  jellyfinVersion: number;
  radioVersion: number;
  libraryVersion: number;
};

export function Settings({ videoQualityPreference, credentials, connected, status, identity, details, pairingRequired, reachable, playerStatus, host, administratorClaimed, name, version, appearance, onReconnect, onPairAgain, profile, preferences, onCommand, initialOpen = false, inline = false, active = true, onOpenRequest, setupStep, sourcesRequest = 0, jellyfinVersion, radioVersion, libraryVersion }: Props) {
  const [requestedOpen, setOpen] = useState(initialOpen);
  const setup = !!setupStep && setupStep !== "complete";
  const page = inline && !!credentials && !pairingRequired && !setup;
  const open = setup || (page ? active : requestedOpen);
  const [selectedSection, setSection] = useState("");
  const requestOpen = useRef(onOpenRequest);
  requestOpen.current = onOpenRequest;
  const section = setup ? !host && identity?.authority === "administrator" ? setupStep : "general" : selectedSection;
  const group = settingsGroups.find(group => group.id === settingsGroup(section))!;
  const sectionNavigation = useRef<HTMLDivElement | null>(null);
  const focusSection = useRef(false);
  useEffect(() => {
    if (open && focusSection.current && section && !setup) {
      sectionNavigation.current?.querySelector<HTMLElement>('[role="tab"][data-state="active"]')?.focus();
      focusSection.current = false;
    }
  }, [section, setup, open]);
  const previousStep = useRef(setupStep);
  useEffect(() => {
    if (previousStep.current && previousStep.current !== "complete" && setupStep === "complete") setOpen(false);
    previousStep.current = setupStep;
  }, [setupStep]);
  useEffect(() => { if (sourcesRequest) { setSection("sources"); setOpen(true); setError(null); setNotice(null); requestOpen.current?.(); } }, [sourcesRequest]);
  const [devices, setDevices] = useState<Controller[] | null>(null);
  const [forgetting, setForgetting] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const [savedName, setSavedName] = useState(name);
  const [code, setCode] = useState("");
  const [claimCode, setClaimCode] = useState<ClaimCode | null>(null);
  const [now, setNow] = useState(Date.now());
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const mutation = useRef<AbortController | null>(null);
  const nameInput = useRef<HTMLInputElement | null>(null);
  const origin = credentials?.origin;
  const token = credentials?.token;
  const administrator = !host && identity?.authority === "administrator";
  useEffect(() => {
    if (!administrator && ["bluetooth", "sound", "display", "advanced", "remotes"].includes(selectedSection)) {
      focusSection.current = true;
      setSection("general");
    }
  }, [administrator, selectedSection]);
  useEffect(() => { if (origin && administrator && readUpdateRequest(origin)) { setSection("updates"); setOpen(true); requestOpen.current?.(); } }, [origin, administrator]);
  const canWrite = connected && !loading && !pending;
  const urls = host?.urls ?? details?.urls ?? [];
  const setupUrl = urls[0];
  const lastAdministrator = connected && administrator && (devices === null || devices.filter(device => device.role === "administrator").length <= 1);

  useEffect(() => { setSavedName(name); setDraftName(name); }, [name]);
  useEffect(() => { setDevices(null); setForgetting(false); }, [origin, token, identity?.authority]);
  useEffect(() => {
    if (open && administrator && !loading && notice === "This remote is now the administrator.") nameInput.current?.focus();
  }, [open, administrator, loading, notice]);

  useEffect(() => {
    setClaimCode(null);
    if (!open || !connected || !origin || !token) { setLoading(false); return; }
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]);
    const get = async <T,>(path: string): Promise<T> => {
      const response = await fetch(`${origin}${path}`, { headers: { Authorization: `Bearer ${token}` }, signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load settings.");
      return result;
    };
    setLoading(true);
    setError(null);
    void get<{ name: string }>("/api/settings").then(async settings => {
      if (controller.signal.aborted) return;
      setSavedName(settings.name);
      setDraftName(settings.name);
      if (identity?.authority === "administrator") {
        const result = await get<{ controllers: Controller[] }>("/api/controllers");
        if (!controller.signal.aborted) setDevices(result.controllers);
      }
      if (host && !administratorClaimed && identity?.authority === "host" && identity.claimAvailable) {
        const nextCode = await get<ClaimCode>("/api/controllers/claim-code");
        if (!controller.signal.aborted) { setClaimCode(nextCode); setNow(Date.now()); }
      }
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load settings.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, connected, origin, token, host, administratorClaimed, identity?.authority, identity?.claimAvailable, version, refresh]);

  useEffect(() => {
    if (!open || !claimCode) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [open, claimCode]);

  useEffect(() => {
    setPending(false);
    setCode("");
    return () => mutation.current?.abort();
  }, [open, connected, origin, token]);

  const update = async (event: { preventDefault(): void }, path: string, body: unknown, success: string, method: "POST" | "DELETE" = "POST") => {
    event.preventDefault();
    if (!credentials || !canWrite) return false;
    const controller = new AbortController();
    mutation.current = controller;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`${credentials.origin}${path}`, {
        method, headers: { Authorization: `Bearer ${credentials.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save settings.");
      if (!controller.signal.aborted) { setCode(""); setNotice(success); setRefresh(value => value + 1); }
      return !controller.signal.aborted;
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not save settings.");
      return false;
    } finally {
      if (!controller.signal.aborted) setPending(false);
      if (mutation.current === controller) mutation.current = null;
    }
  };

  const pairAgain = () => { setOpen(false); onPairAgain(); };
  const addresses = <div className="flex min-w-0 flex-col items-start gap-3 sm:flex-row">
    {setupUrl && <SetupQr url={setupUrl} />}
    <div className="min-w-0 space-y-1">
      <p className="font-medium">TV addresses on your network</p>
      {urls.map(url => <a key={url} href={url} target="_blank" rel="noreferrer" className="block min-h-11 content-center break-all text-muted-foreground underline underline-offset-4">{url}</a>)}
      {!urls.length && <p className="text-muted-foreground">No advertised address is known. Check the TV's network connection.</p>}
    </div>
  </div>;

  const content = <>
      {setup && <SetupProgress step={setupStep!} host={!!host} administrator={administrator} administratorClaimed={administratorClaimed} />}
      {!setup && !section && <div className="grid gap-3" aria-label="Settings sections">
        {settingsGroups.map(group => <Button key={group.id} variant="outline" className="h-auto min-h-16 justify-between gap-3 whitespace-normal px-4 py-3 text-left" data-settings-group={group.id} onClick={() => { focusSection.current = true; setSection(group.section); }}><span><span className="block font-medium">{group.title}</span><span className="block text-sm font-normal text-muted-foreground">{group.description}</span></span><ChevronRight aria-hidden="true" /></Button>)}
      </div>}
      {!setup && section && <div className="space-y-3"><Button variant="ghost" className="min-h-11" data-back onClick={() => { const id = group.id; setSection(""); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-settings-group="${id}"]`)?.focus()); }}><ArrowLeft aria-hidden="true" />All settings</Button><h3 className="font-medium">{group.title}</h3></div>}
      <Tabs value={section} onValueChange={setSection} activationMode={host ? "manual" : "automatic"} className="min-w-0 gap-4">
        {!setup && section && <TabsList ref={sectionNavigation} className="grid h-auto w-full grid-cols-2 group-data-horizontal/tabs:h-auto" aria-label="Settings sections">
          {group.id === "tv" && <>
            <TabsTrigger value="general" className="min-h-11">General</TabsTrigger>
            <TabsTrigger value="sources" className="min-h-11" data-tv-local-only={host ? "" : undefined}>Sources</TabsTrigger>
            {administrator && <TabsTrigger value="bluetooth" className="min-h-11">Bluetooth</TabsTrigger>}
            {administrator && <TabsTrigger value="sound" className="min-h-11">Sound</TabsTrigger>}
            {administrator && <TabsTrigger value="display" className="min-h-11">Display</TabsTrigger>}
            {!host && <TabsTrigger value="tv-appearance" className="min-h-11">TV appearance</TabsTrigger>}
            {administrator && <TabsTrigger value="remotes" className="min-h-11">Paired remotes</TabsTrigger>}
            <TabsTrigger value="updates" className="min-h-11">Updates</TabsTrigger>
            {administrator && <TabsTrigger value="advanced" className="min-h-11">Advanced</TabsTrigger>}
          </>}
          {group.id === "profile" && <TabsTrigger value="playback" className="min-h-11">Playback</TabsTrigger>}
          {group.id === "device" && <>
            <TabsTrigger value="appearance" className="min-h-11">Appearance</TabsTrigger>
            <TabsTrigger value="connection" className="min-h-11">Connection</TabsTrigger>
            <TabsTrigger value="remote" className="min-h-11">Video quality</TabsTrigger>
          </>}
        </TabsList>}
        {administrator && credentials && <TabsContent value="updates" className="min-w-0">{open && section === "updates" && <UpdatesSettings key={`${credentials.origin}:${identity.controller?.id}`} credentials={credentials} connected={connected} />}</TabsContent>}
        {!administrator && <TabsContent value="updates" className="min-w-0 space-y-3">
          <p>Open Settings &gt; TV &amp; sources &gt; Updates on an administrator remote to check for updates and install a signed release on this TV.</p>
          <p className="text-muted-foreground">Pairing alone does not grant administrator access. Use General to claim administration when available, or ask an existing administrator to approve this remote in Paired remotes.</p>
          <Button variant="outline" className="min-h-11" onClick={() => { focusSection.current = true; setSection("connection"); }}>Open Connection</Button>
        </TabsContent>}
        {administrator && credentials && <TabsContent value="advanced" className="min-w-0">{open && section === "advanced" && <AdvancedSettings key={`${credentials.origin}:${identity.controller?.id}`} credentials={credentials} connected={connected} />}</TabsContent>}
        {administrator && credentials && <TabsContent value="bluetooth" className="min-w-0">{open && section === "bluetooth" && <BluetoothSettings credentials={credentials} connected={connected} />}</TabsContent>}
        {administrator && credentials && <TabsContent value="sound" className="min-w-0">{open && section === "sound" && <SoundSettings credentials={credentials} connected={connected} />}</TabsContent>}
        {administrator && credentials && <TabsContent value="display" className="min-w-0">{open && section === "display" && <DisplaySettings credentials={credentials} connected={connected} />}</TabsContent>}
        <TabsContent value="appearance" className="min-w-0"><AppearanceSettings scope="device" native={!!host} credentials={credentials} connected={connected} administrator={administrator || !!host && identity?.authority === "host"} appearance={appearance} /></TabsContent>
        {!host && <TabsContent value="tv-appearance" className="min-w-0"><AppearanceSettings scope="tv" native={false} credentials={credentials} connected={connected} administrator={administrator} appearance={appearance} /></TabsContent>}
        {administrator && devices && <TabsContent value="remotes" className="min-w-0"><PairedRemotes devices={devices} currentId={identity.controller!.id} disabled={!canWrite} update={update} /></TabsContent>}
        <TabsContent value="general" className={`min-w-0 space-y-4 ${host ? "text-base" : ""}`}>
          {administrator ? <form className="space-y-3" onSubmit={event => void update(event, "/api/settings", { name: draftName.trim() }, "TV name saved.")}>
            <div className="space-y-2"><Label htmlFor="tv-name">TV name</Label><Input ref={nameInput} id="tv-name" className="min-h-11" value={draftName} onChange={event => setDraftName(event.target.value)} maxLength={60} required disabled={!canWrite} aria-describedby="tv-name-help" /></div>
            <p id="tv-name-help" className="text-muted-foreground">Applies now to the TV and every connected remote.</p>
            <Button type="submit" className="min-h-11" disabled={!canWrite || !draftName.trim() || draftName.trim() === savedName}>{pending ? "Saving…" : "Save name"}</Button>
          </form> : <div className="space-y-1">
            <p className="font-medium">TV name</p><p className="break-words" data-settings-tv-name>{savedName || "Couch"}</p>
            <p className="text-muted-foreground">{host ? "Use an administrator remote to change this TV's settings." : credentials ? "An administrator can change this TV's name." : "Pair this browser to control the TV."}</p>
          </div>}
          {administrator && credentials && open && section === "general" && <StartupSettings key={`startup:${credentials.origin}:${credentials.token}`} credentials={credentials} connected={connected} />}
          <div className="flex flex-wrap gap-2"><Button variant="outline" className="min-h-11" onClick={() => { focusSection.current = true; setSection("connection"); }}>Connection</Button>{administrator && <Button variant="outline" className="min-h-11" onClick={() => { focusSection.current = true; setSection("remotes"); }}>Manage remotes</Button>}{administrator && <Button variant="outline" className="min-h-11" onClick={() => { focusSection.current = true; setSection("advanced"); }}>Effective overrides</Button>}</div>
          {administrator && credentials && <RestartSettings key={`${credentials.origin}:${credentials.token}`} credentials={credentials} connected={connected} />}
          {host && !administratorClaimed && identity?.claimAvailable && <>
            <Separator />
            <div className="space-y-3">
              <p className="font-medium">Set up your administrator remote</p>
              {addresses}
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="font-medium">Controller pairing code</p>
                <p className="my-2 font-mono text-2xl tracking-wider" data-pairing-code>{host.pairingCode}</p>
                <p className="text-muted-foreground">Enter this code to pair your phone.</p>
              </div>
              <p className="text-muted-foreground">After pairing, open Settings on your phone and enter this administrator code.</p>
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="font-medium">Administrator code</p>
                {connected && claimCode && claimCode.expiresAt > now ? <>
                  <p className="my-2 break-all font-mono text-2xl tabular-nums tracking-wider" data-administrator-code>{claimCode.code}</p>
                  <p className="text-muted-foreground">Expires at {new Date(claimCode.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. Use once to claim administration.</p>
                </> : <p className="my-2 text-muted-foreground">{loading ? "Loading code…" : !connected ? "Reconnect to show an administrator code." : claimCode ? "The code has expired." : "No administrator code is available."}</p>}
                {connected && !loading && (!claimCode || claimCode.expiresAt <= now) && <Button variant="outline" className="min-h-11" onClick={() => setRefresh(value => value + 1)}>Get new code</Button>}
              </div>
            </div>
          </>}
          {!host && identity?.authority === "controller" && identity.claimAvailable && <>
            <Separator />
            <form className="space-y-3" onSubmit={event => void update(event, "/api/controllers/claim", { code: code.trim() }, "This remote is now the administrator.")}>
              <div className="space-y-2"><Label htmlFor="administrator-code">Administrator code</Label><Input id="administrator-code" className="min-h-11 font-mono" value={code} onChange={event => setCode(event.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={256} required disabled={!canWrite} aria-describedby="administrator-code-help" /></div>
              <p id="administrator-code-help" className="text-muted-foreground">Enter the code in Settings on the TV, or your recovery secret. This is different from the pairing code.</p>
              <Button type="submit" className="min-h-11" disabled={!canWrite || !code.trim()}>{pending ? "Claiming…" : "Claim administrator"}</Button>
            </form>
          </>}
        </TabsContent>
        <TabsContent value="playback" className="min-w-0">
          {profile && preferences ? <PlaybackPreferences key={profile.id} profile={profile} preferences={preferences} connected={connected} onCommand={onCommand} /> : <p className="text-muted-foreground">Connect to the TV to see the watching profile's saved defaults.</p>}
        </TabsContent>
        <TabsContent value="remote" className={`min-w-0 space-y-4 ${host ? "text-base" : ""}`}>
          <QualitySelect id="default-video-quality" label="Default online-video quality" value={videoQualityPreference.quality} onChange={videoQualityPreference.save} />
          <p className="text-muted-foreground">Saved in this browser for new online videos. You can choose another quality when adding a video.</p>
          <p className="text-muted-foreground">Existing queue entries, other remotes and the TV's display resolution stay unchanged.</p>
          {videoQualityPreference.error && <Alert variant="destructive"><AlertDescription>{videoQualityPreference.error}</AlertDescription></Alert>}
        </TabsContent>
        <TabsContent value="sources" className={`min-w-0 space-y-4 ${host ? "text-base" : ""}`} data-tv-local-only={host ? "" : undefined}>
          <SettingsSources setupOnly={setup} credentials={credentials} connected={connected} canManage={!!host || administrator} version={jellyfinVersion} radioVersion={radioVersion} libraryVersion={libraryVersion} />
        </TabsContent>
        <TabsContent value="connection" className={`min-w-0 space-y-4 ${host ? "text-base" : ""}`}>
          <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-x-4 gap-y-3">
            <dt className="text-muted-foreground">Status</dt><dd className="min-w-0 break-words">{status}</dd>
            <dt className="text-muted-foreground">TV name</dt><dd className="min-w-0 break-words">{savedName}</dd>
            <dt className="text-muted-foreground">TV address</dt><dd className="min-w-0 break-all">{origin || knownConnection()?.origin || location.origin}</dd>
            <dt className="text-muted-foreground">Server</dt><dd>{connected ? "Connected" : reachable ? "Reachable" : status}</dd>
            <dt className="text-muted-foreground">Player</dt><dd>{!reachable ? "Unknown while disconnected" : !playerStatus ? "Unknown" : playerStatus === "unavailable" ? "Unavailable" : "Available"}</dd>
            {identity?.controller && <><dt className="text-muted-foreground">This remote</dt><dd className="min-w-0 space-y-1"><p className="break-words">{identity.controller.name}</p><Badge variant="secondary">{identity.authority === "administrator" ? "Administrator" : "Controller"}</Badge></dd></>}
          </dl>
          {pairingRequired && credentials && <p role="alert">The TV rejected this browser's credential. Pair again to restore access.</p>}
          {status === "Connection rejected" && <p role="alert">The TV rejected this browser's address. Open one of its advertised LAN addresses.</p>}
          <Separator />{addresses}
          {host && <div className="rounded-lg border bg-muted/30 p-3"><p className="font-medium">Controller pairing code</p><p className="my-2 font-mono text-2xl tracking-wider" data-pairing-code>{host.pairingCode}</p><p className="text-muted-foreground">Connects a remote for browsing and playback.</p></div>}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="min-h-11" onClick={onReconnect}><RefreshCw aria-hidden="true" />Reconnect</Button>
            {!host && <Button variant="outline" className="min-h-11" disabled={lastAdministrator && !pairingRequired} onClick={() => credentials && !pairingRequired ? setForgetting(true) : pairAgain()}>{credentials ? "Pair again" : "Pair with TV"}</Button>}
          </div>
          {!host && <p className="text-muted-foreground">Reconnect keeps this browser's credential and retries this TV, including its known LAN addresses. Pair again forgets only this browser's credential. It does not revoke access on the TV.</p>}
          {lastAdministrator && !pairingRequired && <p className="text-muted-foreground">Approve another administrator before forgetting this browser. Lost access requires local or SSH recovery on the TV computer.</p>}
          {forgetting && <div role="alert" className="space-y-3 rounded-lg border p-3"><p>Forget this browser's pairing? You will need the code shown on the TV to connect again.{identity?.authority === "administrator" ? " Administration will require another administrator or local/SSH recovery." : ""}</p><div className="flex flex-wrap gap-2"><Button className="min-h-11" variant="outline" onClick={() => setForgetting(false)}>Cancel</Button><Button className="min-h-11" disabled={lastAdministrator && !pairingRequired} onClick={pairAgain}>Forget this browser</Button></div></div>}
        </TabsContent>
      </Tabs>
      {setup && administrator && <Button className="min-h-11" disabled={!canWrite || section === "general" && draftName.trim() !== savedName} onClick={event => void update(event, "/api/settings/setup", { step: setupStep }, "Setup progress saved.")}>
        {pending ? "Saving…" : section === "general" ? "Continue to screen" : section === "display" ? "I can see Couch on the right screen" : section === "sound" ? "I heard the test sound" : "Finish setup"}
      </Button>}
      {loading && <p role="status" className="text-muted-foreground">Loading settings…</p>}
      {!connected && <p role="status" className="text-muted-foreground">{credentials ? "Connect to the TV to change its settings." : "This browser is not paired."}</p>}
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {notice && <p role="status">{notice}</p>}
  </>;

  if (page) return <section className="settings-page space-y-6" aria-label="Settings" hidden={!active} data-tv-local-only={host && section === "sources" ? "" : undefined}>
    {active && <><header><h1 className="text-3xl font-semibold">Settings</h1><p className="mt-2 text-muted-foreground">{savedName || "Couch"}</p></header>{content}</>}
  </section>;

  return <Dialog open={open} onOpenChange={value => { if (setup) return; setOpen(value); setError(null); setNotice(null); }}>
    <DialogTrigger asChild><Button variant="ghost" className="min-h-11" aria-label="Settings" onClick={() => setSection("")}><Settings2 aria-hidden="true" />Settings</Button></DialogTrigger>
    <DialogContent showCloseButton={!setup} data-tv-local-only={host && section === "sources" ? "" : undefined} className={`max-h-[calc(100dvh-2rem)] overflow-y-auto [&>button]:min-h-11 [&>button]:min-w-11 ${host ? "text-base sm:max-w-lg" : "sm:max-w-md"}`}>
      <DialogHeader>
        <DialogTitle className={host ? "text-lg" : undefined}>{setup ? host ? "Welcome to Couch" : "Set up your TV" : "Settings"}</DialogTitle>
        <DialogDescription className={host ? "break-words text-base" : "break-words"}>{savedName || "Couch"}</DialogDescription>
      </DialogHeader>
      {content}
    </DialogContent>
  </Dialog>;
}
