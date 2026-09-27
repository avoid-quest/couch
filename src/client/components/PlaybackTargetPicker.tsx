import { Monitor, Speaker } from "lucide-react";
import { Button } from "./ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { useSessionGate } from "../session/session-context";

export function PlaybackTargetPicker() {
  const { state, connected, run, rendererTargetId, playHere, nativeHost } = useSessionGate();
  if (!state?.targets) return null;
  const target = state.targets.find(target => target.id === state.targetId);
  const here = !!rendererTargetId && state.targetId === rendererTargetId;
  return <>
    <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" className="min-w-11" disabled={!connected || !!state.handoff} aria-label="Playback output"><Speaker aria-hidden="true" /><span className="max-sm:hidden">{state.handoff ? "Moving playback…" : here ? nativeHost ? "This computer" : "This browser" : target?.name ?? "Playback output"}</span></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {state.targets.map(target => <DropdownMenuItem key={target.id} disabled={!target.connected || target.id === state.targetId && state.player.status !== "unavailable"} onSelect={() => void run({ type: "selectTarget", targetId: target.id })}>
          <Monitor aria-hidden="true" />{target.id === rendererTargetId ? state.currentEntryId ? "Move playback here" : nativeHost ? "Play on this computer" : "Play in this browser" : `${state.currentEntryId ? "Continue on" : "Play on"} ${target.name}`}{!target.connected ? " (disconnected)" : ""}
        </DropdownMenuItem>)}
      </DropdownMenuContent></DropdownMenu>
    {!nativeHost && here && state.player.requiresGesture && <Button onClick={playHere}>Play here</Button>}
  </>;
}
