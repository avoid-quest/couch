import { useEffect, useRef, useState } from "react";
import { RefreshCw, Settings2 } from "lucide-react";
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
import { PairedRemotes } from "./PairedRemotes";
import { knownConnection } from "./connection";

type ClaimCode = { code: string; expiresAt: number };
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
  onReconnect: () => void;
  onPairAgain: () => void;
  profile?: WatchingProfile;
  preferences?: Preferences;
  onCommand: (action: Action) => Promise<boolean>;
  initialOpen?: boolean;
  sourcesRequest?: number;
  jellyfinVersion: number;
  radioVersion: number;
  libraryVersion: number;
};

export function Settings({ videoQualityPreference, credentials, connected, status, identity, details, pairingRequired, reachable, playerStatus, host, administratorClaimed, name, version, onReconnect, onPairAgain, profile, preferences, onCommand, initialOpen = false, sourcesRequest = 0, jellyfinVersion, radioVersion, libraryVersion }: Props) {
  const [open, setOpen] = useState(initialOpen);
  const [section, setSection] = useState("general");
  useEffect(() => { if (sourcesRequest) { setSection("sources"); setOpen(true); setError(null); setNotice(null); } }, [sourcesRequest]);
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

  return <Dialog open={open} onOpenChange={value => { setOpen(value); setError(null); setNotice(null); }}>
    <DialogTrigger asChild><Button variant="ghost" className="min-h-11" aria-label="Settings" onClick={() => setSection("general")}><Settings2 aria-hidden="true" />Settings</Button></DialogTrigger>
    <DialogContent data-tv-local-only={host && section === "sources" ? "" : undefined} className={`max-h-[calc(100dvh-2rem)] overflow-y-auto [&>button]:min-h-11 [&>button]:min-w-11 ${host ? "text-base sm:max-w-lg" : "sm:max-w-md"}`}>
      <DialogHeader>
        <DialogTitle className={host ? "text-lg" : undefined}>Settings</DialogTitle>
        <DialogDescription className={host ? "break-words text-base" : "break-words"}>{savedName || "Couch"}</DialogDescription>
      </DialogHeader>
      <Tabs value={section} onValueChange={setSection} activationMode={host ? "manual" : "automatic"} className="min-w-0 gap-4">
        <TabsList className="grid h-auto w-full grid-cols-2 group-data-horizontal/tabs:h-auto" aria-label="Settings sections">
          <TabsTrigger value="general" className="min-h-11">General</TabsTrigger>
          <TabsTrigger value="playback" className="min-h-11">Playback</TabsTrigger>
          <TabsTrigger value="remote" className="min-h-11">{host ? "This screen" : "This remote"}</TabsTrigger>
          <TabsTrigger value="sources" className="min-h-11" data-tv-local-only={host ? "" : undefined}>Sources</TabsTrigger>
          <TabsTrigger value="connection" className="min-h-11">Connection</TabsTrigger>
        </TabsList>
        <TabsContent value="general" className={`min-w-0 space-y-4 ${host ? "text-base" : ""}`}>
          {administrator ? <form className="space-y-3" onSubmit={event => void update(event, "/api/settings", { name: draftName.trim() }, "TV name saved.")}>
            <div className="space-y-2"><Label htmlFor="tv-name">TV name</Label><Input ref={nameInput} id="tv-name" className="min-h-11" value={draftName} onChange={event => setDraftName(event.target.value)} maxLength={60} required disabled={!canWrite} aria-describedby="tv-name-help" /></div>
            <p id="tv-name-help" className="text-muted-foreground">Shown on the TV and every connected remote.</p>
            <Button type="submit" className="min-h-11" disabled={!canWrite || !draftName.trim() || draftName.trim() === savedName}>{pending ? "Saving…" : "Save name"}</Button>
          </form> : <div className="space-y-1">
            <p className="font-medium">TV name</p><p className="break-words" data-settings-tv-name>{savedName || "Couch"}</p>
            <p className="text-muted-foreground">{host ? "Use an administrator remote to change this TV's settings." : credentials ? "An administrator can change this TV's name." : "Pair this browser to control the TV."}</p>
          </div>}
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
          <SettingsSources credentials={credentials} connected={connected} canManage={!!host || administrator} version={jellyfinVersion} radioVersion={radioVersion} libraryVersion={libraryVersion} />
        </TabsContent>
        <TabsContent value="connection" className={`min-w-0 space-y-4 ${host ? "text-base" : ""}`}>
          <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-x-4 gap-y-3">
            <dt className="text-muted-foreground">Status</dt><dd className="min-w-0 break-words">{status}</dd>
            <dt className="text-muted-foreground">TV name</dt><dd className="min-w-0 break-words">{savedName}</dd>
            <dt className="text-muted-foreground">TV address</dt><dd className="min-w-0 break-all">{origin || knownConnection()?.origin || location.origin}</dd>
            <dt className="text-muted-foreground">Server</dt><dd>{connected ? "Connected" : reachable ? "Reachable" : status}</dd>
            <dt className="text-muted-foreground">Player</dt><dd>{reachable ? playerStatus === "unavailable" ? "Unavailable" : "Available" : "Unknown while disconnected"}</dd>
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
          {administrator && devices && <><Separator /><PairedRemotes devices={devices} currentId={identity.controller!.id} disabled={!canWrite} update={update} /></>}
        </TabsContent>
      </Tabs>
      {loading && <p role="status" className="text-muted-foreground">Loading settings…</p>}
      {!connected && <p role="status" className="text-muted-foreground">{credentials ? "Connect to the TV to change its settings." : "This browser is not paired."}</p>}
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {notice && <p role="status">{notice}</p>}
    </DialogContent>
  </Dialog>;
}
