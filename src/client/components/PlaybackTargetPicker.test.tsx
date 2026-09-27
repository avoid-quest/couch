import { render as renderUI, screen, setupUiTests, userEvent } from "@/testing/react";
import { expect, test } from "bun:test";
import { ShellProviders } from "../sections/shell/test-providers";
import { PlaybackTargetPicker } from "./PlaybackTargetPicker";

setupUiTests();
const state = { targets: [{ id: "receiver", name: "Desktop", kind: "endpoint", backend: "native", connected: true }], targetId: null, currentEntryId: "movie", player: { status: "unavailable" } };

test("an unselected Core offers this device without reporting a failed player", async () => {
  const actions: unknown[] = [];
  renderUI(<ShellProviders value={{ state, connected: true, rendererTargetId: "receiver", run: async (action: unknown) => { actions.push(action); } }}><PlaybackTargetPicker /></ShellProviders>);
  expect(screen.getByRole("button", { name: "Devices" })).toHaveTextContent("This device");
  await userEvent.click(screen.getByRole("button", { name: "Devices" }));
  await userEvent.click(screen.getByRole("button", { name: "Move" }));
  expect(actions).toEqual([{ type: "selectTarget", targetId: "receiver" }]);
});

test("occupied destination requires contextual replacement confirmation", async () => {
  const actions: unknown[] = [];
  const occupied = { id: "kitchen", name: "Kitchen", kind: "endpoint", backend: "browser", connected: true, occupied: true };
  renderUI(<ShellProviders value={{ state: { ...state, targets: [occupied] }, connected: true, run: async (action: unknown) => { actions.push(action); } }}><PlaybackTargetPicker /></ShellProviders>);
  await userEvent.click(screen.getByRole("button", { name: "Devices" }));
  await userEvent.click(screen.getByRole("button", { name: "Replace…" }));
  expect(actions).toEqual([]);
  expect(screen.getByRole("alertdialog", { name: "Replace playback on Kitchen?" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Replace and move" }));
  expect(actions).toEqual([{ type: "selectTarget", targetId: "kitchen", takeover: true }]);
});

test("control shared playback changes the view without moving audio", async () => {
  const selections: unknown[] = [], actions: unknown[] = [];
  renderUI(<ShellProviders value={{ state, connected: true, sessionMode: "personal", selectSession: (...args: unknown[]) => selections.push(args), run: async (action: unknown) => { actions.push(action); } }}><PlaybackTargetPicker /></ShellProviders>);
  await userEvent.click(screen.getByRole("button", { name: "Devices" }));
  await userEvent.click(screen.getByRole("button", { name: "Control shared playback" }));
  expect(selections).toEqual([["household"]]);
  expect(actions).toEqual([]);
});

test("group members are adjusted in the devices control", async () => {
  const group = { id: "group", name: "Downstairs", kind: "group", backend: "sendspin", connected: true, members: [{ id: "speaker", name: "Kitchen", connected: true, joined: true, volume: 40, muted: false }] };
  renderUI(<ShellProviders value={{ state: { ...state, targets: [group] }, connected: true, run: async () => true }}><PlaybackTargetPicker /></ShellProviders>);
  await userEvent.click(screen.getByRole("button", { name: "Devices" }));
  await userEvent.click(screen.getByRole("button", { name: "Adjust Downstairs devices" }));
  expect(screen.getByRole("region", { name: "Downstairs devices" })).toBeInTheDocument();
  expect(screen.getByRole("slider", { name: "Kitchen volume" })).toBeInTheDocument();
});

test("returning to your playback changes only the view", async () => {
  const selections: unknown[] = [], actions: unknown[] = [];
  renderUI(<ShellProviders value={{ state, connected: true, rendererTargetId: "receiver", sessionMode: "household", selectSession: (...args: unknown[]) => selections.push(args), run: async (action: unknown) => { actions.push(action); } }}><PlaybackTargetPicker /></ShellProviders>);
  await userEvent.click(screen.getByRole("button", { name: "Devices" }));
  expect(screen.queryByRole("button", { name: "Play separately on this device" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Control your playback" }));
  expect(selections).toEqual([["personal"]]);
  expect(actions).toEqual([]);
});

test("occupied shared playback offers Control independently of replacement", async () => {
  const selections: unknown[] = [], actions: unknown[] = [];
  const occupied = { id: "living-room", name: "Living room", kind: "endpoint", backend: "native", connected: true, occupied: true, sessionKind: "household" };
  renderUI(<ShellProviders value={{ state: { ...state, targets: [occupied] }, connected: true, sessionMode: "personal", selectSession: (...args: unknown[]) => selections.push(args), run: async (action: unknown) => { actions.push(action); } }}><PlaybackTargetPicker /></ShellProviders>);
  await userEvent.click(screen.getByRole("button", { name: "Devices" }));
  expect(screen.getByRole("button", { name: "Replace…" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Control" }));
  expect(selections).toEqual([["household"]]);
  expect(actions).toEqual([]);
});

test("a joined group member keeps its device name and is identified as listening", async () => {
  const group = { id: "group", name: "Downstairs", kind: "group", backend: "sendspin", connected: true, members: [{ id: "speaker", deviceId: "receiver", name: "Desktop", connected: true, joined: true, volume: 40, muted: false }] };
  renderUI(<ShellProviders value={{ state: { ...state, targets: [state.targets[0], group], targetId: "group" }, connected: true, rendererTargetId: "receiver", sessionMode: "household", selectSession: () => {}, run: async () => true }}><PlaybackTargetPicker /></ShellProviders>);
  await userEvent.click(screen.getByRole("button", { name: "Devices" }));
  expect(screen.getByText("Desktop")).toBeInTheDocument();
  expect(screen.getByText("Listening with Downstairs · This device")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Play separately on this device" })).toBeInTheDocument();
});
