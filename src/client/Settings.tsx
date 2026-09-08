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
import { Link } from "react-router";
import { settingsPages, type SettingsPage } from "../shared/settings-pages";
import "./settings-page.css";
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
import { PairedRemotes, RemoteName } from "./PairedRemotes";
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
type Props = {
  section?: SettingsPage | null;
  onSectionChange?: (section: SettingsPage | null) => void;
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

export function Settings({ section: routeSection, onSectionChange, videoQualityPreference, credentials, connected, status, identity, details, pairingRequired, reachable, playerStatus, host, administratorClaimed, name, version, appearance, onReconnect, onPairAgain, profile, preferences, onCommand, initialOpen = false, inline = false, active = true, onOpenRequest, setupStep, sourcesRequest = 0, jellyfinVersion, radioVersion, libraryVersion }: Props) {
  const [requestedOpen, setOpen] = useState(initialOpen);
  const setup = !!setupStep && setupStep !== "complete";
  const page = inline && !!credentials && !pairingRequired && !setup;
  const open = setup || (page ? active : requestedOpen);
  const [localSection, setLocalSection] = useState<SettingsPage | null>(null);
  const selectedSection = routeSection === undefined ? localSection : routeSection;
  const requestOpen = useRef(onOpenRequest);
  requestOpen.current = onOpenRequest;
  const section = setup ? !host && identity?.authority === "administrator" ? setupStep : "general" : selectedSection;
  const focusSection = useRef(false);
  const sectionHeading = useRef<HTMLHeadingElement | null>(null);
  const sectionContent = useRef<HTMLDivElement | null>(null);
  const previousSection = useRef<string | null | undefined>(null);
  const setSection = (next: SettingsPage | null) => {
    setError(null);
    setNotice(null);
    if (onSectionChange && !setup) onSectionChange(next);
    else setLocalSection(next);
  };
  useEffect(() => {
    if (!open || setup) return;
    if (section && (focusSection.current || previousSection.current !== section)) {
      const returningSource = section === "sources" && previousSection.current?.startsWith("source-") ? document.querySelector<HTMLElement>(`[data-settings-page="${previousSection.current}"]`) : null;
      const heading = sectionHeading.current ?? sectionContent.current?.querySelector<HTMLElement>("h3");
      if (returningSource) returningSource.focus();
      else if (heading) { heading.tabIndex = -1; heading.focus(); }
    }
    if (!section && previousSection.current) document.querySelector<HTMLElement>(`[data-settings-page="${previousSection.current}"]`)?.focus();
    previousSection.current = section;
    focusSection.current = false;
  }, [section, setup, open]);
  const previousStep = useRef(setupStep);
  useEffect(() => {
    if (previousStep.current && previousStep.current !== "complete" && setupStep === "complete") setOpen(false);
    previousStep.current = setupStep;
  }, [setupStep]);
  useEffect(() => { if (sourcesRequest) { setSection("sources"); setOpen(true); setError(null); setNotice(null); if (!onSectionChange) requestOpen.current?.(); } }, [sourcesRequest]);
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
  useEffect(() => { setError(null); setNotice(null); }, [section]);
  const mutation = useRef<AbortController | null>(null);
  const nameInput = useRef<HTMLInputElement | null>(null);
  const origin = credentials?.origin;
  const token = credentials?.token;
  const administrator = !host && identity?.authority === "administrator";
  useEffect(() => {
    if (identity && !administrator && ["bluetooth", "sound", "display", "advanced"].includes(selectedSection ?? "")) {
      focusSection.current = true;
      setSection("general");
    }
  }, [administrator, selectedSection, identity]);
  useEffect(() => { if (origin && administrator && readUpdateRequest(origin)) { setSection("updates"); setOpen(true); if (!onSectionChange) requestOpen.current?.(); } }, [origin, administrator]);
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
    {setupUrl && credentials && connected && (administrator || identity?.authority === "host") && <SetupQr url={setupUrl} credentials={credentials} />}
    <div className="min-w-0 space-y-1">
      <p className="font-medium">TV addresses on your network</p>
      {urls.map(url => <a key={url} href={url} target="_blank" rel="noreferrer" className="block min-h-11 content-center break-all text-muted-foreground underline underline-offset-4">{url}</a>)}
      {!urls.length && <p className="text-muted-foreground">No advertised address is known. Check the TV's network connection.</p>}
    </div>
  </div>;

  const qualitySettings = <div className="space-y-3">
    <QualitySelect id="default-video-quality" label="Video quality" value={videoQualityPreference.quality} onChange={videoQualityPreference.save} />
    <p className="text-sm text-muted-foreground">{host ? "Default for videos started from this TV." : "Default for videos started from this browser."}</p>
    {videoQualityPreference.error && <Alert variant="destructive"><AlertDescription>{videoQualityPreference.error}</AlertDescription></Alert>}
  </div>;

  const sourcePages = Object.entries(settingsPages).filter(([id]) => id.startsWith("source-")) as [SettingsPage, (typeof settingsPages)[SettingsPage]][];
  const sourcePage = section?.startsWith("source-");
  const visiblePages = Object.entries(settingsPages).filter(([id]) =>
    !id.startsWith("source-") && (administrator || !["bluetooth", "sound", "display", "advanced"].includes(id)) && (id !== "tv-appearance" || !host),
  ) as [SettingsPage, (typeof settingsPages)[SettingsPage]][];
  const pageLink = (id: SettingsPage | null, label: React.ReactNode, className = "", back = false) => <Button
    variant="ghost" className={`settings-link ${className}`} asChild={!!onSectionChange && !setup}
    data-settings-page={id ?? undefined} data-back={back ? "" : undefined}
    data-tv-local-only={host && (id === "sources" || id?.startsWith("source-")) ? "" : undefined}
    aria-current={id && (section === id || id === "sources" && sourcePage) ? "page" : undefined}
    onClick={onSectionChange && !setup ? undefined : () => setSection(id)}>
    {onSectionChange && !setup ? <Link to={id ? settingsPages[id].path : "/settings"}>{label}</Link> : label}
  </Button>;

  const content = <>
      {setup && <SetupProgress step={setupStep!} host={!!host} administrator={administrator} administratorClaimed={administratorClaimed} />}
      {!setup && page && <label className="settings-category"><span className="sr-only">Settings category</span><select value={sourcePage ? "sources" : section ?? "playback"} onChange={event => setSection(event.target.value as SettingsPage)}>{visiblePages.map(([id, item]) => <option key={id} value={id}>{item.label}</option>)}</select></label>}
      {!setup && <nav className="settings-nav" aria-label="Settings pages">
        {visiblePages.map(([id, item]) => <div key={id}>{pageLink(id, <><span>{item.label}</span><ChevronRight aria-hidden="true" className="settings-link-arrow" /></>)}</div>)}
      </nav>}
      <div ref={sectionContent} className="settings-content min-w-0">
        {!setup && section && <header className="settings-section-header">
          {!page && !sourcePage && pageLink(null, <><ArrowLeft aria-hidden="true" />All settings</>, "settings-back", true)}
          {sourcePage ? pageLink("sources", <><ArrowLeft aria-hidden="true" />Sources</>, "settings-source-back", true) : <h2 ref={sectionHeading} tabIndex={-1}>{settingsPages[section as SettingsPage]?.label}</h2>}
        </header>}
        {administrator && credentials && <SettingsSection section={section} value="updates" className="min-w-0">{open && section === "updates" && <UpdatesSettings key={`${credentials.origin}:${identity.controller?.id}`} credentials={credentials} connected={connected} />}</SettingsSection>}
        {!administrator && <SettingsSection section={section} value="updates" className="min-w-0 space-y-3">
          <p>Use an administrator remote to install updates.</p>
          <p className="text-muted-foreground">An administrator can approve this remote in Paired remotes.</p>
          {pageLink("connection", "Connections")}
        </SettingsSection>}
        {administrator && credentials && <SettingsSection section={section} value="advanced" className="min-w-0">{open && section === "advanced" && <AdvancedSettings key={`${credentials.origin}:${identity.controller?.id}`} credentials={credentials} connected={connected} />}</SettingsSection>}
        {administrator && credentials && <SettingsSection section={section} value="bluetooth" className="min-w-0">{open && section === "bluetooth" && <BluetoothSettings credentials={credentials} connected={connected} />}</SettingsSection>}
        {administrator && credentials && <SettingsSection section={section} value="sound" className="min-w-0">{open && section === "sound" && <SoundSettings credentials={credentials} connected={connected} />}</SettingsSection>}
        {administrator && credentials && <SettingsSection section={section} value="display" className="min-w-0">{open && section === "display" && <DisplaySettings credentials={credentials} connected={connected} />}</SettingsSection>}
        <SettingsSection section={section} value="appearance" className="min-w-0"><AppearanceSettings scope="device" native={!!host} credentials={credentials} connected={connected} administrator={administrator || !!host && identity?.authority === "host"} appearance={appearance} /></SettingsSection>
        {!host && <SettingsSection section={section} value="tv-appearance" className="min-w-0"><AppearanceSettings scope="tv" native={false} credentials={credentials} connected={connected} administrator={administrator} appearance={appearance} /></SettingsSection>}
        <SettingsSection section={section} value="general" className={`min-w-0 space-y-4 ${host ? "text-base" : ""}`}>
          {administrator ? <form className="space-y-3" onSubmit={event => void update(event, "/api/settings", { name: draftName.trim() }, "TV name saved.")}>
            <div className="space-y-2"><Label htmlFor="tv-name">TV name</Label><Input ref={nameInput} id="tv-name" className="min-h-11" value={draftName} onChange={event => setDraftName(event.target.value)} maxLength={60} required disabled={!canWrite} aria-describedby="tv-name-help" /></div>
            <p id="tv-name-help" className="text-muted-foreground">Name shown for this TV.</p>
            <Button type="submit" className="min-h-11" disabled={!canWrite || !draftName.trim() || draftName.trim() === savedName}>{pending ? "Saving…" : "Save TV name"}</Button>
          </form> : <div className="space-y-1">
            <p className="font-medium">TV name</p><p className="break-words" data-settings-tv-name>{savedName || "Couch"}</p>
            <p className="text-muted-foreground">{host ? "Use an administrator remote to change this TV's settings." : credentials ? "An administrator can change this TV's name." : "Pair this browser to control the TV."}</p>
          </div>}
          {administrator && credentials && open && section === "general" && <StartupSettings key={`startup:${credentials.origin}:${credentials.token}`} credentials={credentials} connected={connected} />}
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
        </SettingsSection>
        <SettingsSection section={section} value="playback" className="min-w-0 space-y-6">
          {qualitySettings}
          <Separator />
          {profile && preferences ? <PlaybackPreferences key={profile.id} profile={profile} preferences={preferences} connected={connected} onCommand={onCommand} /> : <p className="text-muted-foreground">Connect to the TV to load playback defaults.</p>}
        </SettingsSection>
        <SettingsSection section={section} value="sources" className="min-w-0 space-y-4" data-tv-local-only={host ? "" : undefined}>
          {setup ? <SettingsSources setupOnly credentials={credentials} connected={connected} canManage={!!host || administrator} version={jellyfinVersion} radioVersion={radioVersion} libraryVersion={libraryVersion} /> : <nav className="settings-source-list" aria-label="Sources">
            {sourcePages.map(([id, item]) => <div key={id}>{pageLink(id, <><span>{item.label}</span><ChevronRight aria-hidden="true" /></>)}</div>)}
          </nav>}
        </SettingsSection>
        {sourcePage && <SettingsSources source={section!.slice(7)} credentials={credentials} connected={connected} canManage={!!host || administrator} version={jellyfinVersion} radioVersion={radioVersion} libraryVersion={libraryVersion} />}
        <SettingsSection section={section} value="connection" className={`min-w-0 space-y-4 ${host ? "text-base" : ""}`}>
          <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-x-4 gap-y-3">
            <dt className="text-muted-foreground">TV name</dt><dd className="min-w-0 break-words">{savedName}</dd>
            <dt className="text-muted-foreground">TV address</dt><dd className="min-w-0 break-all">{origin || knownConnection()?.origin || location.origin}</dd>
            <dt className="text-muted-foreground">Server</dt><dd>{connected ? "Connected" : reachable ? "Reachable" : status}</dd>
            <dt className="text-muted-foreground">Player</dt><dd>{!reachable ? "Unknown while disconnected" : !playerStatus ? "Unknown" : playerStatus === "unavailable" ? "Unavailable" : "Available"}</dd>
            {identity?.controller && <><dt className="text-muted-foreground">This remote</dt><dd className="min-w-0 space-y-1"><p className="break-words">{identity.controller.name}</p><Badge variant="secondary">{identity.authority === "administrator" ? "Administrator" : "Controller"}</Badge></dd></>}
          </dl>
          {pairingRequired && credentials && <p role="alert">The TV rejected this browser's credential. Pair again to restore access.</p>}
          {status === "Connection rejected" && <p role="alert">The TV rejected this browser's address. Open one of its advertised LAN addresses.</p>}
          {identity?.controller && <RemoteName device={identity.controller} disabled={!canWrite} update={update} />}
          <Separator />{addresses}
          {host && <div className="rounded-lg border bg-muted/30 p-3"><p className="font-medium">Controller pairing code</p><p className="my-2 font-mono text-2xl tracking-wider" data-pairing-code>{host.pairingCode}</p><p className="text-muted-foreground">Connects a remote for browsing and playback.</p></div>}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="min-h-11" onClick={onReconnect}><RefreshCw aria-hidden="true" />Reconnect</Button>
            {!host && <Button variant="outline" className="min-h-11" disabled={lastAdministrator && !pairingRequired} onClick={() => credentials && !pairingRequired ? setForgetting(true) : pairAgain()}>{credentials ? "Pair again" : "Pair with TV"}</Button>}
          </div>
          {!host && <p className="text-muted-foreground">Reconnect keeps your pairing. Pair again forgets it in this browser.</p>}
          {lastAdministrator && !pairingRequired && <p className="text-muted-foreground">Approve another administrator before forgetting this browser.</p>}
          {administrator && devices && <><Separator /><PairedRemotes devices={devices} currentId={identity.controller?.id ?? ""} disabled={!canWrite} update={update} /></>}
          {forgetting && <div role="alert" className="space-y-3 rounded-lg border p-3"><p>Forget this browser's pairing? You will need the code shown on the TV to connect again.{identity?.authority === "administrator" ? " Administration will require another administrator or local/SSH recovery." : ""}</p><div className="flex flex-wrap gap-2"><Button className="min-h-11" variant="outline" onClick={() => setForgetting(false)}>Cancel</Button><Button className="min-h-11" disabled={lastAdministrator && !pairingRequired} onClick={pairAgain}>Forget this browser</Button></div></div>}
        </SettingsSection>
      </div>
      {setup && administrator && <Button className="min-h-11" disabled={!canWrite || section === "general" && draftName.trim() !== savedName} onClick={event => void update(event, "/api/settings/setup", { step: setupStep }, "Setup progress saved.")}>
        {pending ? "Saving…" : section === "general" ? "Continue to screen" : section === "display" ? "I can see Couch on the right screen" : section === "sound" ? "I heard the test sound" : "Finish setup"}
      </Button>}
      {loading && <p role="status" className="text-muted-foreground">Loading settings…</p>}
      {!connected && <p role="status" className="text-muted-foreground">{credentials ? "Connect to the TV to change its settings." : "This browser is not paired."}</p>}
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {notice && <p role="status">{notice}</p>}
  </>;

  if (page) return <section className={`settings-page ${section ? "settings-page-detail" : "settings-page-index"}`} aria-label="Settings" hidden={!active} data-tv-local-only={host && (section === "sources" || sourcePage) ? "" : undefined}>
    {active && <><header className="settings-header"><h1>Settings</h1></header><div className="settings-layout">{content}</div></>}
  </section>;

  return <Dialog open={open} onOpenChange={value => { if (setup) return; setOpen(value); setError(null); setNotice(null); }}>
    <DialogTrigger asChild><Button variant="ghost" className="min-h-11" aria-label="Settings" onClick={() => setSection(null)}><Settings2 aria-hidden="true" />Settings</Button></DialogTrigger>
    <DialogContent showCloseButton={!setup} data-tv-local-only={host && (section === "sources" || sourcePage) ? "" : undefined} className={`settings-dialog ${section ? "settings-page-detail" : "settings-page-index"} max-h-[calc(100dvh-2rem)] overflow-y-auto [&>button]:min-h-11 [&>button]:min-w-11 ${host ? "text-base sm:max-w-lg" : "sm:max-w-md"}`}>
      <DialogHeader>
        <DialogTitle className={host ? "text-lg" : undefined}>{setup ? host ? "Welcome to Couch" : "Set up your TV" : "Settings"}</DialogTitle>
        <DialogDescription className={host ? "break-words text-base" : "break-words"}>{savedName || "Couch"}</DialogDescription>
      </DialogHeader>
      {content}
    </DialogContent>
  </Dialog>;
}

function SettingsSection({ section, value, children, ...props }: { section: string | null | undefined; value: string; children: React.ReactNode } & React.HTMLAttributes<HTMLElement>) {
  return section === value ? <section {...props}>{children}</section> : null;
}
