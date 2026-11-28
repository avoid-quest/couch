import { useRef, useState, useSyncExternalStore, type ComponentProps, type RefObject } from "react";
import { ChevronDown, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { MenuPanel } from "./MenuPanel";
import { PlaceRows, type PlaceItem } from "./PlayOnPlaces";
import { isDesktop, subscribeDesktop } from "@/sections/shell/Outputs";
import { announcePlay, deviceId } from "@/session/device-id";
import { useOptionalSessionGate } from "@/session/session-context";
import { playOnTargets } from "@/session/where-it-plays";
import { playbackControls } from "@/session/playback-controls";
import { isTvPresentation } from "@/session/presentation";
import { cn } from "@/lib/utils";
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
    /**
     * Plays, with Play on's choice passed to `work` for its request, then says where it plays; a place from Play on's
     * list (which names its channels) says it itself, with its Undo.
     */
    play: async <T,>(work: (on?: PlayOn) => Promise<T>, on?: PlayOn) => {
      const result = await work(on);
      if (result !== false && !on?.outputs) announcePlay(state, on?.deviceId);
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
  sheet,
}: {
  onPlay: (deviceId: string) => void;
  disabled?: boolean;
  sharingDeviceId?: string;
  liveAudio?: boolean;
  sheet?: boolean;
}) {
  const { devices, here } = usePlayOn(sharingDeviceId, liveAudio);
  return devices.map((device) => {
    const content = (
      <>
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
      </>
    );
    return sheet ? (
      <Button
        key={device.id}
        variant="ghost"
        disabled={disabled}
        className="h-auto min-h-11 w-full flex-col items-start justify-center gap-0.5 rounded-md px-2 py-2 text-left font-normal whitespace-normal"
        onClick={() => onPlay(device.id)}
      >
        {content}
      </Button>
    ) : (
      <DropdownMenuItem
        key={device.id}
        disabled={disabled}
        className="flex-col items-start gap-0.5"
        onSelect={() => onPlay(device.id)}
      >
        {content}
      </DropdownMenuItem>
    );
  });
}

/** A shared source's "Play on" inside its menu: it plays at once on the Device chosen. Nothing when only this Device is online. */
export function PlayOnGroup({
  onPlay,
  disabled,
  sharingDeviceId,
  separated = true,
  liveAudio,
  sheet,
}: {
  onPlay: (deviceId: string) => void;
  disabled?: boolean;
  sharingDeviceId?: string;
  separated?: boolean;
  liveAudio?: boolean;
  /** Drawn in a phone's menu Sheet instead of a DropdownMenu. */
  sheet?: boolean;
}) {
  if (!usePlayOn(sharingDeviceId, liveAudio).devices.length) return null;
  if (sheet)
    return (
      <div
        role="group"
        aria-label="Play on"
        className={cn("grid", separated && "border-t pt-1 mt-1")}
      >
        <p className="px-2 py-1.5 text-xs text-muted-foreground">Play on</p>
        <Devices
          onPlay={onPlay}
          disabled={disabled}
          sharingDeviceId={sharingDeviceId}
          liveAudio={liveAudio}
          sheet
        />
      </div>
    );
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

/** A shared source's devices when its menu has no room for them all (docs/design.md "Menus"): it plays at once on the one chosen. */
export function ChooseDevice({
  title,
  onPlay,
  onClose,
  anchor,
  sharingDeviceId,
  liveAudio,
}: {
  title: string;
  onPlay: (deviceId: string) => void;
  onClose: () => void;
  anchor: RefObject<HTMLElement | null>;
  sharingDeviceId?: string;
  liveAudio?: boolean;
}) {
  return (
    <MenuPanel title={`Play ${title} on`} anchor={anchor} onClose={onClose}>
      <div role="group" aria-label="Play on" className="grid">
        <Devices
          sheet
          sharingDeviceId={sharingDeviceId}
          liveAudio={liveAudio}
          onPlay={(id) => {
            onClose();
            onPlay(id);
          }}
        />
      </div>
    </MenuPanel>
  );
}

/**
 * A Stage's main verb with where it plays (docs/design.md "Stage"): Play or Resume beside its destination ("on this
 * device"), which opens Play on's list of places from it. Without another device that can play it, the verb stands
 * alone.
 */
export function PlayPill({
  label,
  title,
  detail,
  thumbnail,
  verb,
  audioOnly,
  disabled,
  onClick,
  playOn,
  playOnDisabled,
  size,
  ...props
}: {
  label: string;
  /** What plays, for Play on's list and Choose where it plays. */
  title: string;
  detail?: string;
  thumbnail?: string;
  verb?: string;
  audioOnly?: boolean;
  disabled?: boolean;
  onClick: () => void;
  playOn?: (on: PlayOn) => void;
  playOnDisabled?: boolean;
  size?: "default" | "lg";
} & Omit<ComponentProps<typeof Button>, "onClick" | "size">) {
  const [open, setOpen] = useState(false);
  const { devices } = usePlayOn();
  const destination = usePlayDestination();
  const desktop = useSyncExternalStore(subscribeDesktop, isDesktop, () => false);
  const trigger = useRef<HTMLButtonElement>(null);
  // Choose where it plays takes the focus as the list hands off to it, so the list doesn't return it to its control.
  const handedOff = useRef(false);
  const button = (
    <Button
      ref={trigger}
      variant="ghost"
      size={size}
      disabled={disabled || playOnDisabled}
      aria-haspopup="menu"
      aria-label={`${verb === "Resume" ? "Resume on" : "Play on"}. Now: ${destination.label}`}
      title={verb === "Resume" ? "Resume on" : "Play on"}
      className="min-w-0 pr-3 pl-3"
    >
      <span className="truncate">{destination.label}</span>
      <ChevronDown aria-hidden="true" className="text-muted-foreground" />
    </Button>
  );
  const list = playOn && (
    <PlaceMenu
      item={{ title, detail, thumbnail, verb, audioOnly, onPlay: playOn }}
      from={() => trigger.current}
      onDone={(handOff) => {
        handedOff.current = !!handOff;
        setOpen(false);
      }}
    />
  );
  return (
    <span className="inline-flex max-w-full min-w-0 rounded-full bg-secondary">
      <Button size={size} disabled={disabled} onClick={onClick} {...props}>
        <Play aria-hidden="true" className="fill-current" />
        {label}
      </Button>
      {playOn &&
        devices.length > 0 &&
        (desktop || isTvPresentation() ? (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>{button}</PopoverTrigger>
            {open && (
              <PopoverContent
                align="start"
                side="bottom"
                collisionPadding={12}
                aria-label={verb === "Resume" ? "Resume on" : "Play on"}
                onCloseAutoFocus={(event) => {
                  if (handedOff.current) event.preventDefault();
                  handedOff.current = false;
                }}
                className="max-h-[min(34rem,var(--radix-popover-content-available-height))] w-[19rem] gap-0 overflow-y-auto p-1.5"
              >
                {list}
              </PopoverContent>
            )}
          </Popover>
        ) : (
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>{button}</SheetTrigger>
            <SheetContent
              side="bottom"
              aria-describedby={undefined}
              onCloseAutoFocus={(event) => {
                if (handedOff.current) event.preventDefault();
                handedOff.current = false;
              }}
              className="max-h-[calc(100dvh-4rem)] gap-0 overflow-y-auto rounded-t-[1.75rem] px-2.5 pt-4.5 pb-4"
            >
              <SheetTitle className="sr-only">
                {verb === "Resume" ? "Resume on" : "Play on"}
              </SheetTitle>
              {list}
            </SheetContent>
          </Sheet>
        ))}
    </span>
  );
}

/** Play on's list as buttons, in a Popover or a Sheet. */
function PlaceMenu({
  item,
  from,
  onDone,
}: {
  item: PlaceItem;
  from: () => HTMLElement | null;
  onDone: (handOff?: boolean) => void;
}) {
  return (
    <div role="menu" className="grid">
      <PlaceRows
        item={item}
        from={from}
        onDone={onDone}
        heading={(text) => (
          <p key="heading" className="flex h-9 items-center px-3 text-meta text-subtle-foreground">
            {text}
          </p>
        )}
        separator={(key) => <Separator key={`separator:${key}`} className="my-1.5" />}
        row={(key, onSelect, children) => (
          <Button
            key={key}
            role="menuitem"
            variant="ghost"
            onClick={onSelect}
            className="h-auto min-h-9 w-full min-w-0 justify-start overflow-hidden rounded-[0.7rem] px-3 py-1 text-left font-normal text-foreground hover:bg-accent touch:min-h-12"
          >
            {children}
          </Button>
        )}
      />
    </div>
  );
}
