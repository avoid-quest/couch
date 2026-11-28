import {
  useContext,
  useEffect,
  useReducer,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  CircleAlert,
  Lock,
  Monitor,
  MonitorOff,
  MonitorSmartphone,
  Tv,
  Volume2,
  VolumeOff,
  WifiOff,
} from "lucide-react";
import { cachedArt, readArt, type Rgb } from "@/artwork-light";
import { MediaArtwork } from "@/components/MediaArtwork";
import { SessionGateContext } from "@/session/gate-context";
import type { Control } from "@/session/where-it-plays";
import { cn } from "@/lib/utils";
import type { DeviceSummary, PlaybackSummary } from "../../shared/protocol";

// The Mixer's parts that Where it plays, Choose where it plays and a group's editor share: a device's name with its
// status, its round Picture and Sound keys, and the colour each programme wears.

export type Channel = "picture" | "sound";
type Reason = NonNullable<Control["reason"]>;

const usable = (src: string | undefined): src is string => !!src && /^(https?|blob):/.test(src);
/** The artwork's first colour at full brightness, so a lit key reads as that programme. */
const lit = (colour: Rgb) => {
  const top = Math.max(...colour) || 1;
  return `rgb(${colour.map((channel) => Math.round((channel * 255) / top)).join(" ")})`;
};
/** A programme without artwork colour still keeps one colour of its own, from its id. */
const stable = (id: string) =>
  `oklch(0.8 0.12 ${[...id].reduce((hue, char) => (hue * 31 + char.charCodeAt(0)) % 360, 0)})`;

/**
 * The colour each Playback wears in the Mixer (its lit keys, its tab, the dot beside a device it plays on): its
 * artwork's first colour, read as the room reads it (artwork-light.ts), else a stable colour of its own.
 */
export function useProgrammeColours(playbacks: PlaybackSummary[] | undefined) {
  const credentials = useContext(SessionGateContext)?.credentials;
  const [, read] = useReducer((count: number) => count + 1, 0);
  const sources = (playbacks ?? []).map((playback) => playback.thumbnail).filter(usable);
  const key = sources.join("\n");
  useEffect(() => {
    let live = true;
    for (const src of key ? key.split("\n") : [])
      if (!cachedArt(src))
        void readArt(src, credentials).then((art) => {
          if (live && art?.light) read();
        });
    return () => {
      live = false;
    };
  }, [key]);
  return (id: string | null | undefined) => {
    if (!id) return undefined;
    const thumbnail = playbacks?.find((playback) => playback.id === id)?.thumbnail;
    const light = usable(thumbnail) ? cachedArt(thumbnail)?.light : null;
    return light ? lit(light.a) : stable(id);
  };
}

/** The colour as the custom property the keys read. */
export const programmeStyle = (colour: string | undefined) =>
  colour ? ({ "--programme": colour } as CSSProperties) : undefined;

/** The running programme a device plays now, other than `except`, whose colour its dot wears. */
export const busyWith = (
  playbacks: PlaybackSummary[] | undefined,
  deviceId: string,
  except?: string | null,
) =>
  playbacks?.find(
    (playback) =>
      playback.id !== except &&
      playback.status !== "idle" &&
      playback.outputs.some((output) => output.deviceId === deviceId),
  );

/** Couch knows only whether a device is a TV; any other is a phone or a computer. */
const DeviceIcon = ({ device, className }: { device: DeviceSummary; className?: string }) => {
  const Icon = device.tv ? Tv : MonitorSmartphone;
  return <Icon aria-hidden="true" className={cn("size-[1.125rem] shrink-0", className)} />;
};

/**
 * A device's name column: its icon, its name (and what follows it, such as the level), and its status. A device busy
 * with another programme shows a dot in that programme's colour before "Playing …".
 */
export function DeviceCell({
  device,
  status,
  failed = false,
  dot,
  active = false,
  after,
  statusId,
}: {
  device: DeviceSummary;
  status?: string;
  failed?: boolean;
  dot?: string;
  /** In this playback (or chosen): its name and icon at full ink. */
  active?: boolean;
  after?: ReactNode;
  statusId?: string;
}) {
  return (
    <span data-device-cell className="flex min-w-0 items-center gap-2.5 py-1">
      <DeviceIcon device={device} className={active ? undefined : "text-muted-foreground"} />
      <span className="grid min-w-0">
        <span
          data-output-name
          className={cn(
            "flex items-center gap-2 text-body font-medium [overflow-wrap:anywhere]",
            !active && "text-foreground/80",
          )}
        >
          {device.name}
          {after}
        </span>
        {status && (
          <span
            id={statusId}
            data-output-status
            title={status}
            className={cn(
              "flex min-w-0 items-center gap-1.5 text-caption",
              failed ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {failed && (
              <CircleAlert aria-hidden="true" className="size-[1.1em] shrink-0 text-destructive" />
            )}
            {dot && (
              <span
                aria-hidden="true"
                className="size-1.5 shrink-0 rounded-full bg-(--dot) shadow-[0_0_10px_var(--dot)]"
                style={{ "--dot": dot } as CSSProperties}
              />
            )}
            {/* A failure is said whole; the rest keeps to one line, whole on hover. */}
            <span className={failed ? "[overflow-wrap:anywhere]" : "truncate"}>{status}</span>
          </span>
        )}
      </span>
    </span>
  );
}

const icons = {
  picture: [Monitor, MonitorOff],
  sound: [Volume2, VolumeOff],
} as const;
/** What the media lacks is every row's, so its key shows the channel off rather than a lock. */
const lacking = (reason: Reason | undefined) => reason === "No picture" || reason === "No sound";

/** A key's look: lit in the programme's colour (`--programme`), or white for a choice not yet played; hatched while locked. */
const keyLook = ({
  on,
  locked,
  draft = false,
}: {
  on: boolean;
  locked: boolean;
  draft?: boolean;
}) =>
  cn(
    "grid size-10 shrink-0 place-items-center justify-self-center rounded-full text-muted-foreground shadow-[inset_0_0_0_1.5px_var(--color-input)] transition-[background-color,color,box-shadow] duration-150 touch:size-11 [&_svg]:size-[1.125rem]",
    on &&
      !locked &&
      (draft
        ? "bg-foreground text-background shadow-none"
        : "bg-[color-mix(in_oklab,var(--programme,#fff)_72%,white)] text-black shadow-[0_0_26px_-6px_var(--programme,#fff)]"),
    locked &&
      "bg-[repeating-linear-gradient(135deg,transparent_0_4px,rgb(255_255_255/.05)_4px_8px)] shadow-[inset_0_0_0_1.5px_var(--color-border)] [&_svg]:size-[0.95rem]",
    locked &&
      on &&
      "bg-[color-mix(in_oklab,var(--programme,#fff)_34%,#2a262c)] text-foreground shadow-none",
  );
/** A lock where its owner keeps the channel, no signal where the device is offline, else the channel on or off. */
function KeyIcon({ channel, on, control }: { channel: Channel; on: boolean; control: Control }) {
  const [On, Off] = icons[channel];
  const Icon =
    !control.enabled && !lacking(control.reason)
      ? control.reason === "Offline"
        ? WifiOff
        : Lock
      : on
        ? On
        : Off;
  return <Icon aria-hidden="true" />;
}

/**
 * A round Picture or Sound key. A channel its owner doesn't lend, or that can't change now, shows a lock: pressing it
 * changes nothing and asks `onWhy` to say why. Disabled only while Couch is unreachable.
 */
export function MixerKey({
  device,
  channel,
  on,
  control,
  draft = false,
  disabled = false,
  onPress,
  onWhy,
}: {
  device: DeviceSummary;
  channel: Channel;
  on: boolean;
  control: Control;
  draft?: boolean;
  disabled?: boolean;
  onPress: () => void;
  onWhy?: () => void;
}) {
  const locked = !control.enabled;
  return (
    <button
      type="button"
      data-mixer-key
      role="switch"
      aria-checked={on}
      aria-label={`${device.name} ${channel}`}
      aria-disabled={locked || undefined}
      title={control.reason ?? (channel === "picture" ? "Picture" : "Sound")}
      disabled={disabled}
      onClick={() => (locked ? onWhy?.() : onPress())}
      className={cn(
        keyLook({ on, locked, draft }),
        "disabled:opacity-50",
        locked
          ? "cursor-help"
          : !on &&
              "hover:text-foreground hover:shadow-[inset_0_0_0_1.5px_var(--color-muted-foreground)]",
      )}
    >
      <KeyIcon channel={channel} on={on} control={control} />
    </button>
  );
}

/** The same key's face on a TV row, where the row is the one focus stop and OK opens its Picture and Sound (white while only chosen, as `draft`). */
export const KeyFace = ({
  channel,
  on,
  control,
  draft,
}: {
  channel: Channel;
  on: boolean;
  control: Control;
  draft?: boolean;
}) => (
  <span aria-hidden="true" className={keyLook({ on, locked: !control.enabled, draft })}>
    <KeyIcon channel={channel} on={on} control={control} />
  </span>
);

/**
 * Why a locked key changes nothing, and who can change it: the device's owner, in its Settings, for a channel it
 * doesn't lend; nobody here for a device keeping something of its own private.
 */
export function whyLocked(device: DeviceSummary, channel: Channel, reason: Reason) {
  const name = device.name;
  const lends = channel === "picture" ? device.sharing?.video : device.sharing?.audio;
  switch (reason) {
    case "Offline":
      return `${name} is offline.`;
    case "No picture":
      return "This has no picture to show.";
    case "No sound":
      return "This has no sound.";
    case "Sharing this source":
      return `${name} is sharing this, so it doesn't play it too.`;
    case "Can't play this channel":
      return "This channel plays only on the computer that runs Couch.";
    case "Private":
      return lends
        ? `${name} is playing something of its own and keeps it private. It stays as it is.`
        : `${name} isn't lending its ${channel === "picture" ? "screen" : "speakers"}. Only ${name} can change that, in its Settings.`;
  }
}

/** The line under a row that says why its key changed nothing, scrolled into the panel's view as it appears. */
export function WhyLine({ text, offline }: { text: string; offline?: boolean }) {
  const line = useRef<HTMLParagraphElement>(null);
  useEffect(() => line.current?.scrollIntoView({ block: "nearest" }), [text]);
  return (
    <p
      ref={line}
      role="status"
      className="col-span-full flex items-center gap-2 pb-2 pl-7 text-meta text-muted-foreground [&_svg]:size-3.5"
    >
      {offline ? <WifiOff aria-hidden="true" /> : <Lock aria-hidden="true" />}
      <span className="text-foreground/80">{text}</span>
    </p>
  );
}

/** The column heads over the rows: what the first column holds, then Picture, Sound and, in the Mixer, Volume. */
export function MixerColumns({ first, volume = false }: { first?: string; volume?: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "grid items-end gap-x-2 border-b pb-1 text-caption text-muted-foreground",
        volume
          ? "grid-cols-[minmax(0,1fr)_2.75rem_2.75rem_5.5rem] sm:grid-cols-[minmax(0,1fr)_2.75rem_2.75rem_minmax(0,11rem)_2.75rem]"
          : "grid-cols-[minmax(0,1fr)_2.75rem_2.75rem]",
      )}
    >
      <span>{first}</span>
      <span className="text-center">Picture</span>
      <span className="text-center">Sound</span>
      {volume && <span className="pl-1 max-sm:hidden">Volume</span>}
    </div>
  );
}

/** The title line every face of the Mixer opens with: the item's picture, what the panel is, the item's title, Close. */
export function MixerHeader({
  heading,
  title,
  thumbnail,
  close,
}: {
  heading: string;
  title?: string | null;
  thumbnail?: string;
  close: ReactNode;
}) {
  return (
    <div data-nav-row className="flex shrink-0 items-center gap-3 pb-3">
      {title && (
        <MediaArtwork
          thumbnail={thumbnail}
          title={title}
          className="aspect-video h-11 w-auto max-w-24 shrink-0 rounded-md object-cover [&:is(img)]:aspect-auto"
        />
      )}
      <div className="grid min-w-0 flex-1">
        <p className="font-heading text-title font-semibold">{heading}</p>
        {title && <p className="truncate text-meta text-muted-foreground">{title}</p>}
      </div>
      {close}
    </div>
  );
}
