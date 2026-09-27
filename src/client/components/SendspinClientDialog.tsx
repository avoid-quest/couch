import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiJson, apiSend, type ApiCredentials } from "@/api/client";
import { createSendspinRenderer, sendspinReconnectStopped, type SendspinRendererState } from "@/session/sendspin-renderer";
import { useSessionGate } from "@/session/session-context";
import { clientDeviceName } from "@/session/device-name";
import { isNativeHost } from "@/session/native-context";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Slider } from "./ui/slider";

type Enrollment = { url: string; serverId: string; psk: string; name: string };
type Hosting = { available: boolean; url?: string; serverId?: string; name?: string };
class PreparationError extends Error {}

type Phase = "idle" | "preparing" | "ready" | "joining" | "joined" | "leaving";

export function useSendspinClient(options: { credentials: ApiCredentials | null; allowed: boolean; canActivate: () => boolean; rendererTargetId?: string | null; canEnableHosting?: boolean; afterJoin?: (clientId: string) => Promise<void>; beforeLeave?: (clientId: string) => Promise<void>; setActive?: (active: boolean) => void }) {
  const latest = useRef(options); latest.current = options;
  const client = useRef<ReturnType<typeof createSendspinRenderer> | null>(null);
  const generation = useRef(0);
  const closing = useRef(Promise.resolve());
  const [phase, setPhase] = useState<Phase>("idle");
  const [state, setState] = useState<SendspinRendererState | null>(null);
  const [everConnected, setEverConnected] = useState(false);
  const [pin, setPin] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [server, setServer] = useState<string | null>(null);
  const [external, setExternal] = useState(false);
  const [clientId, setClientId] = useState<string | null>(null);
  const [sharedReady, setSharedReady] = useState(false);
  const afterJoinAtGesture = useRef(options.afterJoin);
  const phaseRef = useRef(phase); phaseRef.current = phase;
  const externalRef = useRef(external); externalRef.current = external;
  // Retired credentials cannot authorize a group leave. Disconnect locally and
  // fence late SDK callbacks; the server removes membership on disconnect.
  const retire = useCallback(() => {
    ++generation.current;
    const previous = client.current; client.current = null;
    afterJoinAtGesture.current = undefined;
    closing.current = closing.current.catch(() => {}).then(() => previous?.disconnect());
    setClientId(null); setSharedReady(false); setPhase("idle"); setState(null); setEverConnected(false); setPin(null); setServer(null); setExternal(false);
  }, []);
  const leave = useCallback(async () => {
    const previous = client.current;
    const previousPhase = phaseRef.current;
    setPhase("leaving");
    if (previous?.clientId && !externalRef.current) try { await latest.current.beforeLeave?.(previous.clientId); }
    catch { setError("Couldn't leave shared audio. Try again."); setPhase(previousPhase); return; }
    const attempt = ++generation.current;
    closing.current = closing.current.catch(() => {}).then(() => previous?.disconnect());
    try { await closing.current; }
    catch { if (generation.current === attempt) { setError("Couldn't disconnect shared audio. Try again."); setPhase(previousPhase); } return; }
    if (generation.current !== attempt) return;
    client.current = null; afterJoinAtGesture.current = undefined; setClientId(null); setSharedReady(false); setPhase("idle"); setState(null); setEverConnected(false); setPin(null); setServer(null); setExternal(false);
  }, []);
  useEffect(() => () => retire(), [options.credentials?.origin, options.credentials?.token, retire]);
  useEffect(() => { if (!options.allowed && phase !== "idle") retire(); }, [options.allowed, phase, retire]);

  const prepare = useCallback(async (destination: "couch" | "external", address: string, name: string) => {
    if (phase !== "idle" || !latest.current.allowed || !latest.current.canActivate()) return;
    const attempt = ++generation.current;
    const current = () => attempt === generation.current;
    setPhase("preparing"); setError(null); setPin(null); setEverConnected(false); setSharedReady(false); afterJoinAtGesture.current = undefined;
    let prepared: ReturnType<typeof createSendspinRenderer> | null = null;
    let membershipStarted = false;
    try {
      await closing.current;
      const credentials = latest.current.credentials;
      let hosting = destination === "couch" && credentials ? await apiJson<Hosting>(credentials, "/api/sendspin/enrollment") : null;
      if (destination === "couch" && !hosting?.available && credentials && latest.current.canEnableHosting) {
        try { await apiSend(credentials, "/api/settings/sendspin", { enabled: true }); }
        catch { throw new PreparationError("Couldn't enable shared audio on this Couch."); }
        for (let retry = 0; retry < 12 && current() && !hosting?.available; retry++) {
          await new Promise(resolve => setTimeout(resolve, 250));
          if (current()) try { hosting = await apiJson<Hosting>(credentials, "/api/sendspin/enrollment"); } catch { /* Hosting can still be starting. */ }
        }
      }
      if (destination === "couch" && (!hosting?.available || !hosting.url || !hosting.serverId)) throw new PreparationError("Shared audio is unavailable on this Couch. Try again or ask its administrator to enable it.");
      const url = new URL(destination === "couch" ? hosting!.url! : address.trim());
      if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol) || url.username || url.password || url.hash) throw new PreparationError("Enter an HTTP or WebSocket server address without credentials.");
      if (!current()) return;
      prepared = createSendspinRenderer({ url: url.href, name: name.trim() || clientDeviceName() }, {
        state: value => { if (current()) {
          setState(value);
          if (value.connected) {
            setEverConnected(true);
            if (!isNativeHost()) try { localStorage.setItem("couch.browser-volume", String(value.volume / 100)); } catch { /* Storage is optional. */ }
            if (destination === "couch" && !membershipStarted && prepared?.clientId) {
              membershipStarted = true;
              const id = prepared.clientId;
              const afterJoin = afterJoinAtGesture.current;
              if (!afterJoin) setError("Shared audio isn't ready in this client. Leave and try again.");
              else void Promise.resolve().then(() => afterJoin(id)).then(() => { if (current()) setSharedReady(true); }, reason => { if (current()) setError(reason instanceof Error ? reason.message : "Couldn't add this device to shared audio. Leave and try again."); });
            }
          }
        } },
        error: reason => { if (current()) setError(reason.message === sendspinReconnectStopped ? sendspinReconnectStopped : "Sendspin couldn't connect or continue playback. Leave and try again."); },
        pairingPin: value => { if (current()) setPin(value); },
      });
      await prepared.preload();
      if (!prepared.clientId) throw new PreparationError("Couldn't identify this device for shared audio.");
      if (!current()) { await prepared.disconnect(); return; }
      if (destination === "couch") {
        const enrollment = await apiSend<Enrollment>(credentials!, "/api/sendspin/enrollment", { clientId: prepared.clientId, ...(latest.current.rendererTargetId ? { rendererTargetId: latest.current.rendererTargetId } : {}) });
        if (enrollment.url !== hosting!.url || enrollment.serverId !== hosting!.serverId) throw new PreparationError("Sendspin configuration changed. Try again.");
        prepared.setEnrollment(enrollment);
      }
      if (!current() || !latest.current.allowed || !latest.current.canActivate()) { await prepared.disconnect(); if (current()) setPhase("idle"); return; }
      client.current = prepared; setClientId(prepared.clientId); setServer(hosting?.name ?? url.host); setExternal(destination === "external"); setPhase("ready");
    } catch (reason) {
      await prepared?.disconnect();
      if (current()) { setError(reason instanceof PreparationError ? reason.message : "Couldn't prepare Sendspin. Check the server address and try again."); setPhase("idle"); }
    }
  }, [phase]);
  const join = useCallback(() => {
    if (phase !== "ready" || !client.current) return;
    const attempt = generation.current;
    afterJoinAtGesture.current = latest.current.afterJoin;
    // This call must retain the click's activation: the adapter unlocks first.
    let browserVolume: number | null = null;
    if (!isNativeHost()) try { const value = localStorage.getItem("couch.browser-volume"); const stored = Number(value); if (value !== null && Number.isFinite(stored) && stored >= 0 && stored <= 1) browserVolume = stored * 100; } catch { /* Storage is optional. */ }
    const connecting = client.current.connectFromGesture();
    if (browserVolume !== null) client.current.setVolume(browserVolume);
    setPhase("joining"); setError(null);
    void connecting.then(() => { if (attempt === generation.current) setPhase("joined"); }, () => {
      if (attempt === generation.current) { setError("Couldn't join Sendspin. Leave and try again."); setPhase("ready"); }
    });
  }, [phase]);
  return useMemo(() => ({ phase, state, connected: !!state?.connected, clientId, sharedReady, everConnected, pin, error, server, external, prepare, join, leave,
    volume: (value: number) => client.current?.setVolume(value), mute: (value: boolean) => client.current?.setMuted(value),
    transport: (value: "play" | "pause") => client.current?.transport(value), pair: () => client.current?.openPairingWindow(),
  }), [phase, state, clientId, sharedReady, everConnected, pin, error, server, external, prepare, join, leave]);
}

export function SendspinClientDialog({ open, onOpenChange, onCloseAutoFocus }: { open: boolean; onOpenChange: (open: boolean) => void; onCloseAutoFocus?: (event: Event) => void }) {
  const { sendspin, sendspinDisabledReason, connected, state, identity } = useSessionGate();
  const [destination, setDestination] = useState<"couch" | "external">("couch");
  const [address, setAddress] = useState("");
  const idle = sendspin.phase === "idle";
  const waiting = ["preparing", "joining", "leaving"].includes(sendspin.phase);
  const playback = sendspin.state;
  const retryStopped = sendspin.error === sendspinReconnectStopped;
  const transport = playback?.isPlaying ? "pause" : "play";
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent onCloseAutoFocus={onCloseAutoFocus}>
    <DialogHeader><DialogTitle>Listen together</DialogTitle><DialogDescription>{destination === "couch" ? "Add this device to shared audio on this Couch." : "Join another audio server on this device."}</DialogDescription></DialogHeader>
    {idle ? <form className="grid gap-4" onSubmit={event => { event.preventDefault(); void sendspin.prepare(destination, address, clientDeviceName(identity?.controller?.name)); }}>
      {destination === "external" && <div className="grid gap-2"><Label htmlFor="sendspin-server">Server address</Label><Input id="sendspin-server" value={address} onChange={event => setAddress(event.target.value)} placeholder="wss://music.example/sendspin" autoComplete="url" spellCheck={false} /></div>}
      {sendspinDisabledReason && <p className="text-sm text-muted-foreground">{sendspinDisabledReason}</p>}
      <Button type="submit" disabled={!connected || !!sendspinDisabledReason || !!state?.handoff || destination === "external" && !address.trim()}>{destination === "couch" ? "Listen together" : "Continue"}</Button>
      <Button type="button" variant="ghost" className="justify-self-start" onClick={() => setDestination(destination === "couch" ? "external" : "couch")}>{destination === "couch" ? "Another audio server…" : "Use this Couch"}</Button>
    </form> : <div className="grid gap-4">
      <p>{sendspin.server ?? "Preparing Sendspin…"}</p>
      {sendspin.external && playback?.metadata?.title && <div><p className="font-medium">{playback.metadata.title}</p><p className="text-sm text-muted-foreground">{playback.metadata.artist}</p></div>}
      {sendspin.pin && <div className="grid gap-1"><p>Confirm this pairing code on the Sendspin server.</p><p className="font-mono text-2xl tracking-wider">{sendspin.pin}</p></div>}
      {sendspin.phase === "ready" && <Button disabled={!connected} onClick={sendspin.join}>Join</Button>}
      {sendspin.external && playback?.connected && <div className="grid gap-3 border-t pt-3">
        <div className="flex items-center gap-3"><Slider aria-label="Sendspin volume" defaultValue={[playback.volume]} key={playback.volume} onValueCommit={([value]) => sendspin.volume(value!)} /><Button variant="ghost" onClick={() => sendspin.mute(!playback.muted)}>{playback.muted ? "Unmute" : "Mute"}</Button></div>
        {playback.supportedCommands.includes(transport) && <Button variant="outline" onClick={() => sendspin.transport(transport)}>{transport === "pause" ? "Pause" : "Play"}</Button>}
      </div>}
      {!retryStopped && sendspin.external && (["joining", "joined"].includes(sendspin.phase) || sendspin.pin) && <Button variant="outline" onClick={sendspin.pair}>Open pairing window</Button>}
      {waiting && <p role="status">{sendspin.phase === "joining" ? "Joining…" : sendspin.phase === "leaving" ? "Leaving…" : "Preparing…"}</p>}
      {sendspin.phase === "joined" && !retryStopped && !sendspin.error && <p role="status">{playback?.connected ? sendspin.external ? "Connected to audio server." : sendspin.sharedReady ? "Listening together." : "Adding this device to shared audio…" : sendspin.everConnected ? "Disconnected. Waiting to reconnect…" : sendspin.external ? "Waiting for audio server connection or pairing…" : "Connecting to shared audio…"}</p>}
      <Button variant="ghost" disabled={sendspin.phase === "leaving"} onClick={() => void sendspin.leave()}>{sendspin.external ? "Leave audio server" : "Leave shared audio"}</Button>
    </div>}
    {sendspin.error && <Alert variant="destructive"><AlertDescription>{sendspin.error}</AlertDescription></Alert>}
  </DialogContent></Dialog>;
}
