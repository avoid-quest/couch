import { useContext, useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Level } from "@/components/Level";
import { DeviceCell, MixerKey, type Channel } from "@/components/MixerKeys";
import { RangeControl } from "@/components/RangeControl";
import { cn } from "@/lib/utils";
import { SessionGateContext } from "@/session/gate-context";
import { rowLevel, soundActions, type Row } from "@/session/where-it-plays";
import type { Action, PlaybackSummary } from "../../../shared/protocol";

// The desk's device rows (Desk.tsx): one readable line per device, its name first and its Sound and Picture keys at
// the edge, and its details under it once its name is pressed.

type Run = (action: Action) => Promise<boolean>;

/** A row's change, with the unmute its sound brings (soundActions), each in turn until Core refuses one. */
const send = async (run: Run, row: Row, action: Action) => {
  for (const next of soundActions(row, action)) if (!(await run(next))) return false;
  return true;
};

/**
 * What a device lends and who can change it, said in its details where its row offers no key: a device lends nothing
 * of its own unless its owner chooses so, in its Settings.
 */
function lends(row: Row) {
  const { device } = row;
  const name = device.name;
  if (row.mine || !device.online) return "";
  if (row.picture.reason === "Sharing this source")
    return `${name} is sharing this, so it doesn't play it too.`;
  if (row.picture.reason === "Can't play this channel")
    return "This channel plays only on the computer that runs Couch.";
  if (!device.sharing?.audio && !device.sharing?.video)
    return `${name} lends neither its screen nor its speakers. Only ${name} can change that, in its Settings.`;
  if (!row.picture.enabled && !row.sound.enabled && row.sound.reason === "Private")
    return `${name} is playing something of its own and keeps it private. It stays as it is.`;
  if (!device.sharing?.video)
    return `${name} lends its speakers, not its screen. Only ${name} can change that, in its Settings.`;
  if (!device.sharing?.audio)
    return `${name} lends its screen, not its speakers. Only ${name} can change that, in its Settings.`;
  return "";
}

export type DeskRowProps = {
  row: Row;
  /** Another Playback this device plays, whose artwork its status shows. */
  busy?: PlaybackSummary;
  /** It sounds now, so a row whose sound comes out shows its level moving. */
  sounding: boolean;
  /** The only device that sounds: the Volume row is its level, so its row has no fader. */
  sole: boolean;
  audioOnly: boolean;
  /** How many other devices Move here takes it off. */
  others: number;
  open: boolean;
  onOpen: () => void;
};

/**
 * A device: its name (two lines at most) and what matters about it, its level while its sound comes out, its fader while
 * it sounds alongside others, then its Sound and Picture keys. A device outside the playback offers Move here while a
 * pointer is over it. Pressing its name opens its details.
 */
export function DeskRow({
  row,
  busy,
  sounding,
  sole,
  audioOnly,
  others,
  open,
  onOpen,
}: DeskRowProps) {
  const gate = useContext(SessionGateContext);
  const connected = !!gate?.connected;
  const run: Run = (action) => gate?.run(action) ?? Promise.resolve(false);
  const takeWithUndo = <T,>(work: () => Promise<T>, text: string) =>
    gate ? gate.takeWithUndo(work, text) : work();
  const { device, output, level, move } = row;
  const name = row.mine ? "this device" : device.name;
  const moving = rowLevel(row, sounding);
  const sync = row.sync?.delay ? `Sync ${row.sync.delay} ms earlier` : "";
  const status = [row.status, sync].filter(Boolean).join(", ");
  const details = `where-it-plays-${device.id}-details`;
  // Turning on a device that plays something else takes it from there: said with an Undo that gives it back.
  const press = (channel: Channel) => {
    const action = row[channel].action;
    if (!busy || row[channel].on) return void send(run, row, action);
    const alone = busy.outputs.length === 1;
    void takeWithUndo(
      () => send(run, row, action),
      `${device.name} left ${busy.title ?? "what it played"}${alone ? ", which waits for a device" : ""}.`,
    );
  };
  const moveHere = () =>
    void takeWithUndo(
      () => run({ type: "solo", deviceId: device.id }),
      `Moved to ${name}${others ? `, off ${others} other ${others === 1 ? "device" : "devices"}` : ""}.`,
    );
  const key = (channel: Channel) => (
    <MixerKey
      device={device}
      channel={channel}
      on={row[channel].on}
      control={row[channel]}
      disabled={!connected}
      onPress={() => press(channel)}
    />
  );
  return (
    <li data-device={device.id} className="grid">
      <div
        data-nav-row
        className="desk-row group/row flex min-h-(--desk-row) min-w-0 items-center gap-1"
      >
        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? details : undefined}
          title={device.name}
          onClick={onOpen}
          className="-ml-2 mr-0.5 flex min-h-9 min-w-0 flex-1 items-center gap-1 rounded-[0.7rem] px-2 py-1 text-left outline-none hover:bg-(--fill)"
        >
          <DeviceCell
            device={device}
            status={status}
            failed={row.failed}
            busy={busy && !output && row.status.includes("Playing") ? busy : undefined}
            active={!!output}
            statusId={`where-it-plays-${device.id}`}
            after={moving && <Level moving={moving === "moving"} className="shrink-0 text-xs" />}
          />
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "desk-row-chevron size-3.5 shrink-0 text-subtle-foreground",
              open && "rotate-180",
            )}
          />
        </button>
        {!output && move?.enabled && (
          <Button
            variant="secondary"
            size="xs"
            aria-label={`Move here: ${device.name}`}
            disabled={!connected}
            onClick={moveHere}
            className="desk-row-move mr-1 h-7 px-3 text-meta font-semibold"
          >
            Move here
          </Button>
        )}
        {output && level.sound && !sole && (
          <div className="mr-1 w-[5.25rem] shrink-0 touch:w-[4.75rem]">
            <RangeControl
              label={`${device.name} volume`}
              value={level.value}
              max={100}
              showValue={false}
              disabled={!connected || !level.enabled}
              onCommit={(value) =>
                send(run, row, { type: "output", deviceId: device.id, level: value })
              }
            />
          </div>
        )}
        {key("sound")}
        {!audioOnly && key("picture")}
      </div>
      {open && <Details id={details} row={row} name={name} onMove={moveHere} />}
    </li>
  );
}

/** A row's details: its whole name, what it lends and who can change that, why it can't play, Sync, and Move here. */
function Details({
  id,
  row,
  name,
  onMove,
}: {
  id: string;
  row: Row;
  name: string;
  onMove: () => void;
}) {
  const gate = useContext(SessionGateContext);
  const connected = !!gate?.connected;
  const { device, move } = row;
  const why = lends(row);
  return (
    <div
      id={id}
      className="mt-0.5 mb-2 grid gap-2.5 rounded-[0.7rem] bg-(--fill) px-3.5 py-3 text-meta text-muted-foreground"
    >
      {device.name.length > 24 && (
        <p className="font-semibold text-foreground [overflow-wrap:anywhere]">{device.name}</p>
      )}
      {row.failed && <p>{row.status}. It keeps its place and tries again.</p>}
      {why && <p>{why}</p>}
      {!device.online && <p>{device.name} is offline.</p>}
      {row.sync && (
        <Sync
          label={`${device.name} sync`}
          delay={row.sync.delay}
          disabled={!connected}
          onCommit={(delay) => void gate?.run({ type: "output", deviceId: device.id, delay })}
        />
      )}
      {move && (
        <div data-nav-row className="flex items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            aria-label={`Move here: ${device.name}`}
            disabled={!connected || !move.enabled}
            onClick={onMove}
            className="shrink-0"
          >
            Move here
          </Button>
          <span className="min-w-0 text-subtle-foreground">
            {move.enabled
              ? `Only ${name} keeps playing it.`
              : move.reason === "Offline"
                ? "It is offline."
                : "Something private plays, here or there, so it can't move."}
          </span>
        </div>
      )}
    </div>
  );
}

// A speaker that sounds late (Bluetooth, a far room) plays this much earlier to line up with the other devices:
// Sendspin's static delay, 0–500 ms, to the picture too where another device shows one. Its slider is horizontal, so
// on the TV Left/Right move it at once, as a row's level.
function Sync({
  label,
  delay,
  disabled,
  onCommit,
}: {
  label: string;
  delay: number;
  disabled: boolean;
  onCommit: (delay: number) => void;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  useEffect(() => {
    if (disabled) setDraft(null);
  }, [disabled]);
  const value = draft ?? delay;
  return (
    <div className="flex min-h-9 min-w-0 items-center gap-3">
      <span className="min-w-[8.5rem] shrink-0 tabular-nums">Sync {value} ms earlier</span>
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

/** Someone listening to Live audio on a device of their own: no keys, they joined by themselves; its details offer Remove. */
export function GuestRow({
  row,
  open,
  onOpen,
  onRemove,
}: {
  row: { device: Row["device"]; status: string; failed: boolean; sounding: boolean };
  open: boolean;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const connected = !!useContext(SessionGateContext)?.connected;
  const details = `where-it-plays-${row.device.id}-details`;
  return (
    <li data-device={row.device.id} className="grid">
      <div data-nav-row className="desk-row flex min-h-(--desk-row) min-w-0 items-center gap-1">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? details : undefined}
          title={row.device.name}
          onClick={onOpen}
          className="-ml-2 mr-0.5 flex min-h-9 min-w-0 flex-1 items-center gap-1 rounded-[0.7rem] px-2 py-1 text-left outline-none hover:bg-(--fill)"
        >
          <DeviceCell
            device={row.device}
            status={row.status}
            failed={row.failed}
            active
            after={!row.status && <Level moving={row.sounding} className="shrink-0 text-xs" />}
          />
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "desk-row-chevron size-3.5 shrink-0 text-subtle-foreground",
              open && "rotate-180",
            )}
          />
        </button>
        <span className="shrink-0 pr-1.5 text-caption text-subtle-foreground/60">
          Their own device
        </span>
      </div>
      {open && (
        <div
          id={details}
          className="mt-0.5 mb-2 grid gap-2.5 rounded-[0.7rem] bg-(--fill) px-3.5 py-3 text-meta text-muted-foreground"
        >
          {row.device.name.length > 24 && (
            <p className="font-semibold text-foreground [overflow-wrap:anywhere]">
              {row.device.name}
            </p>
          )}
          <div data-nav-row className="flex items-center gap-3">
            <Button variant="secondary" size="sm" disabled={!connected} onClick={onRemove}>
              Remove
            </Button>
            <span className="text-subtle-foreground">They can join again from Shared sources.</span>
          </div>
        </div>
      )}
    </li>
  );
}

/** Devices out of the list, on one quiet line each: "Private now iPhone, Marta's iPad", "Offline Desk, Lane 2 phone ×2". */
export function Folds({ folds }: { folds: { label: string; names: string }[] }) {
  const shown = folds.filter((fold) => fold.names);
  if (!shown.length) return null;
  return (
    <div className="mt-2 grid gap-1.5 border-t pt-2.5 pb-1">
      {shown.map((fold) => (
        <p key={fold.label} className="text-meta text-subtle-foreground [overflow-wrap:anywhere]">
          <b className="mr-1.5 font-medium text-muted-foreground">{fold.label}</b>
          {fold.names}
        </p>
      ))}
    </div>
  );
}
