import { useMutation } from "@tanstack/react-query";
import type { Action, PlaybackTarget } from "../../shared/protocol";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Slider } from "./ui/slider";

export function PlaybackGroupControls({ target, connected, busy, run, onClose, onCloseAutoFocus }: {
  target: PlaybackTarget; connected: boolean; busy: boolean; run: (action: Action) => Promise<boolean>; onClose: () => void; onCloseAutoFocus?: (event: Event) => void;
}) {
  const update = useMutation({ mutationFn: run });
  const members = target.members ?? [];
  const joined = members.filter(member => member.joined).map(member => member.id);
  const disabled = !connected || !target.connected || busy || update.isPending;
  const membershipDisabled = !connected || busy || update.isPending || !!target.error;
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent onCloseAutoFocus={onCloseAutoFocus}>
    <DialogHeader><DialogTitle>{target.name}</DialogTitle><DialogDescription>Group playback uses estimated progress. Switching outputs waits for buffered audio to finish.</DialogDescription></DialogHeader>
    {!target.connected && <div className="grid justify-items-start gap-2"><p className="text-sm text-muted-foreground">{target.error || "The group is disconnected. Reconnect to try again."}</p><Button variant="outline" disabled={!connected || busy || update.isPending} onClick={() => update.mutate({ type: "groupReconnect", targetId: target.id })}>Reconnect group</Button></div>}
    <div className="divide-y">
      {members.map(member => <div key={member.id} className="grid gap-3 py-3">
        <label className="flex items-center gap-3"><Checkbox aria-label={`Join ${member.name}`} checked={member.joined} disabled={membershipDisabled || !member.connected || (member.joined ? joined.length <= 1 : joined.length >= 32)} onCheckedChange={checked => update.mutate({ type: "groupMembers", targetId: target.id, memberIds: checked ? [...joined, member.id] : joined.filter(id => id !== member.id) })} /><span>{member.name}{!member.connected && <span className="text-muted-foreground"> · Disconnected</span>}</span></label>
        {member.joined && <div className="flex items-center gap-3"><Slider key={`${member.volume}:${member.muted}:${update.isPending}`} aria-label={`${member.name} volume`} defaultValue={[member.volume]} min={0} max={100} step={1} disabled={disabled || !member.connected} onValueCommit={([volume]) => update.mutate({ type: "groupVolume", targetId: target.id, memberId: member.id, volume: volume!, muted: member.muted })} /><Button variant="ghost" disabled={disabled || !member.connected} aria-label={`${member.muted ? "Unmute" : "Mute"} ${member.name}`} onClick={() => update.mutate({ type: "groupVolume", targetId: target.id, memberId: member.id, volume: member.volume, muted: !member.muted })}>{member.muted ? "Unmute" : "Mute"}</Button></div>}
      </div>)}
      {!members.length && <p className="text-sm text-muted-foreground">No speakers available.</p>}
    </div>
  </DialogContent></Dialog>;
}
