import { render as renderUI, screen, setupUiTests, userEvent } from "@/testing/react";
import { expect, test } from "bun:test";
import { ShellProviders } from "../sections/shell/test-providers";
import { PlaybackTargetPicker } from "./PlaybackTargetPicker";

setupUiTests();
const devices = [
  { id: "desk", name: "Desk", connected: true, volume: 40, muted: false, audio: true },
  { id: "kitchen", name: "Kitchen", connected: true, volume: 70, muted: false, audio: true },
];
const playbacks = [{ id: "mine", title: "Radio", status: "playing", deviceIds: ["desk"] }];
const state = { sessionId: "mine", deviceIds: ["desk"], devices, playbacks, player: { status: "playing" } };

function renderPicker(value: Record<string, unknown>) {
  return renderUI(<ShellProviders value={{ state, connected: true, rendererTargetId: "desk", selectPlayback: () => {}, assignDevices: async () => true, newPlayback: async () => true, activateDeviceAudio: () => {}, setDeviceVolume: async () => true, ...value }}><PlaybackTargetPicker /></ShellProviders>);
}

test("selected playback and its canonical destination appear in one Devices control", async () => {
  renderPicker({});
  expect(screen.getByRole("button", { name: "Devices" })).toHaveTextContent("Desk");
  await userEvent.click(screen.getByRole("button", { name: "Devices" }));
  expect(screen.getByText("In this playback · This device")).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "Remove Desk" })).toBeChecked();
});

test("choosing another playback controls it without assigning devices", async () => {
  const selected: string[] = [], assigned: unknown[] = [];
  renderPicker({ state: { ...state, playbacks: [...playbacks, { id: "family", title: "Album", status: "paused", deviceIds: ["kitchen"] }] }, selectPlayback: (id: string) => selected.push(id), assignDevices: async (ids: string[]) => { assigned.push(ids); return true; } });
  await userEvent.click(screen.getByRole("button", { name: "Devices" }));
  await userEvent.click(screen.getByRole("button", { name: "Control" }));
  expect(selected).toEqual(["family"]);
  expect(assigned).toEqual([]);
});

test("audio devices can join or leave the selected playback and adjust their own volume", async () => {
  const assigned: string[][] = [], volumes: unknown[] = [];
  renderPicker({ assignDevices: async (ids: string[]) => { assigned.push(ids); return true; }, setDeviceVolume: async (...args: unknown[]) => { volumes.push(args); return true; } });
  await userEvent.click(screen.getByRole("button", { name: "Devices" }));
  await userEvent.click(screen.getByRole("checkbox", { name: "Add Kitchen" }));
  expect(assigned).toEqual([["desk", "kitchen"]]);
  await userEvent.click(screen.getByRole("button", { name: "Devices" }));
  screen.getByRole("slider", { name: "Desk volume" }).focus();
  await userEvent.keyboard("{End}");
  expect(volumes).toEqual([["desk", 100, false]]);
});

test("occupied device offers view-only Control and confirms replacement before moving", async () => {
  const selected: string[] = [], assigned: unknown[] = [];
  renderPicker({ state: { ...state, devices: [devices[0], { ...devices[1], playbackId: "family" }], playbacks: [...playbacks, { id: "family", title: "Album", status: "playing", deviceIds: ["kitchen"] }] }, selectPlayback: (id: string) => selected.push(id), assignDevices: async (...args: unknown[]) => { assigned.push(args); return true; } });
  await userEvent.click(screen.getByRole("button", { name: "Devices" }));
  await userEvent.click(screen.getAllByRole("button", { name: "Control" }).at(-1)!);
  expect(selected).toEqual(["family"]);
  expect(assigned).toEqual([]);
  await userEvent.click(screen.getByRole("button", { name: "Devices" }));
  await userEvent.click(screen.getByRole("button", { name: "Replace…" }));
  expect(assigned).toEqual([]);
  await userEvent.click(screen.getByRole("button", { name: "Replace and move" }));
  expect(assigned).toEqual([[["kitchen"], true]]);
});

test("without a selected playback, destinations remain available for a new one", async () => {
  const created: string[] = [];
  renderPicker({ state: { ...state, sessionId: null, deviceIds: [], playbacks: [] }, newPlayback: async (id: string) => { created.push(id); return true; } });
  expect(screen.getByRole("button", { name: "Devices" })).toHaveTextContent("Choose devices");
  await userEvent.click(screen.getByRole("button", { name: "Devices" }));
  expect(screen.queryByRole("button", { name: "Move" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "New playback here" }));
  expect(created).toEqual(["desk"]);
});


test("Move replaces only the selected playback destination", async () => {
  const assigned: unknown[] = [];
  renderPicker({ assignDevices: async (...args: unknown[]) => { assigned.push(args); return true; } });
  await userEvent.click(screen.getByRole("button", { name: "Devices" }));
  await userEvent.click(screen.getByRole("button", { name: "Move" }));
  expect(assigned).toEqual([[["kitchen"], false]]);
});

test("removing an assigned audio device keeps the selected playback", async () => {
  const assigned: unknown[] = [];
  renderPicker({ assignDevices: async (...args: unknown[]) => { assigned.push(args); return true; } });
  await userEvent.click(screen.getByRole("button", { name: "Devices" }));
  await userEvent.click(screen.getByRole("checkbox", { name: "Remove Desk" }));
  expect(assigned).toEqual([[[], false]]);
});
