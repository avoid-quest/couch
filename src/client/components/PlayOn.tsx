import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { ChooseWherePlays } from "./ChooseWherePlays";
import { announcePlay, deviceId } from "@/session/device-id";
import { useOptionalSessionGate } from "@/session/session-context";
import { playOnTargets } from "@/session/where-it-plays";
import { playbackControls } from "@/session/playback-controls";
import { isTvPresentation } from "@/session/presentation";
import type { PlayOn } from "../../shared/protocol";

/** Where an item can play: the online Devices, this window's first, and where Play goes. */
export function usePlayOn(sharingDeviceId?: string, liveAudio = false) {
  const session = useOptionalSessionGate();
  const state = session?.state;
  const here = deviceId();
  const target =
    state?.controlling && state.controlling !== here
      ? state.devices?.find((device) => device.id === state.controlling)
      : undefined;
  return {
    devices: playOnTargets(state, here).filter(
      (device) =>
        !liveAudio ||
        (device.id !== sharingDeviceId && (device.id === here || device.sharing?.audio)),
    ),
    here,
    queueAllowed: playbackControls(state).queue,
    /** A Play label that names the controlled Device when Play goes elsewhere: "Play on Studio". */
    on: (label: string) => (target ? `${label} on ${target.name}` : label),
    /** Plays, with Play on's choice passed to `work` for its request, then says where it plays. */
    play: async <T,>(work: (on?: PlayOn) => Promise<T>, on?: PlayOn) => {
      const result = await work(on);
      if (result !== false) announcePlay(state, on?.deviceId);
      return result;
    },
  };
}

/**
 * Where a plain Play or Resume goes, as the destination beside it says it: the controlled Playback's devices, its
 * picture's first ("on Living room TV +1"), else the controlled device; and what plays there now, which makes way.
 */
export function usePlayDestination() {
  const state = useOptionalSessionGate()?.state;
  const here = deviceId();
  const outputs = state?.outputs ?? [];
  const first = outputs.find((output) => output.picture) ?? outputs[0];
  const id = first?.deviceId ?? state?.controlling ?? here;
  const name =
    id === here
      ? isTvPresentation()
        ? "this TV"
        : "this device"
      : (state?.devices?.find((device) => device.id === id)?.name ?? "another device");
  const playback = state?.playbacks?.find((item) => item.id === state.playback);
  const current = state?.queue.find((entry) => entry.id === state.currentEntryId);
  const busy = !!playback && ["loading", "playing", "paused"].includes(playback.status);
  return {
    label: `on ${name}${outputs.length > 1 ? ` +${outputs.length - 1}` : ""}`,
    playing: busy ? current : undefined,
  };
}

/** Play on for a REST play request: Core isolates that Device, or starts where it was chosen, as it reserves the play. */
export const playOnQuery = (on?: PlayOn) => {
  if (!on?.deviceId) return "";
  const query = new URLSearchParams({ on: on.deviceId });
  for (const output of on.outputs ?? []) {
    if (output.picture) query.append("picture", output.deviceId);
    if (output.sound) query.append("sound", output.deviceId);
  }
  return `?${query}`;
};

// sharingDeviceId: a shared source's publisher. It never plays its own capture: choosing it opens Where it plays.
function Devices({
  onPlay,
  disabled,
  sharingDeviceId,
  liveAudio,
}: {
  onPlay: (deviceId: string) => void;
  disabled?: boolean;
  sharingDeviceId?: string;
  liveAudio?: boolean;
}) {
  const { devices, here } = usePlayOn(sharingDeviceId, liveAudio);
  return devices.map((device) => (
    <DropdownMenuItem
      key={device.id}
      disabled={disabled}
      className="flex-col items-start gap-0.5"
      onSelect={() => onPlay(device.id)}
    >
      <span className="w-full break-words">{device.name}</span>
      {(device.id === here || device.id === sharingDeviceId) && (
        <span className="text-xs text-muted-foreground in-data-highlighted:text-accent-foreground">
          {[
            device.id === here && "This device",
            device.id === sharingDeviceId && "Sharing this source",
          ]
            .filter(Boolean)
            .join(", ")}
        </span>
      )}
    </DropdownMenuItem>
  ));
}

/** A shared source's "Play on" inside its menu: it plays at once on the Device chosen. Nothing when only this Device is online. */
export function PlayOnGroup({
  onPlay,
  disabled,
  sharingDeviceId,
  separated = true,
  liveAudio,
}: {
  onPlay: (deviceId: string) => void;
  disabled?: boolean;
  sharingDeviceId?: string;
  separated?: boolean;
  liveAudio?: boolean;
}) {
  if (!usePlayOn(sharingDeviceId, liveAudio).devices.length) return null;
  return (
    <>
      {separated && <DropdownMenuSeparator />}
      <DropdownMenuGroup aria-label="Play on">
        <DropdownMenuLabel>Play on</DropdownMenuLabel>
        <Devices
          onPlay={onPlay}
          disabled={disabled}
          sharingDeviceId={sharingDeviceId}
          liveAudio={liveAudio}
        />
      </DropdownMenuGroup>
    </>
  );
}

/** "Play on…" beside a row's inline verbs: it opens Choose where it plays from itself. */
export function PlayOnMenu({
  title,
  thumbnail,
  verb,
  audioOnly,
  onPlay,
  disabled,
  size,
}: {
  title: string;
  thumbnail?: string;
  /** Play's word in the panel, "Resume" for an item partly played. */
  verb?: string;
  audioOnly?: boolean;
  onPlay: (on: PlayOn) => void;
  disabled?: boolean;
  size?: "default" | "lg";
}) {
  const [open, setOpen] = useState(false);
  if (!usePlayOn().devices.length) return null;
  return (
    <ChooseWherePlays
      title={title}
      thumbnail={thumbnail}
      verb={verb}
      audioOnly={audioOnly}
      onPlay={onPlay}
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="ghost" size={size} disabled={disabled} aria-label={`Play ${title} on…`}>
          Play on…
        </Button>
      }
    />
  );
}
