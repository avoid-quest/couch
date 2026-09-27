import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { Action, PlaybackTarget } from "../../shared/protocol";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Slider } from "./ui/slider";

export function PlaybackGroupControls({ target, connected, busy, canPair = false, run, onClose, onCloseAutoFocus }: {
  target: PlaybackTarget; connected: boolean; busy: boolean; canPair?: boolean; run: (action: Action) => Promise<boolean>; onClose: () => void; onCloseAutoFocus?: (event: Event) => void;
}) {
  const [pin, setPin] = useState("");
  const update = useMutation({ mutationFn: run });
  const members = target.members ?? [];
  const joined = members.filter(member => member.joined).map(member => member.id);
  const sendspin = target.backend === "sendspin";
  const disabled = !connected || busy || update.isPending || !target.connected && (!sendspin || !!target.error);
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent onCloseAutoFocus={onCloseAutoFocus}>
    <DialogHeader><DialogTitle>{target.name}</DialogTitle><DialogDescription>{target.handoffSafety === "unverified" ? "Group playback uses estimated progress. Stop playback before switching outputs; this group has not confirmed a safe switching delay." : "Group playback uses estimated progress. Switching outputs waits for buffered audio to finish."}</DialogDescription></DialogHeader>
    {!target.connected && <div className="grid justify-items-start gap-2"><p className="text-sm text-muted-foreground">{target.error || (sendspin && members.some(member => member.connected) ? "Pair a speaker, then add it to this group." : "The group is disconnected. Reconnect to try again.")}</p><Button variant="outline" disabled={!connected || busy || update.isPending} onClick={() => update.mutate({ type: "groupReconnect", targetId: target.id })}>Reconnect group</Button></div>}
    <div className="divide-y">
      {members.map(member => <div key={member.id} className="grid gap-3 py-3">
        <label className="flex items-center gap-3"><Checkbox aria-label={`Join ${member.name}`} checked={member.joined} disabled={disabled || !member.connected || member.paired === false || (member.joined ? joined.length <= 1 : joined.length >= 32)} onCheckedChange={checked => update.mutate({ type: "groupMembers", targetId: target.id, memberIds: checked ? [...joined, member.id] : joined.filter(id => id !== member.id) })} /><span>{member.name}{!member.connected && <span className="text-muted-foreground"> · Disconnected</span>}</span></label>
        {sendspin && member.paired === false && <div className="grid justify-items-start gap-2">
          {!canPair ? <p className="text-sm text-muted-foreground">An administrator can pair this speaker.</p> : target.pairing?.clientId === member.id ? <>
            {target.pairing.stage === "pin" ? <form className="grid w-full gap-2" onSubmit={event => { event.preventDefault(); if (!disabled && member.connected && /^[0-9]{6,12}$/.test(pin)) { update.mutate({ type: "groupPair", targetId: target.id, memberId: member.id, pin }); setPin(""); } }}>
              <label className="grid gap-2 text-sm">PIN shown on {member.name}<Input aria-label={`PIN shown on ${member.name}`} inputMode="numeric" autoComplete="one-time-code" value={pin} maxLength={12} disabled={disabled || !member.connected} onChange={event => setPin(event.target.value.replace(/[^0-9]/g, ""))} /></label>
              <Button className="justify-self-start" type="submit" disabled={disabled || !member.connected || !/^[0-9]{6,12}$/.test(pin)}>Confirm pairing</Button>
            </form> : <p className="text-sm text-muted-foreground">Waiting for {member.name}…</p>}
            <Button variant="ghost" disabled={!connected || busy || update.isPending} onClick={() => { setPin(""); update.mutate({ type: "groupPairCancel", targetId: target.id, memberId: member.id }); }}>Cancel pairing</Button>
          </> : member.methods?.includes("dynamic_pin") ? <Button variant="outline" disabled={disabled || !member.connected || !!target.pairing} onClick={() => { setPin(""); update.mutate({ type: "groupPair", targetId: target.id, memberId: member.id }); }}>Pair {member.name}</Button> : <p className="text-sm text-muted-foreground">This speaker does not offer PIN pairing.</p>}
        </div>}
        {member.joined && <div className="flex items-center gap-3"><Slider key={`${member.volume}:${member.muted}:${update.isPending}`} aria-label={`${member.name} volume`} defaultValue={[member.volume]} min={0} max={100} step={1} disabled={disabled || !member.connected} onValueCommit={([volume]) => update.mutate({ type: "groupVolume", targetId: target.id, memberId: member.id, volume: volume!, muted: member.muted })} /><Button variant="ghost" disabled={disabled || !member.connected} aria-label={`${member.muted ? "Unmute" : "Mute"} ${member.name}`} onClick={() => update.mutate({ type: "groupVolume", targetId: target.id, memberId: member.id, volume: member.volume, muted: !member.muted })}>{member.muted ? "Unmute" : "Mute"}</Button></div>}
      </div>)}
      {!members.length && <p className="text-sm text-muted-foreground">No speakers available.</p>}
    </div>
  </DialogContent></Dialog>;
}
