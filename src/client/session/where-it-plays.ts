import type { ClientSessionState } from "./session";
import type { Action, DeviceSummary, Output, PlaybackSummary } from "../../shared/protocol";

// Where it plays' rules, without React (docs/design/where-it-plays.md): which devices the picker lists and in what
// order, what each row says, which controls it offers, and when the chooser opens. Core decides; these rules
// offer only what Core would accept, so a control is never enabled for a change Core refuses.

type State = ClientSessionState | null | undefined;
const served = (state: State, id: string) => state?.playbacks?.find(playback => playback.outputs.some(output => output.deviceId === id));

const statusText: Record<PlaybackSummary["status"], string> = { unavailable: "Unavailable", idle: "Not playing", loading: "Loading", playing: "Playing", paused: "Paused", ended: "Finished", error: "Can't play" };

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
export type Row = {
  device: DeviceSummary;
  /** Its picture and sound in this playback: the row's check. */
  output?: Output;
  /** This device, whose own controls stay its own. */
  mine: boolean;
  /** One line: why you can't change it, what it plays elsewhere, or what it plays here. This device's starts "This device". */
  status: string;
  /** Why this receiver plays buffered, or why that stream failed, with Core's reason. */
  explanation?: string;
  /** Pressing the row: in, it leaves; out, it joins with picture and sound as its consent and the media allow. */
  check: Control & { action?: Action };
  /** The fader, while it is in: its volume while its sound is in, else 0. */
  level: Control & { value: number; sound: boolean };
  /** The "…" menu, while it is in. */
  picture: Control & { on: boolean };
  mute: Control & { on: boolean };
  /** Pressed again it still commits: a publisher held out for its own capture would otherwise return. */
  only: Control & { on: boolean };
  /** Sync … ms earlier, only while its sound plays in sync with other devices. */
  sync?: { delay: number };
};
export type Picker = {
  title?: string;
  /** The playback's status, or a waiting source's request to choose. */
  status: string;
  /** The Sheet's one hint line: on the TV, how its faders take the arrows. */
  hint?: string;
  /** In sync, where it applies: a live input on several devices, or already on. */
  inSync?: boolean;
  rows: Row[];
};

const control = (reason: Reason | false | undefined): Control => reason ? { enabled: false, reason } : { enabled: true };
// What an output plays here, never whether it can be heard: Mute is the device's, so it shows. A channel the
// media lacks plays nothing.
function plays(output: Output, device: DeviceSummary, audioOnly: boolean, silent: boolean) {
  const picture = output.picture && !audioOnly;
  if (output.sound && !silent) return picture ? device.muted ? "Picture, muted" : "Picture and sound" : device.muted ? "Muted" : "Sound";
  return picture ? "Picture" : output.picture ? "No picture" : "No sound";
}

/** Where it plays for the playback `state` looks at, as seen from device `here`. */
export function picker(state: ClientSessionState, { here, tv = false }: { here: string; tv?: boolean }): Picker {
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
  // Every device, once: the playback's first, then the others, offline ones last.
  const order = (device: DeviceSummary) => output(device.id) ? 0 : device.online ? 1 : 2;
  const devices = [...state.devices ?? []].sort((a, b) => order(a) - order(b));
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
    // Taking it out changes each channel it plays here, so each needs its consent; it joins on any channel it may use.
    const check = control(lock || sharing || (current ? current.picture && !screen || current.sound && !speakers : moved || !audio && !video) && "Private");
    const action: Action | undefined = !check.enabled ? undefined : current
      ? { type: "output", deviceId: device.id, ...current.picture ? { picture: false } : {}, ...current.sound ? { level: 0 } : {} }
      // Sound joins at the device's own level; a level of 0 would leave it out.
      : { type: "output", deviceId: device.id, ...video ? { picture: true } : {}, ...audio ? { level: device.volume || 50 } : {} };
    const busy = elsewhere && occupied.outputs.some(item => item.deviceId === device.id) ? occupied : undefined;
    const status = offline || sharing || (current
      ? current.error ? "Can't play" : !check.enabled ? check.reason! : current.buffered ? "Buffered" : plays(current, device, audioOnly, silent)
      : !check.enabled ? check.reason! : busy ? busy.status === "idle" ? statusText.idle : `${statusText[busy.status]} ${busy.title ?? "something else"}` : statusText.idle);
    const sound = !!current?.sound && !silent;
    return {
      device, output: current, mine, status: mine ? `This device · ${status}` : status,
      explanation: current?.error ? `It couldn't connect directly to this source, and Couch's buffered stream failed: ${current.error}`
        : current?.buffered ? "It couldn't connect directly to this source, so it plays a few seconds behind." : undefined,
      check: { ...check, action },
      level: { value: sound ? device.volume : 0, sound, ...control(lock || sharing || silent && "No sound" || !speakers && "Private" || moved) },
      picture: { on: !!current?.picture && !audioOnly, ...control(lock || sharing || audioOnly && "No picture" || !screen && "Private" || moved) },
      mute: { on: device.muted, ...control(lock || silent && "No sound" || !speakers && "Private") },
      only: { on: outputs.length > 0 && outputs.every(item => item.deviceId === device.id), ...control(lock || sharing || (!audio && !video || privateOutput && !mine || privately.some(item => item.deviceId !== device.id)) && "Private") },
      sync: audio && current?.sound && current.delayActive ? { delay: current.delay ?? 0 } : undefined,
    };
  });
  return {
    title: state.queue.find(entry => entry.id === state.currentEntryId)?.title,
    status: waiting ? "Choose where it plays" : playback ? statusText[playback.status] : "",
    hint: tv ? "Press OK to adjust a level, then OK or Back to finish." : undefined,
    // A live input plays directly on each device unless In sync is chosen (docs/adr/0001).
    inSync: source && (outputs.length > 1 || playback?.inSync) ? !!playback?.inSync : undefined,
    rows,
  };
}

/** Play on's targets: this device first, then the other online devices that share; none while this is the only one. */
export function playOnTargets(state: State, here: string) {
  const online = (state?.devices ?? []).filter(device => device.online && (device.id === here || device.sharing?.audio || device.sharing?.video)).sort((a, b) => Number(b.id === here) - Number(a.id === here));
  // With only this Device online, Play on would repeat Play.
  return online.length > 1 ? online : [];
}

/** The device "Playing on {name}" names after a play this window started: the target, unless it is this device. */
export const playingOn = (state: Pick<ClientSessionState, "devices"> | null | undefined, target: string | undefined, here: string) => target && target !== here ? state?.devices?.find(device => device.id === target)?.name : undefined;
