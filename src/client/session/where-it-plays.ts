import { deviceName } from "../copy";
import type { ClientSessionState } from "./session";
import type { Action, DeviceSummary, Output, PlaybackSummary } from "../../shared/protocol";

// Where it plays' rules, without React (docs/design/where-it-plays.md): which devices the picker lists and in what
// order, what each row says, which controls it offers, and when the chooser opens. Core decides; these rules
// offer only what Core would accept, so a control is never enabled for a change Core refuses.

type State = ClientSessionState | null | undefined;
const served = (state: State, id: string) => state?.playbacks?.find(playback => playback.outputs.some(output => output.deviceId === id));

const statusText: Record<PlaybackSummary["status"], string> = { unavailable: "Unavailable", idle: "Not playing here", loading: "Loading", playing: "Playing", paused: "Paused", ended: "Finished", error: "Can't play" };

/**
 * Status describes playback, never audibility. A busy device names the other playback before a move.
 */
export function outputStatus(state: State, device: DeviceSummary, current?: string | null) {
  if (!device.online) return "Offline";
  // The publisher controls its capture and never plays it (docs/live-inputs.md).
  const viewed = state?.playbacks?.find(playback => playback.id === current);
  if (state?.liveSources?.some(source => source.id === viewed?.liveSourceId && source.deviceId === device.id)) return "Sharing this source";
  const playback = served(state, device.id);
  if (!playback) return "Not playing here";
  const verb = statusText[playback.status];
  return current && playback.id !== current ? `${verb} ${playback.title ?? "something else"}` : verb;
}

/** A request to choose where a shared source plays: its playback and Core's count of requests. */
export const chooserRequest = (state: ClientSessionState) => { const playback = state.playbacks?.find(item => item.id === state.playback); return playback?.choosing ? `${playback.id}:${playback.choosing}` : null; };
/** Where it plays opens for each new request and otherwise stays as the user left it. */
export const reopens = (dismissed: string | null, request: string | null) => !!request && request !== dismissed;
/** The request a window's Where it plays answers: Core's, else this window's own while it views that playback. */
export const chooserFor = (request: string | null, playback: string | null, requested: string | null | undefined) => request ?? (playback && requested?.startsWith(`${playback}:`) ? requested : null);
/**
 * Play on a source's publisher, explicit or as primary Play's destination, while the source already plays:
 * Core keeps that playback, and only the requesting window opens its Where it plays. A waiting one asks Core.
 */
export const choosesHere = (action: Action, before: ClientSessionState | null, after: ClientSessionState | null) => action.type === "playLive" && action.playNow !== false && !!after && !chooserRequest(after)
  && after.playbacks?.find(item => item.id === after.playback)?.liveSourceId === action.sourceId
  && after.liveSources?.find(source => source.id === action.sourceId)?.deviceId === (action.deviceId ?? before?.controlling);

export type Control = { enabled: boolean };
export type Row = {
  device: DeviceSummary;
  /** Its picture and sound in this playback. */
  output?: Output;
  /** This device, whose own controls stay its own. */
  mine: boolean;
  /** The publisher of this playback's source, which never plays its own capture. */
  capturing: boolean;
  status: string;
  /** Its output that only it may change, here or in the playback it serves. */
  private?: "picture" | "sound" | "both";
  picture: Control & { on: boolean };
  /** The fader: its volume while its sound is in, else 0. */
  level: Control & { value: number; sound: boolean };
  mute: Control & { on: boolean };
  only: Control & { on: boolean };
  /** Sync … ms earlier: adjustable while it plays in sync with other devices. */
  sync?: { adjustable: boolean; delay: number };
};
export type Picker = {
  title?: string;
  hint: string;
  /** All's trim of the sound you may control. */
  trim: number;
  /** In sync, where it applies: a live input on several devices, or already on. */
  inSync?: boolean;
  rows: Row[];
};

/** Where it plays for the playback `state` looks at, as seen from device `here`. */
export function picker(state: ClientSessionState, { here, tv = false }: { here: string; tv?: boolean }): Picker {
  const outputs = state.outputs ?? [];
  const output = (id: string) => outputs.find(item => item.deviceId === id);
  const playback = state.playbacks?.find(item => item.id === state.playback);
  const source = state.liveSources?.find(item => item.id === playback?.liveSourceId);
  const sharingOf = (id: string) => state.devices?.find(device => device.id === id)?.sharing;
  // Only here is exclusive, so another device's private output in this playback, or a held publisher's
  // that returns after its source, makes it unavailable.
  const privately = [...outputs, ...playback?.held ? [playback.held] : []].filter(item => item.deviceId !== here && (item.picture && sharingOf(item.deviceId)?.video !== true || item.sound && sharingOf(item.deviceId)?.audio !== true));
  const waiting = !!source && !outputs.length;
  // An mpv channel plays only on the server's own Device, its one output.
  const host = playback?.hostOnly ? state.devices?.find(device => device.id === outputs[0]?.deviceId)?.name ?? deviceName(state.installationName) : undefined;
  // The Playback's Devices first, then this one and the other online ones that share, and a source's
  // publisher; an offline Device only while it is an output.
  const devices = (state.devices ?? []).filter(device => output(device.id) || device.id === source?.deviceId || device.online && (device.id === here || device.sharing?.audio || device.sharing?.video)).sort((a, b) => Number(!!output(b.id)) - Number(!!output(a.id)));
  const rows = devices.map((device): Row => {
    const current = output(device.id);
    // Ownership permits local controls even while viewing another playback.
    const mine = device.id === here;
    const capturing = source?.deviceId === device.id;
    const speakers = mine || device.sharing?.audio === true;
    const audio = source?.audio !== false && !capturing && speakers, video = !capturing && (mine || device.sharing?.video === true);
    const sound = !!current?.sound, locked = !device.online || !!host && !current;
    // A held publisher's output is its place in that playback, here or elsewhere, as Core's replacement check counts it.
    const occupied = served(state, device.id) ?? state.playbacks?.find(item => item.held?.deviceId === device.id), channel = occupied?.outputs.find(item => item.deviceId === device.id) ?? occupied?.held;
    const privatePicture = !!channel?.picture && device.sharing?.video !== true;
    const privateSound = !!channel?.sound && device.sharing?.audio !== true;
    const privateOutput = privatePicture || privateSound;
    // Unselected shared devices stay operable, unless moving them would replace a private channel.
    const protectedElsewhere = !!occupied && occupied.id !== state.playback && privateOutput && !mine;
    return {
      device, output: current, mine, capturing, status: outputStatus(state, device, state.playback),
      private: privatePicture && privateSound ? "both" : privatePicture ? "picture" : privateSound ? "sound" : undefined,
      picture: { on: !!current?.picture && !playback?.audioOnly, enabled: video && !locked && !protectedElsewhere && !playback?.audioOnly },
      level: { value: sound ? device.volume : 0, sound, enabled: audio && !locked && !protectedElsewhere },
      mute: { on: device.muted, enabled: speakers && source?.audio !== false && !locked },
      // Pressed again it still commits: a publisher held out for its own capture would otherwise return.
      only: { on: outputs.length > 0 && outputs.every(item => item.deviceId === device.id), enabled: !locked && (audio || video && !playback?.audioOnly) && (!privateOutput || mine) && !privately.some(item => item.deviceId !== device.id) },
      sync: audio && sound && !locked ? { adjustable: !!current?.delayActive, delay: current?.delay ?? 0 } : undefined,
    };
  });
  return {
    title: state.queue.find(entry => entry.id === state.currentEntryId)?.title,
    hint: host ? `This channel plays only on ${host}.` : waiting ? "Choose where this source plays: raise a level or turn on Picture." : source?.audio === false ? "This source has no sound. Enable Picture on devices to watch it."
      : `Raise a device level to add its sound; at 0 its sound is off. All trims selected sound you can control and keeps device levels.${tv ? " Press OK to adjust a level, then OK or Back to finish." : ""}`,
    trim: state.mixTrim ?? 100,
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
