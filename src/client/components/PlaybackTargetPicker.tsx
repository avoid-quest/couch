import { useRef, useState } from "react";
import { PlaybackGroupControls } from "./PlaybackGroupControls";
import { Monitor, Speaker } from "lucide-react";
import { Button } from "./ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { useSessionGate } from "../session/session-context";

export function PlaybackTargetPicker() {
  const { state, connected, run, rendererTargetId, playHere, nativeHost, sessionMode = "household", selectSession } = useSessionGate();
  const [groupId, setGroupId] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  if (!state?.targets) return null;
  const group = state.targets.find(target => target.id === groupId && target.kind === "group");
  const target = state.targets.find(target => target.id === state.targetId);
  const here = !!rendererTargetId && state.targetId === rendererTargetId;
  return <>
    <DropdownMenu><DropdownMenuTrigger asChild><Button ref={trigger} variant="ghost" className="min-w-11" disabled={!connected || !!state.handoff} aria-label="Playback output"><Speaker aria-hidden="true" /><span className="max-sm:hidden">{state.handoff ? "Moving playback…" : here ? nativeHost ? "This computer" : "This browser" : target?.name ?? "Playback output"}</span></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end" onCloseAutoFocus={event => { if (groupId) event.preventDefault(); }}>
        {state.targets.map(target => <DropdownMenuItem key={target.id} disabled={!target.connected || !!target.occupied || target.id === state.targetId && state.player.status !== "unavailable"} onSelect={() => void run({ type: "selectTarget", targetId: target.id })}>
          <Monitor aria-hidden="true" />{target.id === rendererTargetId ? state.currentEntryId ? "Move playback here" : nativeHost ? "Play on this computer" : "Play in this browser" : `${state.currentEntryId ? "Continue on" : "Play on"} ${target.name}`}{!target.connected ? " (disconnected)" : ""}
        </DropdownMenuItem>)}
        {selectSession && sessionMode !== "personal" && rendererTargetId && <DropdownMenuItem onSelect={() => selectSession("personal", true)}>Play independently here</DropdownMenuItem>}
        {selectSession && sessionMode === "personal" && <DropdownMenuItem onSelect={() => selectSession("household")}>Control household</DropdownMenuItem>}
        {state.targets.filter(target => target.connected && target.occupied).map(target => target.kind === "group" && target.sessionKind === "household"
          ? selectSession && <DropdownMenuItem key={`join:${target.id}`} onSelect={() => selectSession("household")}>Join {target.name}</DropdownMenuItem>
          : <DropdownMenuItem key={`takeover:${target.id}`} onSelect={() => void run({ type: "selectTarget", targetId: target.id, takeover: true })}>Take over {target.name}</DropdownMenuItem>)}
        {state.targets.filter(target => target.kind === "group" && !target.occupied && ["snapcast", "sendspin"].includes(target.backend)).map(target => <DropdownMenuItem key={`manage:${target.id}`} disabled={!connected} onSelect={() => setGroupId(target.id)}>Manage {target.name}</DropdownMenuItem>)}
      </DropdownMenuContent></DropdownMenu>
    {group && <PlaybackGroupControls key={group.id} target={group} connected={connected} busy={!!state.handoff} run={run} onClose={() => setGroupId(null)} onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus(); }} />}
    {!nativeHost && here && state.player.requiresGesture && <Button onClick={playHere}>Play here</Button>}
  </>;
}
