import { useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { Monitor, MonitorOff, Play, Volume2, VolumeOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Toggle } from "@/components/ui/toggle";
import { isDesktop, subscribeDesktop } from "@/sections/shell/Outputs";
import { deviceId } from "@/session/device-id";
import { isTvPresentation } from "@/session/presentation";
import { useOptionalSessionGate } from "@/session/session-context";
import {
  choiceRows,
  choiceSummary,
  firstChoice,
  offlineNames,
  onlyChoice,
  playOnOf,
  type Choice,
  type ChoiceRow,
} from "@/session/where-it-plays";
import type { PlayOn } from "../../shared/protocol";

type Props = {
  /** The item it plays, under the panel's title. */
  title: string;
  audioOnly?: boolean;
  onPlay: (on: PlayOn) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The control that opens it, or, when a menu opened it, the element it opens from. */
  trigger?: ReactNode;
  anchor?: RefObject<HTMLElement | null>;
};

/**
 * Choose where it plays: Play on's panel, the Mixer's rows for something that hasn't started. Nothing plays until
 * Play, and the line beside it says what that changes; a press on a device's name still plays there at once.
 * It opens from its control: a Popover on desktop and the TV, a Sheet rising from below on phones.
 */
export function ChooseWherePlays({
  title,
  audioOnly,
  onPlay,
  open,
  onOpenChange,
  trigger,
  anchor,
}: Props) {
  const tv = isTvPresentation();
  const desktop = useSyncExternalStore(subscribeDesktop, isDesktop, () => false);
  // A menu's panel goes back to what opened the menu; a trigger's, Radix returns to it.
  const back = (event: Event) => {
    if (trigger || !anchor?.current?.isConnected) return;
    event.preventDefault();
    anchor.current.focus();
  };
  const body = open && (
    <Choose
      title={title}
      audioOnly={audioOnly}
      onPlay={(on) => {
        onOpenChange(false);
        onPlay(on);
      }}
      onClose={() => onOpenChange(false)}
    />
  );
  if (tv || desktop)
    return (
      <Popover open={open} onOpenChange={onOpenChange}>
        {trigger ? (
          <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        ) : (
          <PopoverAnchor virtualRef={anchor as RefObject<HTMLElement>} />
        )}
        {open && (
          <PopoverContent
            align="start"
            collisionPadding={16}
            aria-label="Choose where it plays"
            onCloseAutoFocus={back}
            className="max-h-[min(40rem,var(--radix-popover-content-available-height))] w-[min(32rem,calc(100vw-2rem))] gap-0 overflow-y-auto p-3"
          >
            {body}
          </PopoverContent>
        )}
      </Popover>
    );
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {trigger && <SheetTrigger asChild>{trigger}</SheetTrigger>}
      <SheetContent
        side="bottom"
        aria-describedby={undefined}
        showCloseButton={false}
        onCloseAutoFocus={back}
        className="max-h-[85dvh] items-center gap-0 overflow-y-auto px-(--gutter) pt-2 pb-8"
      >
        <SheetTitle className="sr-only">Choose where it plays</SheetTitle>
        <div className="grid w-full max-w-3xl">{body}</div>
      </SheetContent>
    </Sheet>
  );
}

function Choose({
  title,
  audioOnly,
  onPlay,
  onClose,
}: {
  title: string;
  audioOnly?: boolean;
  onPlay: (on: PlayOn) => void;
  onClose: () => void;
}) {
  const session = useOptionalSessionGate();
  const state = session?.state;
  const rows = state ? choiceRows(state, { here: deviceId(), audioOnly }) : [];
  // Taken as it opens: what this device can play, as Play would.
  const [choice, setChoice] = useState<Choice>(() => firstChoice(rows));
  if (!state) return null;
  const connected = session.connected;
  const summary = choiceSummary(state, rows, choice);
  // Offline devices fold into one line, as in the Mixer.
  const online = rows.filter((row) => row.device.online),
    offline = rows.filter((row) => !row.device.online);
  const play = (next: Choice) => {
    const on = playOnOf(rows, next);
    if (on) onPlay(on);
  };
  const turn = (id: string, channel: "picture" | "sound") =>
    setChoice(({ [id]: was = { picture: false, sound: false }, ...others }) => {
      const now = { ...was, [channel]: !was[channel] };
      return now.picture || now.sound ? { ...others, [id]: now } : others;
    });
  return (
    <>
      <div data-nav-row className="flex min-h-11 items-center gap-2 pb-2">
        <div className="grid min-w-0 flex-1">
          <p className="text-base font-medium">Choose where it plays</p>
          <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{title}</p>
        </div>
        <Button
          variant="ghost"
          size="icon-lg"
          className="-mr-2.5 size-11 shrink-0"
          aria-label="Close"
          title="Close"
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      {/* Saved groups of screens and speakers belong here, above the devices, as in the Mixer. */}
      <ul aria-label="Devices" className="grid">
        {online.map((row) => (
          <ChoiceDevice
            key={row.device.id}
            row={row}
            chosen={choice[row.device.id]}
            connected={connected}
            onTurn={(channel) => turn(row.device.id, channel)}
            onOnly={() => play(onlyChoice(row))}
          />
        ))}
      </ul>
      {offline.length > 0 && (
        <p className="mt-2 border-t pt-3 text-sm text-muted-foreground [overflow-wrap:anywhere]">
          Offline: {offlineNames(offline)}
        </p>
      )}
      <div data-nav-row className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t pt-3">
        <Button
          disabled={!connected || !summary.ready}
          onClick={() => play(choice)}
          aria-describedby="choose-where-it-plays-summary"
        >
          <Play aria-hidden="true" />
          Play
        </Button>
        <p
          id="choose-where-it-plays-summary"
          role="status"
          className="grid min-w-0 flex-1 basis-48 text-sm [overflow-wrap:anywhere]"
        >
          <span>{summary.lines[0]}</span>
          {summary.lines[1] && <span className="text-muted-foreground">{summary.lines[1]}</span>}
        </p>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </>
  );
}

/** A device's row: its name, marked with Play, plays there at once with everything it can; its Picture and Sound choose for Play. */
function ChoiceDevice({
  row,
  chosen,
  connected,
  onTurn,
  onOnly,
}: {
  row: ChoiceRow;
  chosen?: { picture: boolean; sound: boolean };
  connected: boolean;
  onTurn: (channel: "picture" | "sound") => void;
  onOnly: () => void;
}) {
  const { device, picture, sound } = row;
  // One channel it can't play here says why on the row, where touch and remote users see it; the item's own
  // lack (No picture, No sound) is every row's, so it says nothing.
  const lockedOne = (
    [
      ["Picture", picture],
      ["Sound", sound],
    ] as const
  ).filter(
    ([, control]) =>
      control.reason && control.reason !== "No picture" && control.reason !== "No sound",
  );
  const note =
    lockedOne.length === 1 ? `${lockedOne[0]![0]}: ${lockedOne[0]![1].reason}` : undefined;
  const detail = [row.status, note].filter(Boolean).join(" · ");
  const toggle = (
    channel: "picture" | "sound",
    control: ChoiceRow["picture"],
    on: ReactNode,
    off: ReactNode,
    name: string,
  ) => {
    const pressed = !!chosen?.[channel] && control.enabled;
    return (
      <Toggle
        aria-label={`${device.name} ${channel}`}
        title={control.reason ?? name}
        pressed={pressed}
        disabled={!connected || !control.enabled}
        onPressedChange={() => onTurn(channel)}
        className="size-11 data-[state=off]:text-muted-foreground data-[state=on]:bg-transparent"
      >
        {pressed ? on : off}
      </Toggle>
    );
  };
  return (
    <li
      data-nav-row
      data-device={device.id}
      className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-1 py-1"
    >
      <Button
        variant="ghost"
        aria-label={`Play on ${device.name}`}
        title={`Play on ${device.name}`}
        disabled={!connected || (!picture.enabled && !sound.enabled)}
        onClick={onOnly}
        className="-ml-2.5 h-auto min-h-11 justify-start gap-2.5 rounded-md px-2.5 py-1 text-left font-normal whitespace-normal"
      >
        <Play aria-hidden="true" className="shrink-0 text-muted-foreground" />
        <span className="grid min-w-0">
          <span className="text-base [overflow-wrap:anywhere]">{device.name}</span>
          {detail && (
            <span className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{detail}</span>
          )}
        </span>
      </Button>
      {toggle(
        "picture",
        picture,
        <Monitor aria-hidden="true" />,
        <MonitorOff aria-hidden="true" />,
        "Picture",
      )}
      {toggle(
        "sound",
        sound,
        <Volume2 aria-hidden="true" />,
        <VolumeOff aria-hidden="true" />,
        "Sound",
      )}
    </li>
  );
}
