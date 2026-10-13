import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { announcePlay, deviceId } from "@/session/device-id";
import { useOptionalSessionGate } from "@/session/session-context";

/** Where an item can play: the online Devices, this window's first, and where Play goes. */
export function usePlayOn() {
  const session = useOptionalSessionGate();
  const state = session?.state;
  const here = deviceId();
  const online = (state?.devices ?? []).filter(device => device.online && (device.id === here || device.sharing?.audio || device.sharing?.video)).sort((a, b) => Number(b.id === here) - Number(a.id === here));
  const target = state?.controlling && state.controlling !== here ? state.devices?.find(device => device.id === state.controlling) : undefined;
  return {
    // With only this Device online, Play on would repeat Play.
    devices: online.length > 1 ? online : [],
    here,
    /** A Play label that names the controlled Device when Play goes elsewhere: "Play on Studio". */
    on: (label: string) => target ? `${label} on ${target.name}` : label,
    /** Plays, with Play on's Device passed to `work` for its request, then says where it plays. */
    play: async <T,>(work: (on?: string) => Promise<T>, id?: string) => {
      const result = await work(id);
      if (result !== false) announcePlay(state, id);
      return result;
    },
  };
}

/** Play on for a REST play request: Core isolates that Device when it reserves the play. */
export const playOnQuery = (on?: string) => on ? `?on=${encodeURIComponent(on)}` : "";

// sharingDeviceId: a shared source's publisher, listed with its status because it never plays its own capture.
function Devices({ onPlay, disabled, sharingDeviceId }: { onPlay: (deviceId: string) => void; disabled?: boolean; sharingDeviceId?: string }) {
  const { devices, here } = usePlayOn();
  return devices.map(device => <DropdownMenuItem key={device.id} disabled={disabled || device.id === sharingDeviceId} className="flex-col items-start gap-0.5" onSelect={() => onPlay(device.id)}>
    <span className="w-full break-words">{device.name}</span>{(device.id === here || device.id === sharingDeviceId) && <span className="text-xs text-muted-foreground in-data-highlighted:text-accent-foreground">{[device.id === here && "This device", device.id === sharingDeviceId && "Sharing this source"].filter(Boolean).join(" · ")}</span>}
  </DropdownMenuItem>);
}

/** "Play on" inside an item's menu; nothing when only this Device is online. */
export function PlayOnGroup({ onPlay, disabled, sharingDeviceId }: { onPlay: (deviceId: string) => void; disabled?: boolean; sharingDeviceId?: string }) {
  if (!usePlayOn().devices.some(device => device.id !== sharingDeviceId)) return null;
  return <><DropdownMenuSeparator /><DropdownMenuGroup aria-label="Play on"><DropdownMenuLabel>Play on</DropdownMenuLabel><Devices onPlay={onPlay} disabled={disabled} sharingDeviceId={sharingDeviceId} /></DropdownMenuGroup></>;
}

/** "Play on" beside a row's inline verbs. */
export function PlayOnMenu({ title, onPlay, disabled, sharingDeviceId }: { title: string; onPlay: (deviceId: string) => void; disabled?: boolean; sharingDeviceId?: string }) {
  if (!usePlayOn().devices.some(device => device.id !== sharingDeviceId)) return null;
  return <DropdownMenu modal={false}><DropdownMenuTrigger asChild><Button variant="ghost" disabled={disabled} aria-label={`Play ${title} on`}>Play on</Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end"><Devices onPlay={onPlay} sharingDeviceId={sharingDeviceId} /></DropdownMenuContent>
  </DropdownMenu>;
}
