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

const sendspin: PlaybackTarget = { id: "sendspin-group", name: "Speakers", kind: "group", backend: "sendspin", connected: false, handoffSafety: "unverified", members: [
  { id: "speaker:private-id", name: "Office", connected: true, paired: false, methods: ["dynamic_pin"], joined: false, volume: 50, muted: false },
] };

test("Sendspin pairing is hidden unless the caller can administer speakers", () => {
  renderWithQueryClient(<PlaybackGroupControls target={{ ...sendspin, pairing: { clientId: "speaker:private-id", stage: "pin", methods: ["dynamic_pin"] } }} connected busy={false} run={async () => true} onClose={() => {}} />);
  expect(screen.queryByRole("button", { name: "Pair Office" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Confirm pairing" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Cancel pairing" })).toBeNull();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.getByText("An administrator can pair this speaker.")).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "Join Office" })).toBeDisabled();
});

test("Sendspin administrators can start pairing before the empty group is connected", async () => {
  const actions: Action[] = [];
  renderWithQueryClient(<PlaybackGroupControls target={sendspin} connected canPair busy={false} run={async action => { actions.push(action); return true; }} onClose={() => {}} />);
  await userEvent.click(screen.getByRole("button", { name: "Pair Office" }));
  expect(actions).toEqual([{ type: "groupPair", targetId: sendspin.id, memberId: "speaker:private-id" }]);
  expect(screen.getByRole("checkbox", { name: "Join Office" })).toBeDisabled();
});

test("Sendspin PIN submission and cancellation address the observed member without retaining its PIN", async () => {
  const actions: Action[] = [];
  const target = { ...sendspin, pairing: { clientId: "speaker:private-id", stage: "pin" as const, methods: ["dynamic_pin"] } };
  renderWithQueryClient(<PlaybackGroupControls target={target} connected canPair busy={false} run={async action => { actions.push(action); return true; }} onClose={() => {}} />);
  const input = screen.getByRole("textbox", { name: "PIN shown on Office" });
  expect(screen.getByRole("button", { name: "Confirm pairing" })).toBeDisabled();
  await userEvent.type(input, "12345");
  expect(screen.getByRole("button", { name: "Confirm pairing" })).toBeDisabled();
  await userEvent.type(input, "6");
  await userEvent.click(screen.getByRole("button", { name: "Confirm pairing" }));
  expect(actions).toEqual([{ type: "groupPair", targetId: sendspin.id, memberId: "speaker:private-id", pin: "123456" }]);
  expect(input).toHaveValue("");
  await userEvent.type(input, "654321");
  await userEvent.click(screen.getByRole("button", { name: "Cancel pairing" }));
  expect(actions.at(-1)).toEqual({ type: "groupPairCancel", targetId: sendspin.id, memberId: "speaker:private-id" });
  expect(input).toHaveValue("");
});

test("paired Sendspin speakers can join an empty group", async () => {
  const actions: Action[] = [];
  renderWithQueryClient(<PlaybackGroupControls target={{ ...sendspin, members: sendspin.members!.map(member => ({ ...member, paired: true })) }} connected busy={false} run={async action => { actions.push(action); return true; }} onClose={() => {}} />);
  await userEvent.click(screen.getByRole("checkbox", { name: "Join Office" }));
  expect(actions).toEqual([{ type: "groupMembers", targetId: sendspin.id, memberIds: ["speaker:private-id"] }]);
});

for (const reason of ["offline", "handoff", "unsupported"] as const) test(`Sendspin pairing is unavailable when ${reason}`, () => {
  renderWithQueryClient(<PlaybackGroupControls target={{ ...sendspin, members: sendspin.members!.map(member => ({ ...member, methods: reason === "unsupported" ? [] : member.methods })) }} connected={reason !== "offline"} canPair busy={reason === "handoff"} run={async () => true} onClose={() => {}} />);
  if (reason === "unsupported") expect(screen.queryByRole("button", { name: "Pair Office" })).toBeNull();
  else expect(screen.getByRole("button", { name: "Pair Office" })).toBeDisabled();
});
