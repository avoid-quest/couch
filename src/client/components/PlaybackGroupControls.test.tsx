import { act, renderWithQueryClient, screen, setupUiTests, userEvent } from "@/testing/react";
import { expect, test } from "bun:test";
import type { Action, PlaybackTarget } from "../../shared/protocol";
import { PlaybackGroupControls } from "./PlaybackGroupControls";

setupUiTests();
const group: PlaybackTarget = { id: "snapcast:group", name: "Downstairs", kind: "group", backend: "snapcast", connected: true, members: [
  { id: "aa:bb:cc", name: "Kitchen", connected: true, volume: 40, muted: false, joined: true },
  { id: "dd:ee:ff", name: "Dining", connected: true, volume: 60, muted: false, joined: false },
  { id: "00:11:22", name: "Patio", connected: false, volume: 30, muted: false, joined: false },
] };

test("group membership retains opaque IDs and waits for observed topology", async () => {
  const actions: Action[] = [];
  renderWithQueryClient(<PlaybackGroupControls target={group} connected busy={false} run={async action => { actions.push(action); return true; }} onClose={() => {}} />);
  expect(screen.getByRole("checkbox", { name: "Join Kitchen" })).toBeDisabled();
  expect(screen.getByRole("checkbox", { name: "Join Patio" })).toBeDisabled();
  await userEvent.click(screen.getByRole("checkbox", { name: "Join Dining" }));
  expect(actions).toEqual([{ type: "groupMembers", targetId: group.id, memberIds: ["aa:bb:cc", "dd:ee:ff"] }]);
  expect(screen.getByRole("checkbox", { name: "Join Dining" })).not.toBeChecked();
  expect(screen.queryByRole("slider", { name: "Dining volume" })).toBeNull();
});

test("joined volume and mute address the group member and block while pending", async () => {
  const actions: Action[] = [];
  let finish!: (result: boolean) => void;
  renderWithQueryClient(<PlaybackGroupControls target={group} connected busy={false} run={action => { actions.push(action); return new Promise(resolve => { finish = resolve; }); }} onClose={() => {}} />);
  screen.getByRole("slider", { name: "Kitchen volume" }).focus();
  await userEvent.keyboard("{End}");
  expect(actions).toEqual([{ type: "groupVolume", targetId: group.id, memberId: "aa:bb:cc", volume: 100, muted: false }]);
  expect(screen.getByRole("button", { name: "Mute Kitchen" })).toBeDisabled();
  await act(async () => { finish(true); });
  await userEvent.click(screen.getByRole("button", { name: "Mute Kitchen" }));
  expect(actions.at(-1)).toEqual({ type: "groupVolume", targetId: group.id, memberId: "aa:bb:cc", volume: 40, muted: true });
  await act(async () => { finish(true); });
});

for (const reason of ["offline", "handoff", "disconnected"] as const) test(`group changes are disabled during ${reason}`, () => {
  renderWithQueryClient(<PlaybackGroupControls target={{ ...group, connected: reason !== "disconnected" }} connected={reason !== "offline"} busy={reason === "handoff"} run={async () => { throw new Error("Unavailable group must not change"); }} onClose={() => {}} />);
  expect(screen.getByRole("checkbox", { name: "Join Dining" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Mute Kitchen" })).toBeDisabled();
});

test("membership removal keeps other members and joins stop at the group limit", async () => {
  const actions: Action[] = [];
  const members = Array.from({ length: 32 }, (_, index) => ({ id: `speaker:${index}`, name: `Speaker ${index}`, connected: true, joined: true, volume: 40, muted: false }));
  renderWithQueryClient(<PlaybackGroupControls target={{ ...group, members: [...members, group.members![1]!] }} connected busy={false} run={async action => { actions.push(action); return true; }} onClose={() => {}} />);
  expect(screen.getByRole("checkbox", { name: "Join Dining" })).toBeDisabled();
  await userEvent.click(screen.getByRole("checkbox", { name: "Join Speaker 0" }));
  expect(actions).toEqual([{ type: "groupMembers", targetId: group.id, memberIds: members.slice(1).map(member => member.id) }]);
});

test("disconnected groups reconnect explicitly while member changes stay disabled", async () => {
  const actions: Action[] = [];
  renderWithQueryClient(<PlaybackGroupControls target={{ ...group, connected: false, error: "The group could not reconnect. Check its speakers." }} connected busy={false} run={async action => { actions.push(action); return true; }} onClose={() => {}} />);
  expect(screen.getByRole("checkbox", { name: "Join Dining" })).toBeDisabled();
  expect(screen.getByText("The group could not reconnect. Check its speakers.")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Reconnect group" }));
  expect(actions).toEqual([{ type: "groupReconnect", targetId: group.id }]);
  expect(screen.getByRole("checkbox", { name: "Join Dining" })).toBeDisabled();
});
