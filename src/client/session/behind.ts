import type { BehindMessage } from "../../shared/protocol";

// What this device can't keep up with, as Core last heard it: its picture waits for data, or its
// speaker keeps losing sound to late chunks. Core shows it as the device's receiver state.
let behind = { picture: false, sound: false };
let send: ((message: BehindMessage) => void) | null = null;

export function reportBehind(next: Partial<typeof behind>) {
  const merged = { ...behind, ...next };
  if (merged.picture === behind.picture && merged.sound === behind.sound) return;
  behind = merged;
  send?.({ type: "behind", ...behind });
}

/** Sends every change over a new connection, which starts with nothing behind. */
export function connectBehind(sender: (message: BehindMessage) => void) {
  send = sender;
  if (behind.picture || behind.sound) sender({ type: "behind", ...behind });
  return () => {
    if (send === sender) send = null;
  };
}
