import type { Action, SessionState } from "../../shared/protocol";

// Connecting an audio client grants a capability; this explicit action joins the
// selected playback. Reconnect never repeats it or starts a new timeline.
export async function listenTogether(clientId: string, deviceId: string | null, read: () => SessionState | null, command: (action: Action) => Promise<void>) {
  const selected = read();
  if (!selected) throw new Error("Playback selection changed. Try again.");
  const current = () => {
    const state = read();
    if (!state || state.sessionId !== selected.sessionId) throw new Error("Playback selection changed. Try again.");
    return state;
  };
  let group = current().targets?.find(target => target.backend === "sendspin");
  for (let retry = 0; retry < 50 && !group?.members?.some(member => member.id === clientId && member.connected); retry++) {
    await new Promise(resolve => setTimeout(resolve, 100));
    group = current().targets?.find(target => target.backend === "sendspin");
  }
  if (!group?.members?.some(member => member.id === clientId && member.connected)) throw new Error("This device hasn't connected to shared audio. Leave and try again.");
  if (group.occupied) throw new Error(group.sessionKind === "household" ? "Choose Control shared playback, then listen together." : "Shared audio is in use by another playback. Its owner can add this device.");
  const playback = current();
  if (playback.player.tracks?.some(track => track.kind === "video")) throw new Error("Listening together supports audio. Use Move for video.");
  const source = playback.targetId && playback.targetId !== group.id && playback.targetId !== deviceId && playback.currentEntryId
    ? group.members.find(member => (member as typeof member & { deviceId?: string }).deviceId === playback.targetId && member.connected) : undefined;
  if (playback.currentEntryId && playback.targetId && playback.targetId !== group.id && playback.targetId !== deviceId && !source)
    throw new Error("Choose Listen together on the device currently playing first, then add this device.");
  const previous = group.members.filter(member => member.joined).map(member => member.id);
  const members = [...new Set([...previous, clientId, ...(source ? [source.id] : [])])];
  await command({ type: "groupMembers", targetId: group.id, memberIds: members });
  try {
    if (current().targetId !== group.id) await command({ type: "selectTarget", targetId: group.id });
  } catch (reason) {
    // The registry keeps the previous output on failed preparation. Restore its
    // membership too; a changed authority is fenced by the command connection.
    await command({ type: "groupMembers", targetId: group.id, memberIds: previous }).catch(() => {});
    throw reason;
  }
}
