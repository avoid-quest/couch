import { useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { Play, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  busyWith,
  DeviceCell,
  KeyFace,
  MixerColumns,
  MixerHeader,
  MixerKey,
  useProgrammeColours,
  whyLocked,
  WhyLine,
  type Channel,
} from "@/components/MixerKeys";
import { DropdownMenu, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { ChoiceGroups, GroupsScope } from "@/sections/shell/MixerGroups";
import { channelItem, Options } from "@/sections/shell/MixerRows";
import { isDesktop, subscribeDesktop } from "@/sections/shell/Outputs";
import { deviceId } from "@/session/device-id";
import { isTvPresentation } from "@/session/presentation";
import { useOptionalSessionGate } from "@/session/session-context";
import {
  choiceRows,
  choiceSummary,
  firstChoice,
  offlineNames,
  playOnOf,
  type Choice,
  type ChoiceRow,
} from "@/session/where-it-plays";
import type { PlayOn } from "../../shared/protocol";

type Props = {
  /** The item it plays, under the panel's title, with its picture. */
  title: string;
  thumbnail?: string;
  audioOnly?: boolean;
  onPlay: (on: PlayOn) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The control that opens it, or, when a menu opened it, the element it opens from. */
  trigger?: ReactNode;
  anchor?: RefObject<HTMLElement | null>;
};

/**
 * Choose where it plays: Play on's panel, the Mixer's groups and rows for something that hasn't started. Nothing plays
 * until Play, and the line beside it says what that changes.
 * It opens from its control: a Popover on desktop and the TV, a Sheet rising from below on phones.
 */
export function ChooseWherePlays({
  title,
  thumbnail,
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
  // It opens on the first key a press can change (a TV's first row), never on Close or on Play.
  const focusFirst = (event: Event) => {
    const target = (event.currentTarget as HTMLElement).querySelector<HTMLElement>(
      tv ? "[data-device-row]" : "[data-mixer-key]:not([aria-disabled])",
    );
    if (!target) return;
    event.preventDefault();
    target.focus({ preventScroll: true });
  };
  const body = open && (
    <Choose
      title={title}
      thumbnail={thumbnail}
      audioOnly={audioOnly}
      tv={tv}
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
            onOpenAutoFocus={focusFirst}
            onCloseAutoFocus={back}
            className="max-h-[min(48rem,var(--radix-popover-content-available-height))] w-[min(36rem,calc(100vw-2rem))] gap-0 overflow-hidden px-4 pt-4 pb-3"
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
        onOpenAutoFocus={focusFirst}
        onCloseAutoFocus={back}
        className="max-h-[92dvh] items-center gap-0 overflow-hidden px-(--gutter) pt-4 pb-4"
      >
        <SheetTitle className="sr-only">Choose where it plays</SheetTitle>
        <div className="flex min-h-0 w-full max-w-3xl flex-1 flex-col">{body}</div>
      </SheetContent>
    </Sheet>
  );
}

function Choose({
  title,
  thumbnail,
  audioOnly,
  tv,
  onPlay,
  onClose,
}: {
  tv: boolean;
  title: string;
  thumbnail?: string;
  audioOnly?: boolean;
  onPlay: (on: PlayOn) => void;
  onClose: () => void;
}) {
  const session = useOptionalSessionGate();
  const state = session?.state;
  const rows = state ? choiceRows(state, { here: deviceId(), audioOnly }) : [];
  const colours = useProgrammeColours(state?.playbacks);
  // Taken as it opens: what this device can play, as Play would; those rows lead, and keep their places while you choose.
  const [choice, setChoice] = useState<Choice>(() => firstChoice(rows));
  const [first] = useState(() => Object.keys(choice));
  // What the last group asked that can't play now, said beside Play until the choice changes by hand.
  const [left, setLeft] = useState<string[]>([]);
  const [why, setWhy] = useState<{ id: string; channel: Channel } | null>(null);
  if (!state) return null;
  const connected = session.connected;
  const summary = choiceSummary(state, rows, choice);
  // Offline devices fold into one line, as in the Mixer.
  const online = rows.filter((row) => row.device.online),
    offline = rows.filter((row) => !row.device.online);
  const leading = online.filter((row) => first.includes(row.device.id)),
    others = online.filter((row) => !first.includes(row.device.id));
  const play = () => {
    const on = playOnOf(rows, choice);
    if (on) onPlay(on);
  };
  const turn = (id: string, channel: Channel) => {
    setLeft([]);
    setChoice(({ [id]: was = { picture: false, sound: false }, ...others }) => {
      const now = { ...was, [channel]: !was[channel] };
      return now.picture || now.sound ? { ...others, [id]: now } : others;
    });
  };
  const close = (
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
  );
  const device = (row: ChoiceRow) => {
    const reason = why?.id === row.device.id ? row[why.channel].reason : undefined;
    const busy = busyWith(state.playbacks, row.device.id);
    return (
      <ChoiceDevice
        key={row.device.id}
        row={row}
        chosen={choice[row.device.id]}
        connected={connected}
        tv={tv}
        dot={busy && row.status.includes("Playing") ? colours(busy.id) : undefined}
        why={
          reason && {
            text: whyLocked(row.device, why!.channel, reason),
            offline: reason === "Offline",
          }
        }
        onTurn={(channel) => turn(row.device.id, channel)}
        onWhy={(channel) =>
          setWhy((was) =>
            was?.id === row.device.id && was.channel === channel
              ? null
              : { id: row.device.id, channel },
          )
        }
      />
    );
  };
  // Where first, then what it changes for what plays now.
  const [lead, detail] = summary.ready
    ? [
        summary.lines.at(-1),
        summary.lines.length > 1 ? summary.lines[0] : "Everything else keeps playing.",
      ]
    : summary.lines;
  return (
    <GroupsScope state={state} connected={connected} close={close}>
      <div className="flex min-h-0 flex-1 flex-col">
        <MixerHeader
          heading="Choose where it plays"
          title={title}
          thumbnail={thumbnail}
          close={close}
        />
        <div className="-mx-4 min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-3">
          <ChoiceGroups
            state={state}
            connected={connected}
            rows={rows}
            choice={choice}
            onChoose={(next, out) => {
              setChoice(next);
              setLeft(out);
            }}
          />
          <MixerColumns first="Plays on" />
          {leading.length > 0 && (
            <ul aria-label="Devices" className="grid">
              {leading.map(device)}
            </ul>
          )}
          {others.length > 0 && (
            <ul
              aria-label={leading.length ? "Other devices" : "Devices"}
              className={cn("grid", leading.length > 0 && "mt-1.5 border-t pt-1.5")}
            >
              {others.map(device)}
            </ul>
          )}
          {offline.length > 0 && (
            <p className="mt-1.5 border-t pt-2.5 text-meta text-muted-foreground [overflow-wrap:anywhere]">
              Offline: {offlineNames(offline)}
            </p>
          )}
        </div>
        <div
          data-nav-row
          className="-mx-4 flex shrink-0 flex-wrap items-center gap-x-3.5 gap-y-2 border-t px-4 pt-3"
        >
          <Button
            size="lg"
            disabled={!connected || !summary.ready}
            onClick={play}
            aria-describedby="choose-where-it-plays-summary"
            className="max-sm:flex-1"
          >
            <Play aria-hidden="true" className="fill-current" />
            Play
          </Button>
          <p
            id="choose-where-it-plays-summary"
            role="status"
            className="grid min-w-0 flex-1 basis-48 text-meta [overflow-wrap:anywhere] max-sm:order-first max-sm:basis-full"
          >
            <span className="font-semibold">{lead}</span>
            <span className="text-muted-foreground">
              {[detail, left.length > 0 && `Left out: ${left.join(", ")}.`]
                .filter(Boolean)
                .join(" ")}
            </span>
          </p>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </GroupsScope>
  );
}

/**
 * A device's row: its name and status, and its Picture and Sound keys, white while chosen; a locked key says why. On a
 * TV the row is one focus stop, as in the Mixer: OK opens its Picture and Sound, where a locked one says why.
 */
function ChoiceDevice({
  row,
  chosen,
  connected,
  tv,
  dot,
  why,
  onTurn,
  onWhy,
}: {
  row: ChoiceRow;
  chosen?: { picture: boolean; sound: boolean };
  connected: boolean;
  tv: boolean;
  dot?: string;
  why?: { text: string; offline: boolean } | "";
  onTurn: (channel: Channel) => void;
  onWhy: (channel: Channel) => void;
}) {
  const on = (channel: Channel) => !!chosen?.[channel] && row[channel].enabled;
  const press = (channel: Channel) => (row[channel].enabled ? onTurn(channel) : onWhy(channel));
  const cell = (
    <DeviceCell
      device={row.device}
      status={row.status}
      dot={dot}
      active={!!chosen && (row.picture.enabled || row.sound.enabled)}
    />
  );
  const key = (channel: Channel) => (
    <MixerKey
      device={row.device}
      channel={channel}
      on={on(channel)}
      control={row[channel]}
      draft
      disabled={!connected}
      onPress={() => onTurn(channel)}
      onWhy={() => onWhy(channel)}
    />
  );
  const face = (channel: Channel) => (
    <KeyFace channel={channel} on={on(channel)} control={row[channel]} draft />
  );
  return (
    <li
      data-nav-row
      data-device={row.device.id}
      className={cn(
        "grid",
        !tv && "min-h-13 grid-cols-[minmax(0,1fr)_2.75rem_2.75rem] items-center gap-x-2 py-0.5",
      )}
    >
      {tv ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={!connected}>
            <button
              type="button"
              data-device-row
              aria-label={row.device.name}
              className="-mx-2.5 grid min-h-12 grid-cols-[minmax(0,1fr)_2.75rem_2.75rem] items-center gap-x-2 rounded-lg px-2.5 py-0.5 text-left outline-none disabled:opacity-50 [&:focus_[data-device-cell]_*]:text-inherit"
            >
              {cell}
              {face("picture")}
              {face("sound")}
            </button>
          </DropdownMenuTrigger>
          <Options id={row.device.id}>
            {(["picture", "sound"] as const).map((channel) =>
              channelItem({
                device: row.device,
                channel,
                on: on(channel),
                control: row[channel],
                connected,
                onPick: () => press(channel),
              }),
            )}
          </Options>
        </DropdownMenu>
      ) : (
        <>
          {cell}
          {key("picture")}
          {key("sound")}
        </>
      )}
      {why && <WhyLine text={why.text} offline={why.offline} />}
    </li>
  );
}
