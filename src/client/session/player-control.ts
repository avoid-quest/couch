import type { SessionGateValue } from "./session-context";

export function readPlayerSearch(search: Record<string, unknown>): { queue?: boolean; targetDeviceId?: string } {
  return { queue: search.queue === true || search.queue === "true" ? true : undefined,
    targetDeviceId: typeof search.targetDeviceId === "string" && /^[A-Za-z0-9_-]{43}$/.test(search.targetDeviceId) ? search.targetDeviceId : undefined };
}

// This scope belongs to the player route, so navigating away restores ordinary control.
// Each run captures its route's target; SessionGate keeps that same target for Undo.
export function remotePlayerSession(session: SessionGateValue, targetDeviceId: string): SessionGateValue {
  const state = session.state;
  const target = state?.devices?.find(device => device.id === targetDeviceId && device.tv);
  const matches = !!state && state.controlling === targetDeviceId && (!state.playback || !!state.outputs?.some(output => output.deviceId === targetDeviceId));
  const shared = !!(target?.sharing?.audio || target?.sharing?.video);
  const ready = session.connected && matches && !!target?.online && shared;
  const status = !session.connected ? "Reconnecting to Couch…" : !target ? "This TV is no longer available."
    : !target.online ? `${target.name} is offline.` : !shared ? `${target.name} is private.`
    : !matches ? "Select this TV again in Remote." : `Controlling ${target.name}`;
  const run: SessionGateValue["run"] = action => ready ? session.run(action, targetDeviceId) : Promise.resolve(false);
  return { ...session, state: matches ? state : null, connected: ready, playerTarget: { id: targetDeviceId, status }, run,
    command: action => ready ? session.command(action, targetDeviceId) : Promise.reject(new Error(status)),
    seekBy: seconds => ready ? session.seekBy(seconds, targetDeviceId) : Promise.resolve(false),
  };
}
