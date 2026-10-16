import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { announcePlay, deviceId } from "@/session/device-id";
import { useOptionalSessionGate } from "@/session/session-context";
import { playOnTargets } from "@/session/where-it-plays";
import type { MenuParts } from "./RowMenu";

/** Where an item can play: the online Devices, this window's first, and where Play goes. */
export function usePlayOn() {
  const session = useOptionalSessionGate();
  const state = session?.state;
  const here = deviceId();
  const target = state?.controlling && state.controlling !== here ? state.devices?.find(device => device.id === state.controlling) : undefined;
  return {
    devices: playOnTargets(state, here),
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

// sharingDeviceId: a shared source's publisher. It never plays its own capture: choosing it opens Where it plays.
function Devices({ onPlay, disabled, sharingDeviceId, Item = DropdownMenuItem }: { onPlay: (deviceId: string) => void; disabled?: boolean; sharingDeviceId?: string; Item?: MenuParts["Item"] }) {
  const { devices, here } = usePlayOn();
  return devices.map(device => <Item key={device.id} disabled={disabled} className="flex-col items-start gap-0.5" onSelect={() => onPlay(device.id)}>
    <span className="w-full break-words">{device.name}</span>{(device.id === here || device.id === sharingDeviceId) && <span className="text-xs text-muted-foreground in-data-highlighted:text-accent-foreground">{[device.id === here && "This device", device.id === sharingDeviceId && "Sharing this source"].filter(Boolean).join(" · ")}</span>}
  </Item>);
}

/** "Play on" inside an item's menu, a dropdown's or a row's context menu; nothing when only this Device is online. */
export function PlayOnGroup({ onPlay, disabled, sharingDeviceId, parts: { Item, Group, Label, Separator } = { Item: DropdownMenuItem, Group: DropdownMenuGroup, Label: DropdownMenuLabel, Separator: DropdownMenuSeparator } }: { onPlay: (deviceId: string) => void; disabled?: boolean; sharingDeviceId?: string; parts?: MenuParts }) {
  if (!usePlayOn().devices.length) return null;
  return <><Separator /><Group aria-label="Play on"><Label>Play on</Label><Devices Item={Item} onPlay={onPlay} disabled={disabled} sharingDeviceId={sharingDeviceId} /></Group></>;
}

/** "Play on" beside a row's inline verbs. */
export function PlayOnMenu({ title, onPlay, disabled, sharingDeviceId, size }: { title: string; onPlay: (deviceId: string) => void; disabled?: boolean; sharingDeviceId?: string; size?: "default" | "lg" }) {
  if (!usePlayOn().devices.length) return null;
  return <DropdownMenu modal={false}><DropdownMenuTrigger asChild><Button variant="ghost" size={size} disabled={disabled} aria-label={`Play ${title} on`}>Play on</Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end"><Devices onPlay={onPlay} sharingDeviceId={sharingDeviceId} /></DropdownMenuContent>
  </DropdownMenu>;
}
