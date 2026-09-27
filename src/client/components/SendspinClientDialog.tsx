import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiCredentials } from "@/api/client";
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

class PreparationError extends Error {}
type Phase = "idle" | "preparing" | "ready" | "joining" | "joined" | "leaving";

/** A separate, user-supplied audio server; Couch playback uses useDeviceAudio. */
export function useSendspinClient(options: { credentials: ApiCredentials | null; allowed: boolean; canActivate: () => boolean }) {
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
  const retire = useCallback(() => {
    ++generation.current;
    const previous = client.current; client.current = null;
    closing.current = closing.current.catch(() => {}).then(() => previous?.disconnect());
    setPhase("idle"); setState(null); setEverConnected(false); setPin(null); setServer(null);
  }, []);
  useEffect(() => () => retire(), [options.credentials?.origin, options.credentials?.token, retire]);
  useEffect(() => { if (!options.allowed && phase !== "idle") retire(); }, [options.allowed, phase, retire]);

  const prepare = useCallback(async (address: string, name: string) => {
    if (phase !== "idle" || !latest.current.allowed || !latest.current.canActivate()) return;
    const attempt = ++generation.current;
    const current = () => attempt === generation.current;
    setPhase("preparing"); setError(null); setPin(null); setEverConnected(false);
    let prepared: ReturnType<typeof createSendspinRenderer> | null = null;
    try {
      await closing.current;
      const url = new URL(address.trim());
      if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol) || url.username || url.password || url.hash) throw new PreparationError("Enter an HTTP or WebSocket server address without credentials.");
      if (!current()) return;
      prepared = createSendspinRenderer({ url: url.href, name: name.trim() || clientDeviceName() }, {
        state: value => { if (current()) {
          setState(value);
          if (value.connected) {
            setEverConnected(true);
            if (!isNativeHost()) try { localStorage.setItem("couch.browser-volume", String(value.volume / 100)); } catch { /* Storage is optional. */ }
          }
        } },
        error: reason => { if (current()) setError(reason.message === sendspinReconnectStopped ? sendspinReconnectStopped : "Sendspin couldn't connect or continue playback. Leave and try again."); },
        pairingPin: value => { if (current()) setPin(value); },
      });
      await prepared.preload();
      if (!current()) { await prepared.disconnect(); return; }
      if (!latest.current.allowed || !latest.current.canActivate()) { await prepared.disconnect(); setPhase("idle"); return; }
      client.current = prepared; setServer(url.host); setPhase("ready");
    } catch (reason) {
      await prepared?.disconnect();
      if (current()) { setError(reason instanceof PreparationError ? reason.message : "Couldn't prepare Sendspin. Check the server address and try again."); setPhase("idle"); }
    }
  }, [phase]);
  const join = useCallback(() => {
    if (phase !== "ready" || !client.current) return;
    const attempt = generation.current;
    let browserVolume: number | null = null;
    if (!isNativeHost()) try { const value = localStorage.getItem("couch.browser-volume"); const stored = Number(value); if (value !== null && Number.isFinite(stored) && stored >= 0 && stored <= 1) browserVolume = stored * 100; } catch { /* Storage is optional. */ }
    const connecting = client.current.connectFromGesture();
    if (browserVolume !== null) client.current.setVolume(browserVolume);
    setPhase("joining"); setError(null);
    void connecting.then(() => { if (attempt === generation.current) setPhase("joined"); }, () => {
      if (attempt === generation.current) { setError("Couldn't join Sendspin. Leave and try again."); setPhase("ready"); }
    });
  }, [phase]);
  const leave = useCallback(async () => {
    if (!client.current) { retire(); return; }
    setPhase("leaving");
    const previous = client.current;
    const attempt = ++generation.current;
    closing.current = closing.current.catch(() => {}).then(() => previous.disconnect());
    try { await closing.current; if (generation.current === attempt) { client.current = null; setPhase("idle"); setState(null); setEverConnected(false); setPin(null); setServer(null); } }
    catch { if (generation.current === attempt) { setError("Couldn't disconnect from audio server. Try again."); setPhase("joined"); } }
  }, []);
  return useMemo(() => ({ phase, state, everConnected, pin, error, server, prepare, join, leave,
    volume: (value: number) => client.current?.setVolume(value), mute: (value: boolean) => client.current?.setMuted(value),
    transport: (value: "play" | "pause") => client.current?.transport(value), pair: () => client.current?.openPairingWindow(),
  }), [phase, state, everConnected, pin, error, server, prepare, join, leave]);
}

export function SendspinClientDialog({ open, onOpenChange, onCloseAutoFocus }: { open: boolean; onOpenChange: (open: boolean) => void; onCloseAutoFocus?: (event: Event) => void }) {
  const { credentials, connected, identity } = useSessionGate();
  const sendspin = useSendspinClient({ credentials, allowed: connected, canActivate: () => connected });
  const [address, setAddress] = useState("");
  const idle = sendspin.phase === "idle";
  const waiting = ["preparing", "joining", "leaving"].includes(sendspin.phase);
  const playback = sendspin.state;
  const retryStopped = sendspin.error === sendspinReconnectStopped;
  const transport = playback?.isPlaying ? "pause" : "play";
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent onCloseAutoFocus={onCloseAutoFocus}>
    <DialogHeader><DialogTitle>Other audio server</DialogTitle><DialogDescription>Join a separate Sendspin server on this device.</DialogDescription></DialogHeader>
    {idle ? <form className="grid gap-4" onSubmit={event => { event.preventDefault(); void sendspin.prepare(address, clientDeviceName(identity?.controller?.name)); }}>
      <div className="grid gap-2"><Label htmlFor="sendspin-server">Server address</Label><Input id="sendspin-server" value={address} onChange={event => setAddress(event.target.value)} placeholder="wss://music.example/sendspin" autoComplete="url" spellCheck={false} /></div>
      <Button type="submit" disabled={!connected || !address.trim()}>Continue</Button>
    </form> : <div className="grid gap-4">
      <p>{sendspin.server ?? "Preparing Sendspin…"}</p>
      {playback?.metadata?.title && <div><p className="font-medium">{playback.metadata.title}</p><p className="text-sm text-muted-foreground">{playback.metadata.artist}</p></div>}
      {sendspin.pin && <div className="grid gap-1"><p>Confirm this pairing code on the Sendspin server.</p><p className="font-mono text-2xl tracking-wider">{sendspin.pin}</p></div>}
      {sendspin.phase === "ready" && <Button disabled={!connected} onClick={sendspin.join}>Join</Button>}
      {playback?.connected && <div className="grid gap-3 border-t pt-3">
        <div className="flex items-center gap-3"><Slider aria-label="Sendspin volume" defaultValue={[playback.volume]} key={playback.volume} onValueCommit={([value]) => sendspin.volume(value!)} /><Button variant="ghost" onClick={() => sendspin.mute(!playback.muted)}>{playback.muted ? "Unmute" : "Mute"}</Button></div>
        {playback.supportedCommands.includes(transport) && <Button variant="outline" onClick={() => sendspin.transport(transport)}>{transport === "pause" ? "Pause" : "Play"}</Button>}
      </div>}
      {!retryStopped && (["joining", "joined"].includes(sendspin.phase) || sendspin.pin) && <Button variant="outline" onClick={sendspin.pair}>Open pairing window</Button>}
      {waiting && <p role="status">{sendspin.phase === "joining" ? "Joining…" : sendspin.phase === "leaving" ? "Leaving…" : "Preparing…"}</p>}
      {sendspin.phase === "joined" && !retryStopped && !sendspin.error && <p role="status">{playback?.connected ? "Connected to audio server." : sendspin.everConnected ? "Disconnected. Waiting to reconnect…" : "Waiting for audio server connection or pairing…"}</p>}
      <Button variant="ghost" disabled={sendspin.phase === "leaving"} onClick={() => void sendspin.leave()}>{"Leave audio server"}</Button>
    </div>}
    {sendspin.error && <Alert variant="destructive"><AlertDescription>{sendspin.error}</AlertDescription></Alert>}
  </DialogContent></Dialog>;
}
