import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { PairingDialog } from "@/components/PairingDialog";
import { useSessionGate } from "@/session/session-context";
import { CouchChoice } from "@/sections/settings/device/CouchChoice";
import { deviceName } from "@/copy";
import type { ClientSessionState, Credentials } from "@/session/session";
import type { DeviceSummary, PlaybackSummary } from "../../../shared/protocol";
import { StatusDot } from "./StatusLine";

type State = ClientSessionState | null | undefined;
export const served = (state: State, id: string) => state?.playbacks?.find(playback => playback.outputs.some(output => output.deviceId === id));

const statusText: Partial<Record<PlaybackSummary["status"], string>> = { loading: "Loading", playing: "Playing", paused: "Paused", ended: "Finished", error: "Can't play" };

/**
 * What a Device is doing: its Playback's title, "with {name}" when it joins another Device's Playback,
 * Idle or Offline. Beside `current` (the Playback in view), another Playback reads "Playing {title}"
 * and the one in view its status, as its title is already on screen.
 */
export function doing(state: State, device: DeviceSummary, current?: string | null) {
  if (!device.online) return "Offline";
  const playback = served(state, device.id);
  if (!playback) return "Idle";
  if (current && playback.id !== current) return `Playing ${playback.title ?? "something else"}`;
  // A Playback belongs to the Device showing its picture, else to its first Device.
  const lead = (playback.outputs.find(output => output.picture) ?? playback.outputs[0])!.deviceId;
  const leader = lead !== device.id && state?.devices?.find(item => item.id === lead);
  return leader ? `with ${leader.name}` : current ? statusText[playback.status] ?? "Playing" : playback.title ?? "Playing";
}

/**
 * The header switches the Couch this window shows. Playback outputs stay in the Mixer.
 * The same Couch choice is available before pairing and in Settings.
 */
export function DeviceSwitch({ credentials, connected, status, installationName }: {
  credentials: Credentials | null; connected: boolean; status: string; installationName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pairing, setPairing] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const { host, remoteControlEnabled } = useSessionGate();
  const canPair = !!host && remoteControlEnabled;
  const name = deviceName(installationName);
  return <><Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button ref={trigger} variant="ghost" className="min-w-0 shrink gap-2 touch:min-w-11 max-sm:px-2" aria-label={`${name}: ${status}`}>
        <StatusDot connected={connected} />
        <span className="max-w-48 truncate max-sm:max-w-32">{name}</span>
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" className="max-h-(--radix-popover-content-available-height) w-96 max-w-[calc(100vw-1rem)] overflow-y-auto [&_[data-slot=field]]:grid-cols-1">
      <CouchChoice credentials={credentials} installationName={installationName} />
      {canPair && <><Separator className="my-1.5" /><Button variant="ghost" className="h-auto w-full justify-start gap-3 px-2.5 py-2 font-normal" onClick={() => { setOpen(false); setPairing(true); }}><Plus aria-hidden="true" />Pair a device</Button></>}
    </PopoverContent>
  </Popover>
  {canPair && <PairingDialog credentials={host} urls={host.urls} connected={connected} open={pairing} onOpenChange={setPairing} openerRef={trigger} />}
  </>;
}
