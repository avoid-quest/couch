import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Ellipsis, Monitor, MonitorOff, Volume2, VolumeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { Level } from "@/components/Level";
import { DeviceCell, KeyFace, MixerKey, WhyLine, type Channel } from "@/components/MixerKeys";
import { RangeControl } from "@/components/RangeControl";
import { rowLevel, soundActions, type Control, type Row } from "@/session/where-it-plays";
import type { Action, DeviceSummary } from "../../../shared/protocol";

// The Mixer's device rows (Outputs.tsx): a pointer's and a touch's row of keys and fader, and a TV's row that is one
// focus stop, with what they share: Sync's line and a row's options.

type Run = (action: Action) => Promise<boolean>;

/** A row's change, with the unmute its sound brings (soundActions), each in turn until Core refuses one. */
const send = async (run: Run, row: Row, action: Action) => {
  for (const next of soundActions(row, action)) if (!(await run(next))) return false;
  return true;
};

/** A device's name column, with the level while its sound is in the playback (rowLevel). */
const deviceCell = (row: Row, playing: boolean, dot: string | undefined) => {
  const level = rowLevel(row, playing);
  return (
    <DeviceCell
      device={row.device}
      status={row.status}
      failed={row.failed}
      dot={dot}
      active={!!row.output}
      statusId={`where-it-plays-${row.device.id}`}
      after={level && <Level moving={level === "moving"} className="text-xs" />}
    />
  );
};

export type RowProps = {
  row: Row;
  connected: boolean;
  run: Run;
  playing?: boolean;
  dot: (row: Row) => string | undefined;
  onWhy: (row: Row, channel: Channel) => void;
  why?: { text: string; offline: boolean } | "" | undefined;
};

/**
 * A device's row, the same at every scale: its name and any exception, its round Picture and Sound keys, its fader and
 * number while its sound is on and another device's sounds too (Move here instead while it isn't in), and "…" while
 * Sync applies; a locked key's reason under it once pressed. On phones the fader takes a second line.
 * Called rather than rendered, so tests can walk its controls without a DOM.
 */
export function deviceRow({
  row,
  connected,
  run,
  fader = true,
  playing = false,
  dot,
  onWhy,
  why,
}: RowProps & { fader?: boolean }) {
  const { device, output, level, move } = row;
  const key = (channel: Channel) => (
    <MixerKey
      device={device}
      channel={channel}
      on={row[channel].on}
      control={row[channel]}
      disabled={!connected}
      onPress={() => void send(run, row, row[channel].action)}
      onWhy={() => onWhy(row, channel)}
    />
  );
  return (
    <li
      key={device.id}
      data-nav-row
      data-device={device.id}
      className="grid min-h-13 grid-cols-[minmax(0,1fr)_2.75rem_2.75rem_5.5rem] items-center gap-x-2 py-0.5 sm:grid-cols-[minmax(0,1fr)_2.75rem_2.75rem_minmax(0,11rem)_2.75rem]"
    >
      {deviceCell(row, playing, dot(row))}
      {key("picture")}
      {key("sound")}
      {output && level.sound && fader && (
        <div
          data-volume
          className="col-span-full row-start-2 flex min-h-11 min-w-0 items-center gap-3 pl-7 sm:col-span-1 sm:col-start-4 sm:row-start-1 sm:pl-1"
        >
          <RangeControl
            label={`${device.name} volume`}
            value={level.value}
            max={100}
            disabled={!connected || !level.enabled}
            onCommit={(value) =>
              send(run, row, { type: "output", deviceId: device.id, level: value })
            }
          />
          <span className="w-[3ch] shrink-0 text-right text-meta text-muted-foreground tabular-nums">
            {Math.round(level.value)}
          </span>
        </div>
      )}
      {!output && move && (
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Move here: ${device.name}`}
          title={move.reason}
          disabled={!connected || !move.enabled}
          onClick={() => void run({ type: "solo", deviceId: device.id })}
          className="col-start-4 row-start-1 -mr-2 justify-self-end font-semibold text-foreground sm:mr-0 sm:justify-self-start"
        >
          Move here
        </Button>
      )}
      {row.sync && (
        <Delay
          id={device.id}
          label={`${device.name} sync`}
          delay={row.sync.delay}
          disabled={!connected}
          onCommit={(delay) => void run({ type: "output", deviceId: device.id, delay })}
        />
      )}
      {output && row.sync && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-lg"
              className="col-start-4 row-start-1 -mr-2.5 size-11 justify-self-end sm:col-start-5"
              aria-label={`Options for ${device.name}`}
              title="Options"
              disabled={!connected}
            >
              <Ellipsis aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <Options id={device.id} sync="Sync…" />
        </DropdownMenu>
      )}
      {why && <WhyLine text={why.text} offline={why.offline} />}
    </li>
  );
}

/**
 * On a TV a row is one focus stop: Left and Right move its level by 5 at once (no OK to take the arrows), OK opens
 * its Picture and Sound, and Back closes the panel. Its keys show as they would under a pointer. Called rather than
 * rendered, as deviceRow is.
 */
export function tvRow({ row, connected, run, playing = false, dot, onWhy, why }: RowProps) {
  const { device, picture, sound, level } = row;
  const step = (by: number) => {
    if (connected && level.enabled && level.sound)
      void send(run, row, {
        type: "output",
        deviceId: device.id,
        level: Math.max(0, Math.min(100, level.value + by)),
      });
  };
  return (
    <li key={device.id} data-nav-row data-device={device.id} className="grid">
      <DropdownMenu>
        {/* A horizontal slider outside a Volume, so Left/Right reach it and Up/Down move on (navigation.ts). */}
        <DropdownMenuTrigger asChild disabled={!connected}>
          <div
            data-device-row
            role="slider"
            tabIndex={connected ? 0 : -1}
            aria-disabled={!connected}
            aria-label={device.name}
            aria-describedby={row.status ? `where-it-plays-${device.id}` : undefined}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={level.value}
            aria-valuetext={level.sound ? `${Math.round(level.value)} percent` : "No sound"}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                step(event.key === "ArrowLeft" ? -5 : 5);
              }
            }}
            className="-mx-2.5 grid min-h-12 grid-cols-[minmax(0,1fr)_2.75rem_2.75rem_minmax(0,11rem)_3ch] items-center gap-x-2 rounded-lg px-2.5 py-0.5 outline-none aria-disabled:opacity-50 [&:focus_[data-device-cell]_*]:text-inherit"
          >
            {deviceCell(row, playing, dot(row))}
            <KeyFace channel="picture" on={picture.on} control={picture} />
            <KeyFace channel="sound" on={sound.on} control={sound} />
            {level.sound ? (
              <Progress
                value={level.value}
                aria-hidden="true"
                className="ml-1 bg-current/20 [&_[data-slot=progress-indicator]]:bg-current"
              />
            ) : (
              <span />
            )}
            <span className="text-right text-meta tabular-nums">
              {level.sound ? Math.round(level.value) : ""}
            </span>
          </div>
        </DropdownMenuTrigger>
        <Options id={device.id} sync={row.sync && "Sync…"}>
          {channelItems({ row, connected, run, onWhy })}
        </Options>
      </DropdownMenu>
      {row.sync && (
        <Delay
          id={device.id}
          label={`${device.name} sync`}
          delay={row.sync.delay}
          disabled={!connected}
          onCommit={(delay) => void run({ type: "output", deviceId: device.id, delay })}
        />
      )}
      {why && <WhyLine text={why.text} offline={why.offline} />}
    </li>
  );
}

/**
 * A TV row's Picture or Sound in the menu its OK opens. A locked one stays choosable and says why under the row, as a
 * locked key does (`onPick` decides which).
 */
export function channelItem({
  device,
  channel,
  on,
  control,
  connected,
  onPick,
}: {
  device: DeviceSummary;
  channel: Channel;
  on: boolean;
  control: Control;
  connected: boolean;
  onPick: () => void;
}) {
  const [On, Off] = channel === "picture" ? [Monitor, MonitorOff] : [Volume2, VolumeOff];
  const Icon = on ? On : Off;
  return (
    <DropdownMenuCheckboxItem
      key={channel}
      aria-label={`${device.name} ${channel}`}
      checked={on}
      disabled={!connected}
      onCheckedChange={onPick}
    >
      <Icon aria-hidden="true" />
      {channel === "picture" ? "Picture" : "Sound"}
      <Why reason={control.reason ?? (on ? "On" : "Off")} />
    </DropdownMenuCheckboxItem>
  );
}

/** A TV row's Picture and Sound, then Move here when permitted. Its sound is its Sound and fader's. */
function channelItems({
  row,
  connected,
  run,
  onWhy,
}: Pick<RowProps, "row" | "connected" | "run" | "onWhy">) {
  const { device } = row;
  const item = (channel: Channel) =>
    channelItem({
      device,
      channel,
      on: row[channel].on,
      control: row[channel],
      connected,
      onPick: () =>
        row[channel].enabled ? void send(run, row, row[channel].action) : onWhy(row, channel),
    });
  return (
    <>
      {item("picture")}
      {item("sound")}
      {row.move && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            aria-label={`Move here: ${device.name}`}
            disabled={!connected || !row.move.enabled}
            onSelect={() => void run({ type: "solo", deviceId: device.id })}
          >
            Move here
            <Why {...row.move} />
          </DropdownMenuItem>
        </>
      )}
    </>
  );
}

// The Sync line a row's "Sync…" revealed. Local to the open panel, so closing it hides the line again.
const RevealedSync = createContext<{ id: string | null; reveal: (id: string | null) => void }>({
  id: null,
  reveal: () => {},
});
export function SyncScope({ children }: { children: ReactNode }) {
  const [id, reveal] = useState<string | null>(null);
  return <RevealedSync value={{ id, reveal }}>{children}</RevealedSync>;
}

// A row's options (a TV row's Picture and Sound), then Sync… while Sync applies, which reveals the row's Sync line and moves focus to its slider
// rather than back to what opened the menu. The items stay children, so tests walk them without a DOM.
export function Options({
  id,
  sync,
  children,
}: {
  id: string;
  sync?: string;
  children?: ReactNode;
}) {
  const { reveal } = useContext(RevealedSync);
  const picked = useRef(false);
  return (
    <DropdownMenuContent
      align="end"
      onCloseAutoFocus={(event) => {
        if (!picked.current) return;
        picked.current = false;
        event.preventDefault();
        document.querySelector<HTMLElement>(`[data-sync-line="${id}"] [role="slider"]`)?.focus();
      }}
    >
      {children}
      {sync && (
        <>
          {children && <DropdownMenuSeparator />}
          <DropdownMenuItem
            className="pl-8"
            onSelect={() => {
              picked.current = true;
              reveal(id);
            }}
          >
            {sync}
          </DropdownMenuItem>
        </>
      )}
    </DropdownMenuContent>
  );
}

/** A menu item's state or one-word reason, at its end. */
const Why = ({ reason }: Pick<Control, "reason"> | { reason: string }) =>
  reason ? <span className="ml-auto pl-6 text-xs">{reason}</span> : null;

// A speaker that sounds late (Bluetooth, a far room) plays this much earlier to line up with the other devices:
// Sendspin's static delay, 0–500 ms, to the picture too where another device shows one. It applies only while the
// device plays in sync, and few people touch it, so a row shows it only while it isn't 0, or once "…" revealed it.
// Its slider is horizontal and outside a Volume, so on the TV Left/Right move it at once, as a row's level.
function Delay({
  id,
  label,
  delay,
  disabled,
  onCommit,
}: {
  id: string;
  label: string;
  delay: number;
  disabled: boolean;
  onCommit: (delay: number) => void;
}) {
  const revealed = useContext(RevealedSync);
  const [draft, setDraft] = useState<number | null>(null);
  useEffect(() => {
    if (disabled) setDraft(null);
  }, [disabled]);
  const value = draft ?? delay;
  // A line taken to 0 while its slider is in use stays until focus leaves it, as a revealed one would.
  const shown = revealed.id === id || draft !== null;
  const hides = shown && !delay;
  // Back or Esc on a revealed slider still at 0 hides it, with focus back on the row's options, rather than closing
  // the panel. Radix listens on the document, so this listens on the window first.
  useEffect(() => {
    if (!hides) return;
    const hide = (event: KeyboardEvent) => {
      const slider =
        event.target instanceof HTMLElement
          ? event.target.closest(`[data-sync-line="${id}"] [role="slider"]`)
          : null;
      if (event.key !== "Escape" || event.defaultPrevented || !slider) return;
      event.preventDefault();
      event.stopPropagation();
      slider.closest("li")?.querySelector<HTMLElement>('[aria-haspopup="menu"]')?.focus();
      revealed.reveal(null);
    };
    window.addEventListener("keydown", hide, true);
    return () => window.removeEventListener("keydown", hide, true);
  }, [hides, id]);
  if (!delay && !shown) return null;
  return (
    <div
      data-sync-line={id}
      className="col-span-full flex min-h-11 min-w-0 items-center gap-3 pb-1"
    >
      <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
        Sync {value} ms earlier
      </span>
      <Slider
        aria-label={label}
        aria-valuetext={`${value} milliseconds earlier`}
        value={[value]}
        min={0}
        max={500}
        step={10}
        disabled={disabled}
        onValueChange={([next]) => setDraft(next!)}
        onValueCommit={([next]) => {
          if (!disabled) onCommit(next!);
        }}
        onBlur={() => setDraft(null)}
      />
    </div>
  );
}
