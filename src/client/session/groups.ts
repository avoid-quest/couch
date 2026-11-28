import type { ClientSessionState } from "./session";
import { leaveAction, soundActions, type OutputAction, type Row } from "./where-it-plays";
import type { GroupMember, MixerGroup } from "../../shared/mixer-groups";

// What applying a Group to the playback in view would change, from the Mixer's own rows (where-it-plays.ts): a group
// asks for nothing a row wouldn't let you change, so a device's consent, an offline device and another device's
// private playback stay as they are. Core checks each change again as it checks the Mixer's.

type Channel = "picture" | "sound";
type Line = { deviceId: string; name: string; channel: Channel };
/** A channel the group turns on or off, and the programme it takes the device from. */
export type Change = Line & { on: boolean; from?: string };
/** A channel the group can't change: its row's reason in lower case ("offline", "private"), and whether it stays on. */
type Left = Line & { reason: string; stays: boolean };
export type Plan = { same: Line[]; changes: Change[]; left: Left[]; wanted: number };

/**
 * The group's plan for these rows. A channel the media lacks is neither asked nor counted, and while none of the group
 * can play here it takes nothing out, so the playback never goes silent for a group that can't replace it.
 */
export function planGroup(group: MixerGroup, rows: Row[], state: ClientSessionState): Plan {
  const plan: Plan = { same: [], changes: [], left: [], wanted: 0 };
  const playback = state.playbacks?.find((item) => item.id === state.playback);
  const source = state.liveSources?.find((item) => item.id === playback?.liveSourceId);
  const lacks = { picture: !!playback?.audioOnly, sound: source?.audio === false };
  for (const row of rows) {
    const member = group.members.find((item) => item.deviceId === row.device.id);
    for (const channel of ["picture", "sound"] as const) {
      if (lacks[channel]) continue;
      const now = row[channel];
      const want = !!member?.[channel],
        line = { deviceId: row.device.id, name: row.device.name, channel };
      if (want) plan.wanted++;
      // An offline device's channel is on but plays nothing, so it doesn't count as playing as saved.
      if (want && now.on && !row.device.online)
        plan.left.push({ ...line, reason: "offline", stays: true });
      else if (want === now.on) {
        if (want) plan.same.push(line);
      } else if (!now.enabled)
        plan.left.push({ ...line, reason: (now.reason ?? "Private").toLowerCase(), stays: now.on });
      else plan.changes.push({ ...line, on: want, from: want ? takenFrom(row, state) : undefined });
    }
  }
  if (!plan.same.length && !plan.changes.some((change) => change.on)) plan.changes = [];
  return plan;
}

/** The title of the other programme a device plays now, which the group would take it from. */
function takenFrom(row: Row, state: ClientSessionState) {
  if (row.output) return undefined;
  const other = state.playbacks?.find(
    (playback) =>
      playback.id !== state.playback &&
      playback.status !== "idle" &&
      playback.outputs.some((output) => output.deviceId === row.device.id),
  );
  return other && (other.title ?? "something else");
}

/**
 * The chip: on (✓) only while it plays exactly as saved; "5 of 6" once nothing is left to change but some of it can't
 * be put on; otherwise nothing.
 */
export function groupStatus(plan: Plan) {
  if (plan.changes.length || !plan.wanted) return { on: false };
  if (plan.same.length < plan.wanted)
    return { on: false, part: `${plan.same.length} of ${plan.wanted}` };
  return { on: !plan.left.length };
}

/**
 * The Mixer's changes that apply a plan, one per device, in turn: devices gaining a channel first, so the playback
 * never empties on the way. Each is the action its row would send, with the unmute its sound brings; a device that
 * keeps nothing here leaves as its row's last channel takes it out, a channel the media lacks included. Each names
 * the item the plan was for, so Core refuses it on any other.
 */
export function applySteps(plan: Plan, rows: Row[], playbackId: string) {
  const ids = [...new Set(plan.changes.map((change) => change.deviceId))];
  const gains = (id: string) => plan.changes.some((change) => change.deviceId === id && change.on);
  return ids
    .sort((a, b) => Number(gains(b)) - Number(gains(a)))
    .map((id) => {
      const row = rows.find((item) => item.device.id === id)!;
      const changes = plan.changes.filter((change) => change.deviceId === id);
      const picture = changes.find((change) => change.channel === "picture"),
        sound = changes.find((change) => change.channel === "sound");
      const leaves =
        !!row.output &&
        !gains(id) &&
        (["picture", "sound"] as const).every(
          (channel) => !row[channel].on || changes.some((change) => change.channel === channel),
        );
      const action: OutputAction = leaves
        ? leaveAction(id, row.output)
        : {
            type: "output",
            deviceId: id,
            ...(picture ? { picture: picture.on } : {}),
            ...(sound ? { level: sound.on ? row.device.volume || 50 : 0 } : {}),
          };
      // What Undo puts back: these changes, and a channel the leave took that the media hides (a radio's picture).
      const hidden = (["picture", "sound"] as const)
        .filter(
          (channel) =>
            leaves && row.output![channel] && !changes.some((change) => change.channel === channel),
        )
        .map((channel) => ({ deviceId: id, name: row.device.name, channel, on: false }));
      return {
        changes,
        undone: [...changes, ...hidden],
        gains: gains(id),
        actions: soundActions(row, { ...action, playbackId }),
      };
    });
}

/** The changes that put back what a group's applied changes undid, on the devices they reached. */
export function undoSteps(applied: Change[], rows: Row[], playbackId: string) {
  return applySteps(
    {
      same: [],
      left: [],
      wanted: 0,
      changes: applied.map((change) => ({ ...change, on: !change.on })),
    },
    rows,
    playbackId,
  );
}

/** "Bedroom TV sound", "Speakers picture and sound": each device once, its channels together. */
export function channelNames(lines: Line[]) {
  const named = new Map<string, { name: string; channels: Channel[] }>();
  for (const line of lines) {
    const entry = named.get(line.deviceId) ?? { name: line.name, channels: [] };
    entry.channels.push(line.channel);
    named.set(line.deviceId, entry);
  }
  return [...named.values()].map(({ name, channels }) => `${name} ${channels.join(" and ")}`);
}

/** "A, B and C". */
export const listed = (items: string[]) =>
  items.length < 2 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

/** The group the Mixer saves from a playback's rows: each device with what it plays here. */
export const membersOf = (rows: Row[]): GroupMember[] =>
  rows
    .filter((row) => row.picture.on || row.sound.on)
    .map((row) => ({ deviceId: row.device.id, picture: row.picture.on, sound: row.sound.on }));
