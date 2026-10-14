import type { LiveRelaySettings, LocalRelayState } from "../../shared/live-relay";
import { queryOptions } from "@tanstack/react-query";
import type { BluetoothState } from "../../shared/bluetooth";
import type { DisplayState } from "../../shared/display";
import type { SoundOutput, SoundProfile, SoundState } from "../../shared/sound";
import type { StartupState } from "../../shared/startup";
import { validStreamingCommunityOrigin } from "../../shared/streamingcommunity";
import { apiJson, type ApiCredentials } from "./client";

// The server bumps each root after a write or a device change. Polling is
// reserved for hardware work that finishes on its own (see each factory).

export type SoundChoice = { key: string; output: SoundOutput } | { key: string; profile: SoundProfile };
export type SoundView = SoundState & { choices: SoundChoice[] };
export function soundView(previous: SoundView | null | undefined, next: SoundState): SoundView {
  const outputs = next.outputs.filter(output => output.availability !== "unavailable" && !output.testBlocked);
  const current = new Map<string, SoundChoice>([
    ...outputs.map(output => [`output:${output.id}`, { key: `output:${output.id}`, output }] as const),
    ...(next.profiles ?? []).filter(profile => profile.selectable && profile.available && !profile.active && !(profile.bluetoothAddress && outputs.some(output => output.card === profile.card))).map(profile => {
      const key = `profile:${profile.card}/${profile.id}`;
      return [key, { key, profile }] as const;
    }),
  ]);
  // Keep existing targets in place; inventory reads may return a different order.
  const choices = (previous?.choices ?? []).flatMap(choice => {
    const updated = current.get(choice.key);
    current.delete(choice.key);
    return updated ? [updated] : [];
  }).concat([...current.values()]);
  return { ...next, choices };
}

// A sound test ends on its own, so its status is polled while it plays.
export const soundQuery = (credentials: ApiCredentials) =>
  queryOptions({
    queryKey: ["sound"],
    queryFn: async ({ client, queryKey, signal }) => soundView(client.getQueryData<SoundView>(queryKey), await apiJson<SoundState>(credentials, "/api/sound", { signal })),
    refetchInterval: query => query.state.data?.test && ["starting", "playing"].includes(query.state.data.test.status) ? 750 : false,
    retry: false,
  });

export type ListedBluetoothState = Omit<BluetoothState, "devices"> & { devices: (BluetoothState["devices"][number] & { available: boolean })[] };
export function bluetoothView(previous: ListedBluetoothState | null | undefined, next: BluetoothState, reset = false): ListedBluetoothState {
  // BlueZ inventory order changes on every read. Keep each result in its first-seen position.
  const devices = new Map((previous?.devices ?? []).filter(device => !reset || device.paired).map(device => [device.address, { ...device, available: false, connected: false }]));
  for (const device of next.devices) devices.set(device.address, { ...device, available: true });
  if (next.operation?.kind === "forget" && next.operation.status === "finished" && next.operation.device && (previous?.operation?.id !== next.operation.id || previous.operation.status !== "finished")) devices.delete(next.operation.device);
  // Support belongs to this host/read; omission must not retain a previous host's limits.
  return { ...next, devices: [...devices.values()] };
}

// Scans, pairing and connections run in BlueZ after the request returns.
export const bluetoothQuery = (credentials: ApiCredentials) =>
  queryOptions({
    queryKey: ["bluetooth"],
    queryFn: async ({ client, queryKey, signal }) => bluetoothView(client.getQueryData<ListedBluetoothState>(queryKey), await apiJson<BluetoothState>(credentials, "/api/bluetooth", { signal })),
    refetchInterval: query => query.state.data?.operation?.status === "running" ? 1_000 : false,
    retry: false,
  });

// A display preview reverts on the host when its confirmation window expires.
export const displayQuery = (credentials: ApiCredentials) =>
  queryOptions({
    queryKey: ["display"],
    queryFn: ({ signal }) => apiJson<DisplayState>(credentials, "/api/display", { signal }),
    refetchInterval: query => query.state.data?.preview ? 1_000 : false,
    retry: false,
  });

export const startupQuery = (credentials: ApiCredentials) =>
  queryOptions({
    queryKey: ["settings", "startup"],
    queryFn: ({ signal }) => apiJson<StartupState>(credentials, "/api/settings/startup", { signal }),
  });

export const streamingCommunityQuery = (credentials: ApiCredentials) =>
  queryOptions({
    queryKey: ["settings", "streaming-community"],
    queryFn: async ({ signal }) => {
      const { origin } = await apiJson<{ origin?: string }>(credentials, "/api/settings/streamingcommunity", { signal });
      if (!validStreamingCommunityOrigin(origin)) throw new Error("Could not read the website origin.");
      return { origin: origin! };
    },
  });

export const originDomainQuery = (credentials: ApiCredentials, urls: string[]) =>
  queryOptions({
    queryKey: ["settings", "origin-domain", urls],
    queryFn: ({ signal }) => apiJson<{ domain: string; suggested?: string }>(credentials, "/api/settings/origin-domain", { signal }),
  });

export const lanHttpQuery = (credentials: ApiCredentials) =>
  queryOptions({
    queryKey: ["devices", "http"],
    queryFn: ({ signal }) => apiJson<{ enabled: boolean }>(credentials, "/api/settings/http", { signal }),
  });

export const liveRelayQuery = (credentials: ApiCredentials) =>
  queryOptions({ queryKey: ["live-relay"], queryFn: () => apiJson<LiveRelaySettings>(credentials, "/api/settings/live-relay"), retry: false });

export const localRelayQuery = (credentials: ApiCredentials) =>
  queryOptions({ queryKey: ["local-relay"], queryFn: () => apiJson<LocalRelayState>(credentials, "/api/settings/live-relay/local"), refetchInterval: query => query.state.data?.enabled ? 1000 : false, retry: false });
