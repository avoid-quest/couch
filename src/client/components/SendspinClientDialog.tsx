import { useState } from "react";
import { sendspinReconnectStopped } from "@/session/sendspin-renderer";
import { useSessionGate } from "@/session/session-context";
import { clientDeviceName } from "@/session/device-name";
export { useSendspinClient } from "@/session/external-audio";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Slider } from "./ui/slider";

export function SendspinClientDialog({ open, onOpenChange, onCloseAutoFocus }: { open: boolean; onOpenChange: (open: boolean) => void; onCloseAutoFocus?: (event: Event) => void }) {
  const { connected, identity, externalAudio: sendspin } = useSessionGate();
  const [address, setAddress] = useState("");
  const idle = sendspin.phase === "idle";
  const waiting = ["preparing", "joining", "leaving"].includes(sendspin.phase);
  const playback = sendspin.state;
  const retryStopped = sendspin.error === sendspinReconnectStopped;
  const transport = playback?.isPlaying ? "pause" : "play";
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent onCloseAutoFocus={onCloseAutoFocus}>
    <DialogHeader><DialogTitle>Other audio server</DialogTitle><DialogDescription>Connect this device to another Sendspin server on your home network.</DialogDescription></DialogHeader>
    {idle ? <form className="grid gap-4" onSubmit={event => { event.preventDefault(); void sendspin.prepare(address, clientDeviceName(identity?.controller?.name)); }}>
      <div className="grid gap-2"><Label htmlFor="sendspin-server">Server address</Label><Input id="sendspin-server" value={address} onChange={event => setAddress(event.target.value)} placeholder="ws://music.local:8927/sendspin" autoComplete="url" spellCheck={false} /></div>
      <Button type="submit" disabled={!connected || !address.trim()}>Continue</Button>
    </form> : <div className="grid gap-4">
      <p>{sendspin.server ?? "Preparing Sendspin…"}</p>
      {playback?.metadata?.title && <div><p className="font-medium">{playback.metadata.title}</p><p className="text-sm text-muted-foreground">{playback.metadata.artist}</p></div>}
      {sendspin.pin && <div className="grid gap-1"><p>Confirm this pairing code on the Sendspin server.</p><p className="font-mono text-2xl tracking-wider">{sendspin.pin}</p></div>}
      {sendspin.phase === "ready" && <Button disabled={!connected} onClick={sendspin.join}>Connect</Button>}
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
