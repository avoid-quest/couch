import { useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DeviceSignal, signalOf } from "@/components/DeviceSignal";
import { CouchChoice } from "@/sections/settings/device/CouchChoice";
import { deviceName } from "@/copy";
import { deviceId } from "@/session/device-id";
import type { ClientSessionState, Credentials } from "@/session/session";
import type { Action, DeviceSummary } from "../../../shared/protocol";
import { StatusDot } from "./StatusLine";

type State = ClientSessionState | null | undefined;
const served = (state: State, id: string) => state?.playbacks?.find(playback => playback.outputs.some(output => output.deviceId === id));
// Online Devices first; an offline one only while it still serves a Playback (Settings → Devices lists the rest).
const present = (state: State) => [...state?.devices ?? []].sort((a, b) => Number(b.online) - Number(a.online)).filter(device => device.online || served(state, device.id));

/** What a Device is doing: its Playback's title, "with {name}" when it joins another Device's Playback, Idle or Offline. */
function doing(state: State, device: DeviceSummary) {
  if (!device.online) return "Offline";
  const playback = served(state, device.id);
  if (!playback) return "Idle";
  // A Playback belongs to the Device showing its picture, else to its first Device.
  const lead = (playback.outputs.find(output => output.picture) ?? playback.outputs[0])!.deviceId;
  const leader = lead !== device.id && state?.devices?.find(item => item.id === lead);
  return leader ? `with ${leader.name}` : playback.title ?? "Playing";
}

/**
 * The header's Device switch: the Device this window controls, with "+N" when its Playback spans more
 * Devices; on a narrow header the name truncates, never the count. Its popover lists only Devices, and
 * choosing one controls it, idle ones too. Before pairing it names the Couch this window pairs with.
 */
export function DeviceSwitch({ credentials, connected, status, installationName, paired, state, run }: {
  credentials: Credentials | null; connected: boolean; status: string; installationName?: string; paired: boolean;
  state: State; run: (action: Action) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const self = deviceId(), controlled = state?.controlling ?? self;
  const device = state?.devices?.find(item => item.id === controlled);
  const name = paired ? device?.name ?? "This device" : deviceName(installationName);
  const more = Math.max(0, new Set(served(state, controlled)?.outputs.map(output => output.deviceId)).size - 1);
  const signal = signalOf(state, controlled);
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button variant="ghost" className="min-w-0 shrink gap-2 touch:min-w-11 max-sm:px-2" aria-label={`${name}${more && paired ? ` +${more}` : ""}: ${status}`}>
        {paired ? <DeviceSignal {...signal} online={connected && (device?.online ?? true)} /> : <StatusDot connected={connected} />}
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
            <DeviceSignal {...signalOf(state, item.id)} />
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
    </PopoverContent>}
  </Popover>;
}
