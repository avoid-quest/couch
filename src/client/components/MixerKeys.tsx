import type { ReactNode } from "react";
import { CircleAlert, Monitor, Volume2 } from "lucide-react";
import { MediaArtwork } from "@/components/MediaArtwork";
import { useArtworkPicture } from "@/components/AmbientLight";
import type { Control } from "@/session/where-it-plays";
import { cn } from "@/lib/utils";
import type { DeviceSummary, PlaybackSummary } from "../../shared/protocol";

// The parts Where it plays, Choose where it plays and a group's editor share: a device's name with what matters about
// it, and its round Sound and Picture keys.

export type Channel = "picture" | "sound";

/** The running programme a device plays now, other than `except`, whose artwork its status shows. */
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

/**
 * A programme's artwork where it stands for that programme (a busy device's status, the Playback pictures, Play on's
 * places): through Core, so a picture its host refuses a browser (RaiPlay's) still shows.
 */
export function ProgrammeArt({
  thumbnail,
  title,
  className,
}: {
  thumbnail?: string;
  title: string;
  className?: string;
}) {
  const shown = useArtworkPicture(thumbnail, true);
  return (
    <MediaArtwork
      bare={!!thumbnail && !shown}
      thumbnail={shown}
      title={title}
      className={className}
    />
  );
}

/**
 * A device's name, up to two lines, at full ink while it plays (`active`), with what follows it (its level); under it
 * what matters about it, a busy device's status after that programme's artwork.
 */
export function DeviceCell({
  device,
  status,
  failed = false,
  busy,
  active = false,
  after,
  statusId,
}: {
  device: DeviceSummary;
  status?: string;
  failed?: boolean;
  /** The programme it plays instead, whose artwork stands before "Playing …". */
  busy?: PlaybackSummary;
  active?: boolean;
  after?: ReactNode;
  statusId?: string;
}) {
  return (
    <span data-device-cell className="grid min-w-0 gap-px">
      <span
        data-output-name
        className={cn(
          "flex min-w-0 items-center gap-2 text-body",
          active ? "font-semibold text-foreground" : "font-medium text-muted-foreground",
          !device.online && "text-subtle-foreground",
        )}
      >
        <span className="line-clamp-2 min-w-0 [overflow-wrap:anywhere]">{device.name}</span>
        {after}
      </span>
      {status && (
        <span
          id={statusId}
          data-output-status
          title={status}
          className={cn(
            "flex min-w-0 items-center gap-1.5 text-meta",
            failed ? "text-foreground" : "text-subtle-foreground",
          )}
        >
          {failed && (
            <CircleAlert aria-hidden="true" className="size-[1.1em] shrink-0 text-destructive" />
          )}
          {busy && (
            <ProgrammeArt
              thumbnail={busy.thumbnail}
              title={busy.title ?? ""}
              className="size-[1.125rem] shrink-0 rounded-[0.1875rem] object-cover"
            />
          )}
          {/* A failure takes two lines at most, the rest one; each is whole on hover and to a screen reader. */}
          <span className={failed ? "line-clamp-2 [overflow-wrap:anywhere]" : "truncate"}>
            {status}
          </span>
        </span>
      )}
      {/* Mounted before it fails, so a failure that arrives is announced. */}
      <span aria-live="polite" className="sr-only">
        {failed ? status : ""}
      </span>
    </span>
  );
}

const words = { picture: "Picture", sound: "Sound" } as const;

/**
 * A round Sound or Picture key: a flat ink disc while on, the bare icon while off, half ink while on but not to be
 * changed (offline). A channel nobody here can turn on isn't offered: its place stays empty, and the row's details say
 * why. Disabled while Couch is unreachable.
 */
export function MixerKey({
  device,
  channel,
  on,
  control,
  disabled = false,
  onPress,
}: {
  device: DeviceSummary;
  channel: Channel;
  on: boolean;
  control: Control;
  disabled?: boolean;
  onPress: () => void;
}) {
  if (!control.enabled && !on) return <span aria-hidden="true" className="mixer-key" />;
  const Icon = channel === "picture" ? Monitor : Volume2;
  return (
    <button
      type="button"
      data-mixer-key={channel}
      aria-pressed={on}
      aria-label={`${words[channel]} on ${device.name}`}
      aria-disabled={!control.enabled || undefined}
      title={
        control.enabled ? words[channel] : `${words[channel]}, ${control.reason?.toLowerCase()}`
      }
      disabled={disabled}
      onClick={() => control.enabled && onPress()}
      className="mixer-key"
    >
      <Icon aria-hidden="true" />
    </button>
  );
}
