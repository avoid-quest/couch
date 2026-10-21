import type { ClientSessionState } from "./session";
import type { Action, DeviceSummary, Output } from "../../shared/protocol";

// Where it plays' rules, without React (docs/design/where-it-plays.md): which devices the picker lists and in what
// order, what each row says, which controls it offers, and when the chooser opens. Core decides; these rules
// offer only what Core would accept, so a control is never enabled for a change Core refuses.

type State = ClientSessionState | null | undefined;
const served = (state: State, id: string) => state?.playbacks?.find(playback => playback.outputs.some(output => output.deviceId === id));

/** A request to choose where a shared source plays: its playback and Core's count of requests. */
export const chooserRequest = (state: ClientSessionState) => { const playback = state.playbacks?.find(item => item.id === state.playback); return playback?.choosing ? `${playback.id}:${playback.choosing}` : null; };
/** Where it plays opens for each new request and otherwise stays as the user left it. */
export const reopens = (dismissed: string | null, request: string | null) => !!request && request !== dismissed;
/** The request a window's Where it plays answers: Core's, else this window's own while it views that playback. */
export const chooserFor = (request: string | null, playback: string | null, requested: string | null | undefined) => request ?? (playback && requested?.startsWith(`${playback}:`) ? requested : null);
/**
 * Play on a source's publisher, explicit or as primary Play's destination, while the source already plays:
 * Core keeps that playback, and only the requesting window opens its Where it plays. A waiting one
 * also opens here unless Core already asks every device (the shared, opt-in setting).
 */
export const choosesHere = (action: Action, before: ClientSessionState | null, after: ClientSessionState | null) => {
  if (!after || chooserRequest(after)) return false;
  const playback = after.playbacks?.find(item => item.id === after.playback);
  if (!playback?.liveSourceId) return false;
  // Play from Up next can also leave the source waiting for its first receiver.
  const source = after.liveSources?.find(source => source.id === playback.liveSourceId);
  if (action.type === "play") return action.entryId === after.currentEntryId && !!source
    && !playback.outputs.some(output => output.sound && source.audio || output.picture && source.video);
  return action.type === "playLive" && action.playNow !== false && playback.liveSourceId === action.sourceId
    && after.liveSources?.find(source => source.id === action.sourceId)?.deviceId === (action.deviceId ?? before?.controlling);
};

/** Why a control is disabled, in one word where it can be: Core's refusal, or what the media lacks. */
export type Reason = "Offline" | "Private" | "Sharing this source" | "Can't play this channel" | "No picture" | "No sound";
export type Control = { enabled: boolean; reason?: Reason };
/** A channel's toggle: pressed while the device plays it here; its action turns it over, and turning off the last channel takes the device out. */
export type Channel = Control & { on: boolean; action: Action };
export type Row = {
  device: DeviceSummary;
  /** Its picture and sound in this playback: in while it has either. */
  output?: Output;
  /** This device, whose own controls stay its own. */
  mine: boolean;
  /** Only what matters: "This device", then an exception ("Behind", "Can't play: {Core's reason}", "Muted", "Private"…). */
  status: string;
  /** The status is a failure, said in destructive red. */
  failed: boolean;
  picture: Channel;
  sound: Channel;
  /** The fader, shown while its sound is in: its volume while its sound is in, else 0. */
  level: Control & { value: number; sound: boolean };
  /** Move here (Core's solo): it alone keeps the playback. Absent where it would change nothing. */
  move?: Control;
  /** Sync … ms earlier, only while its sound plays in sync with other devices; Lip sync while another device shows the picture. */
  sync?: { delay: number; lip: boolean };
};
export type Picker = {
  /** A shared source waiting for receivers: "Choose where {title} plays". */
  choose?: string;
  /** In sync, where it applies: a live input on several devices, or already on. */
  inSync?: boolean;
  /** Every device, the playback's first. */
  rows: Row[];
};

const control = (reason: Reason | false | undefined): Control => reason ? { enabled: false, reason } : { enabled: true };

/** Where it plays for the playback `state` looks at, as seen from device `here`. */
export function picker(state: ClientSessionState, { here }: { here: string }): Picker {
  const outputs = state.outputs ?? [];
  const output = (id: string) => outputs.find(item => item.deviceId === id);
  const playback = state.playbacks?.find(item => item.id === state.playback);
  const source = state.liveSources?.find(item => item.id === playback?.liveSourceId);
  // A live input without sound keeps each output's sound, as the device chose it, but plays none.
  const audioOnly = !!playback?.audioOnly, silent = source?.audio === false;
  const sharingOf = (id: string) => state.devices?.find(device => device.id === id)?.sharing;
  // Only here is exclusive, so another device's private output in this playback, or a held publisher's
  // that returns after its source, makes it unavailable.
  const privately = [...outputs, ...playback?.held ? [playback.held] : []].filter(item => item.deviceId !== here && (item.picture && sharingOf(item.deviceId)?.video !== true || item.sound && sharingOf(item.deviceId)?.audio !== true));
  const waiting = !!source && !outputs.length;
  // Every device, once: the playback's first, then the others.
  const devices = [...state.devices ?? []].sort((a, b) => Number(!output(a.id)) - Number(!output(b.id)));
  const title = state.queue.find(entry => entry.id === state.currentEntryId)?.title;
  const rows = devices.map((device): Row => {
    const current = output(device.id);
    // Ownership permits local controls even while viewing another playback.
    const mine = device.id === here;
    // The publisher controls its capture and never plays it (docs/live-inputs.md).
    const capturing = source?.deviceId === device.id;
    const speakers = mine || device.sharing?.audio === true, screen = mine || device.sharing?.video === true;
    const audio = !silent && !capturing && speakers, video = !capturing && screen && !audioOnly;
    // An mpv channel plays only on the server's own Device, its one output.
    const hostOnly = !!playback?.hostOnly && !current;
    // A held publisher's output is its place in that playback, here or elsewhere, as Core's replacement check counts it.
    const occupied = served(state, device.id) ?? state.playbacks?.find(item => item.held?.deviceId === device.id), channel = occupied?.outputs.find(item => item.deviceId === device.id) ?? occupied?.held;
    const privateOutput = !!channel?.picture && device.sharing?.video !== true || !!channel?.sound && device.sharing?.audio !== true;
    // Moving a device from another playback would replace its private channel there.
    const elsewhere = !!occupied && occupied.id !== state.playback, moved = elsewhere && privateOutput && !mine && "Private";
    const offline = !device.online && "Offline", lock = offline || hostOnly && "Can't play this channel", sharing = capturing && "Sharing this source";
    // A channel the media lacks plays nothing, so its toggle isn't pressed.
    const pictureOn = !!current?.picture && !audioOnly, soundOn = !!current?.sound && !silent;
    // Turning off its last channel takes it out: each channel it plays here goes, so each needs its consent.
    const leave: Action = { type: "output", deviceId: device.id, ...current?.picture ? { picture: false } : {}, ...current?.sound ? { level: 0 } : {} };
    const leaving = !!current && (current.picture && !screen || current.sound && !speakers) && "Private";
    const pictureReason = lock || sharing || audioOnly && "No picture" || !screen && "Private" || moved;
    const soundReason = lock || sharing || silent && "No sound" || !speakers && "Private" || moved;
    const picture: Channel = pictureOn
      ? { on: true, ...control(pictureReason || !soundOn && leaving), action: soundOn ? { type: "output", deviceId: device.id, picture: false } : leave }
      : { on: false, ...control(pictureReason), action: { type: "output", deviceId: device.id, picture: true } };
    // Sound joins at the device's own level; a level of 0 would leave it out.
    const sound: Channel = soundOn
      ? { on: true, ...control(soundReason || !pictureOn && leaving), action: pictureOn ? { type: "output", deviceId: device.id, level: 0 } : leave }
      : { on: false, ...control(soundReason), action: { type: "output", deviceId: device.id, level: device.volume || 50 } };
    // Move here changes nothing for the only output, unless a held publisher would return after its source.
    const alone = outputs.length > 0 && outputs.every(item => item.deviceId === device.id) && !playback?.held;
    const busy = elsewhere && occupied.outputs.some(item => item.deviceId === device.id) && occupied.status !== "idle" ? occupied : undefined;
    // Private only where consent leaves you nothing to change on it.
    const locked = !picture.enabled && !sound.enabled && (picture.reason === "Private" || sound.reason === "Private") && "Private";
    const status = current && offline || sharing || hostOnly && lock || (current?.error ? `Can't play: ${current.error}` : current?.buffered ? "Behind" : locked || (soundOn && device.muted ? "Muted" : busy ? `Playing ${busy.title ?? "something else"}` : ""));
    return {
      device, output: current, mine, status: mine ? ["This device", status].filter(Boolean).join(" · ") : status, failed: !!current?.error,
      picture, sound,
      level: { value: soundOn ? device.volume : 0, sound: soundOn, ...control(soundReason) },
      move: alone ? undefined : control(lock || sharing || (!audio && !video || privateOutput && !mine || privately.some(item => item.deviceId !== device.id)) && "Private"),
      sync: audio && current?.sound && current.delayActive ? { delay: current.delay ?? 0, lip: !audioOnly && outputs.some(item => item.deviceId !== device.id && item.picture) } : undefined,
    };
  });
  return {
    choose: waiting ? `Choose where ${title ?? "it"} plays` : undefined,
    // A live input plays directly on each device unless In sync is chosen (docs/adr/0001).
    inSync: source && (outputs.length > 1 || playback?.inSync) ? !!playback?.inSync : undefined,
    rows,
  };
}

/**
 * What a row's Sound or fader sends: Core's level leaves a device's Mute as it is, so one muted elsewhere (still "Muted")
 * unmutes as its Sound turns on or its fader moves up. The row has no Mute of its own; the Volume does.
 */
export const soundActions = (row: Row, action: Action): Action[] =>
  row.device.muted && action.type === "output" && !!action.level ? [action, { type: "mute", deviceId: row.device.id, muted: false }] : [action];

/** The summary's counts and the filters they become, in the order the summary says them. */
export type Filter = "picture" | "sound" | "sync" | "behind" | "error" | "offline";
export const filterLabels: Record<Filter, string> = { picture: "Picture", sound: "Sound", sync: "In sync", behind: "Behind", error: "Can't play", offline: "Offline" };
const filtersOf = (row: Row): Filter[] => [
  ...row.picture.on ? ["picture" as const] : [], ...row.level.sound ? ["sound" as const] : [], ...row.output?.delayActive ? ["sync" as const] : [],
  ...row.output?.buffered && !row.output.error ? ["behind" as const] : [], ...row.output?.error ? ["error" as const] : [], ...!row.device.online ? ["offline" as const] : [],
];
/** Each count over every device, zeros left out: Picture 2 · Sound 3 · Offline 1. */
export const counts = (rows: Row[]) => (Object.keys(filterLabels) as Filter[])
  .map(filter => ({ filter, label: filterLabels[filter], count: rows.filter(row => filtersOf(row).includes(filter)).length })).filter(item => item.count > 0);

/** The order rows keep while the panel is open: the playback's devices, then the rest. */
export type Order = { playing: string[]; rest: string[] };
export const orderOf = (rows: Row[]): Order => ({ playing: rows.filter(row => row.output).map(row => row.device.id), rest: rows.filter(row => !row.output).map(row => row.device.id) });
/** Past this many rows the summary filters and a search field appears. */
export const crowded = 8;

/**
 * The panel's rows: in `order` (taken when it opened, so nothing jumps while you use it; new devices append), then
 * filtered without reordering. Offline devices out of the playback fold into one line; one in it keeps its row.
 */
export function arrange(rows: Row[], order: Order = orderOf(rows), filter: Filter | null = null, query = "") {
  const known = new Set([...order.playing, ...order.rest]), byId = new Map(rows.map(row => [row.device.id, row]));
  const fresh = orderOf(rows.filter(row => !known.has(row.device.id)));
  const pick = (ids: string[]) => ids.flatMap(id => byId.get(id) ?? []);
  const needle = query.trim().toLocaleLowerCase();
  const shown = (row: Row) => (!filter || filtersOf(row).includes(filter)) && (!needle || row.device.name.toLocaleLowerCase().includes(needle));
  const folded = (row: Row) => !row.device.online && !row.output;
  const all = [...pick([...order.playing, ...fresh.playing]), ...pick([...order.rest, ...fresh.rest])];
  const playing = pick([...order.playing, ...fresh.playing]).filter(row => !folded(row));
  const rest = pick([...order.rest, ...fresh.rest]).filter(row => !folded(row));
  return { playing: playing.filter(shown), rest: rest.filter(shown), offline: all.filter(folded).filter(shown), listed: playing.length + rest.length };
}

/** The one device sounding, while only one does and its fader moves: the Volume is its level, so its row has no fader. */
export function soleSound(rows: Row[]) {
  const sounding = rows.filter(row => row.output && row.level.sound);
  return sounding.length === 1 && sounding[0]!.level.enabled ? sounding[0]!.device.id : null;
}

/** The folded offline line's names, each once, counted where several devices share one: "Desk, Living room TV ×4". */
export function offlineNames(rows: Row[]) {
  const named = new Map<string, number>();
  for (const row of rows) named.set(row.device.name, (named.get(row.device.name) ?? 0) + 1);
  return [...named].map(([name, count]) => count > 1 ? `${name} ×${count}` : name).join(", ");
}

/** Play on's targets: this device first, then the other online devices that share; none while this is the only one. */
export function playOnTargets(state: State, here: string) {
  const online = (state?.devices ?? []).filter(device => device.online && (device.id === here || device.sharing?.audio || device.sharing?.video)).sort((a, b) => Number(b.id === here) - Number(a.id === here));
  // With only this Device online, Play on would repeat Play.
  return online.length > 1 ? online : [];
}

/** The device "Playing on {name}" names after a play this window started: the target, unless it is this device. */
export const playingOn = (state: Pick<ClientSessionState, "devices"> | null | undefined, target: string | undefined, here: string) => target && target !== here ? state?.devices?.find(device => device.id === target)?.name : undefined;
