import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiJson, apiSend, type ApiCredentials } from "@/api/client";
import { createSendspinRenderer, sendspinReconnectStopped, type SendspinRendererState } from "@/session/sendspin-renderer";
import { useSessionGate } from "@/session/session-context";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";
import { Slider } from "./ui/slider";

type Enrollment = { url: string; serverId: string; psk: string; name: string };
type Hosting = { available: boolean; url?: string; serverId?: string; name?: string };
class PreparationError extends Error {}

type Phase = "idle" | "preparing" | "ready" | "joining" | "joined" | "leaving";

export function useSendspinClient(options: { credentials: ApiCredentials | null; allowed: boolean; canActivate: () => boolean; setActive: (active: boolean) => void }) {
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
  const leave = useCallback(async () => {
    const attempt = ++generation.current;
    const previous = client.current; client.current = null;
    setPhase("leaving");
    closing.current = closing.current.then(() => previous?.disconnect()).then(() => {});
    try { await closing.current; }
    catch { if (generation.current === attempt) setError("Couldn't leave Sendspin. Close this window before starting other playback."); return; }
    if (generation.current !== attempt) return;
    latest.current.setActive(false); setPhase("idle"); setState(null); setEverConnected(false); setPin(null); setServer(null); setExternal(false);
  }, []);
  useEffect(() => () => { void leave(); }, [options.credentials?.origin, options.credentials?.token, leave]);
  useEffect(() => { if (!options.allowed && client.current) void leave(); }, [options.allowed, leave]);

  const prepare = useCallback(async (destination: "couch" | "external", address: string, name: string) => {
    if (phase !== "idle" || !latest.current.allowed || !latest.current.canActivate()) return;
    const attempt = ++generation.current;
    const current = () => attempt === generation.current;
    setPhase("preparing"); setError(null); setPin(null); setEverConnected(false);
    let prepared: ReturnType<typeof createSendspinRenderer> | null = null;
    try {
      await closing.current;
      const credentials = latest.current.credentials;
      const hosting = destination === "couch" && credentials ? await apiJson<Hosting>(credentials, "/api/sendspin/enrollment") : null;
      if (destination === "couch" && (!hosting?.available || !hosting.url || !hosting.serverId)) throw new PreparationError("This Couch is not hosting Sendspin. Choose another server.");
      const url = new URL(destination === "couch" ? hosting!.url! : address.trim());
      if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol) || url.username || url.password || url.hash) throw new PreparationError("Enter an HTTP or WebSocket server address without credentials.");
      if (!current()) return;
      prepared = createSendspinRenderer({ url: url.href, name: name.trim() || "Couch browser" }, {
        state: value => { if (current()) { setState(value); if (value.connected) setEverConnected(true); } },
        error: reason => { if (current()) setError(reason.message === sendspinReconnectStopped ? sendspinReconnectStopped : "Sendspin couldn't connect or continue playback. Leave and try again."); },
        pairingPin: value => { if (current()) setPin(value); },
      });
      await prepared.preload();
      if (!current()) { await prepared.disconnect(); return; }
      if (destination === "couch") {
        const enrollment = await apiSend<Enrollment>(credentials!, "/api/sendspin/enrollment", { clientId: prepared.clientId });
        if (enrollment.url !== hosting!.url || enrollment.serverId !== hosting!.serverId) throw new PreparationError("Sendspin configuration changed. Try again.");
        prepared.setEnrollment(enrollment);
      }
      if (!current() || !latest.current.allowed || !latest.current.canActivate()) { await prepared.disconnect(); if (current()) setPhase("idle"); return; }
      client.current = prepared; setServer(hosting?.name ?? url.host); setExternal(destination === "external"); latest.current.setActive(true); setPhase("ready");
    } catch (reason) {
      await prepared?.disconnect();
      if (current()) { setError(reason instanceof PreparationError ? reason.message : "Couldn't prepare Sendspin. Check the server address and try again."); setPhase("idle"); }
    }
  }, [phase]);
  const join = useCallback(() => {
    if (phase !== "ready" || !client.current) return;
    const attempt = generation.current;
    // This call must retain the click's activation: the adapter unlocks first.
    const connecting = client.current.connectFromGesture();
    setPhase("joining"); setError(null);
    void connecting.then(() => { if (attempt === generation.current) setPhase("joined"); }, () => {
      if (attempt === generation.current) { setError("Couldn't join Sendspin. Leave and try again."); setPhase("ready"); }
    });
  }, [phase]);
  return useMemo(() => ({ phase, state, everConnected, pin, error, server, external, prepare, join, leave,
    volume: (value: number) => client.current?.setVolume(value), mute: (value: boolean) => client.current?.setMuted(value),
    transport: (value: "play" | "pause") => client.current?.transport(value), pair: () => client.current?.openPairingWindow(),
  }), [phase, state, everConnected, pin, error, server, external, prepare, join, leave]);
}

export function SendspinClientDialog({ open, onOpenChange, onCloseAutoFocus }: { open: boolean; onOpenChange: (open: boolean) => void; onCloseAutoFocus?: (event: Event) => void }) {
  const { sendspin, sendspinDisabledReason, connected, rendererTargetId, state, run, nativeHost } = useSessionGate();
  const [destination, setDestination] = useState<"couch" | "external">("couch");
  const [address, setAddress] = useState("");
  const [name, setName] = useState(nativeHost ? "Couch computer" : "Couch browser");
  const localBusy = !!rendererTargetId && state?.targetId === rendererTargetId && !!state.player.playbackId && !["idle", "ended", "error", "unavailable"].includes(state.player.status);
  const idle = sendspin.phase === "idle";
  const waiting = ["preparing", "joining", "leaving"].includes(sendspin.phase);
  const playback = sendspin.state;
  const retryStopped = sendspin.error === sendspinReconnectStopped;
  const transport = playback?.isPlaying ? "pause" : "play";
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent onCloseAutoFocus={onCloseAutoFocus}>
    <DialogHeader><DialogTitle>Sendspin playback</DialogTitle><DialogDescription>Join a server's synchronized audio group on this device.</DialogDescription></DialogHeader>
    {idle ? <form className="grid gap-4" onSubmit={event => { event.preventDefault(); void sendspin.prepare(destination, address, name); }}>
      <RadioGroup aria-label="Sendspin server" value={destination} onValueChange={value => setDestination(value as typeof destination)}>
        <Label className="flex items-center gap-2"><RadioGroupItem value="couch" />This Couch</Label>
        <Label className="flex items-center gap-2"><RadioGroupItem value="external" />Another server</Label>
      </RadioGroup>
      {destination === "external" && <div className="grid gap-2"><Label htmlFor="sendspin-server">Server address</Label><Input id="sendspin-server" value={address} onChange={event => setAddress(event.target.value)} placeholder="wss://music.example/sendspin" autoComplete="url" spellCheck={false} /></div>}
      <div className="grid gap-2"><Label htmlFor="sendspin-client-name">Device name</Label><Input id="sendspin-client-name" value={name} maxLength={80} onChange={event => setName(event.target.value)} /></div>
      {sendspinDisabledReason && <p className="text-sm text-muted-foreground">{sendspinDisabledReason}</p>}
      {localBusy && <div className="grid justify-items-start gap-2"><p className="text-sm text-muted-foreground">Stop playback on this device before joining Sendspin.</p><Button type="button" variant="outline" disabled={!connected} onClick={() => void run({ type: "stop" })}>Stop local playback</Button></div>}
      <Button type="submit" disabled={!connected || !!sendspinDisabledReason || localBusy || !!state?.handoff || destination === "external" && !address.trim()}>Continue</Button>
    </form> : <div className="grid gap-4">
      <p>{sendspin.server ?? "Preparing Sendspin…"}</p>
      {playback?.metadata?.title && <div><p className="font-medium">{playback.metadata.title}</p><p className="text-sm text-muted-foreground">{playback.metadata.artist}</p></div>}
      {sendspin.pin && <div className="grid gap-1"><p>Confirm this pairing code on the Sendspin server.</p><p className="font-mono text-2xl tracking-wider">{sendspin.pin}</p></div>}
      {sendspin.phase === "ready" && <Button disabled={!connected || !!rendererTargetId} onClick={sendspin.join}>Join</Button>}
      {playback?.connected && <div className="grid gap-3 border-t pt-3">
        <div className="flex items-center gap-3"><Slider aria-label="Sendspin volume" defaultValue={[playback.volume]} key={playback.volume} onValueCommit={([value]) => sendspin.volume(value!)} /><Button variant="ghost" onClick={() => sendspin.mute(!playback.muted)}>{playback.muted ? "Unmute" : "Mute"}</Button></div>
        {playback.supportedCommands.includes(transport) && <Button variant="outline" onClick={() => sendspin.transport(transport)}>{transport === "pause" ? "Pause" : "Play"}</Button>}
      </div>}
      {!retryStopped && sendspin.external && (["joining", "joined"].includes(sendspin.phase) || sendspin.pin) && <Button variant="outline" onClick={sendspin.pair}>Open pairing window</Button>}
      {waiting && <p role="status">{sendspin.phase === "joining" ? "Joining…" : sendspin.phase === "leaving" ? "Leaving…" : "Preparing…"}</p>}
      {sendspin.phase === "joined" && !retryStopped && <p role="status">{playback?.connected ? "Connected to Sendspin." : sendspin.everConnected ? "Disconnected. Waiting to reconnect…" : "Waiting for Sendspin connection or pairing…"}</p>}
      <Button variant="ghost" disabled={sendspin.phase === "leaving"} onClick={() => void sendspin.leave()}>Leave Sendspin</Button>
    </div>}
    {sendspin.error && <Alert variant="destructive"><AlertDescription>{sendspin.error}</AlertDescription></Alert>}
  </DialogContent></Dialog>;
}
