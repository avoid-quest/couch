import { useRef, useState } from "react";
import { Check, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { PairingDialog } from "@/components/PairingDialog";
import { useSessionGate } from "@/session/session-context";
import { DeviceIcon, signalOf } from "@/components/DeviceIcon";
import { CouchChoice } from "@/sections/settings/device/CouchChoice";
import { deviceName } from "@/copy";
import { deviceId } from "@/session/device-id";
import type { ClientSessionState, Credentials } from "@/session/session";
import type { Action, DeviceSummary, PlaybackSummary } from "../../../shared/protocol";
import { StatusDot } from "./StatusLine";

type State = ClientSessionState | null | undefined;
export const served = (state: State, id: string) => state?.playbacks?.find(playback => playback.outputs.some(output => output.deviceId === id));
// Online Devices first; an offline one only while it still serves a Playback (Settings → Devices lists the rest).
const present = (state: State) => [...state?.devices ?? []].sort((a, b) => Number(b.online) - Number(a.online)).filter(device => device.online || served(state, device.id));

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
 * The header's Device switch: the Device this window controls, with "+N" when its Playback spans more
 * Devices; on a narrow header the name truncates, never the count. Its popover lists Devices, and
 * choosing one controls it, idle ones too. On the host with sharing on, it ends with Pair a device.
 * Before pairing it names the Couch this window pairs with.
 */
export function DeviceSwitch({ credentials, connected, status, installationName, paired, state, run }: {
  credentials: Credentials | null; connected: boolean; status: string; installationName?: string; paired: boolean;
  state: State; run: (action: Action) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [pairing, setPairing] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const { host, remoteControlEnabled } = useSessionGate();
  const canPair = !!host && remoteControlEnabled;
  const self = deviceId(), controlled = state?.controlling ?? self;
  const device = state?.devices?.find(item => item.id === controlled);
  const name = paired ? device?.name ?? "This device" : deviceName(installationName);
  const more = Math.max(0, new Set(served(state, controlled)?.outputs.map(output => output.deviceId)).size - 1);
  const signal = signalOf(state, controlled);
  return <><Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button ref={trigger} variant="ghost" className="min-w-0 shrink gap-2 touch:min-w-11 max-sm:px-2" aria-label={`${name}${more && paired ? ` +${more}` : ""}: ${status}`}>
        {paired ? <DeviceIcon {...signal} online={connected && (device?.online ?? true)} /> : <StatusDot connected={connected} />}
        <span className="flex min-w-0 max-w-48 gap-1 max-sm:max-w-32"><span className="truncate">{name}</span>{paired && !!more && <span className="shrink-0">+{more}</span>}</span>
      </Button>
    </PopoverTrigger>
    {/* Before pairing Settings is out of reach, so the Couch choice stays here, one column wide. */}
    {!paired ? <PopoverContent align="end" className="max-h-(--radix-popover-content-available-height) w-96 overflow-y-auto [&_[data-slot=field]]:grid-cols-1">
      <CouchChoice credentials={credentials} installationName={installationName} />
    </PopoverContent>
    : <PopoverContent align="end" className="max-h-(--radix-popover-content-available-height) w-80 gap-0 overflow-y-auto p-1.5">
      <div role="group" aria-label="Devices" className="grid">
        {present(state).map(item => {
          const chosen = item.id === controlled;
          const row = <>
            <DeviceIcon {...signalOf(state, item.id)} />
            <span className="grid min-w-0 flex-1 text-left">
              <span className="flex min-w-0 items-baseline gap-2"><span className="truncate">{item.name}</span>{item.id === self && <span className="shrink-0 text-xs text-muted-foreground">This device</span>}</span>
              <span className="truncate text-xs text-muted-foreground">{doing(state, item)}</span>
            </span>
            {chosen && <Check aria-hidden="true" />}
          </>;
          return item.online
            ? <Button key={item.id} variant="ghost" aria-pressed={chosen} className="h-auto w-full justify-start gap-3 px-2.5 py-2 font-normal" onClick={() => { setOpen(false); if (!chosen) void run({ type: "control", deviceId: item.id }); }}>{row}</Button>
            : <div key={item.id} className="flex items-center gap-3 border border-transparent px-2.5 py-2 text-muted-foreground">{row}</div>;
        })}
        {!state?.devices?.length && <p role="status" className="px-2.5 py-2 text-muted-foreground">{status}</p>}
      </div>
      {canPair && <><Separator className="my-1.5" /><Button variant="ghost" className="h-auto w-full justify-start gap-3 px-2.5 py-2 font-normal" onClick={() => { setOpen(false); setPairing(true); }}><Plus aria-hidden="true" />Pair a device</Button></>}
    </PopoverContent>}
  </Popover>
  {canPair && <PairingDialog credentials={host} urls={host.urls} connected={connected} open={pairing} onOpenChange={setPairing} openerRef={trigger} />}
  </>;
}
