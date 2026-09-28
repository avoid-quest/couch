import { queryOptions } from "@tanstack/react-query";
import type { Device } from "../../shared/devices";
import { apiJson, type ApiCredentials } from "./client";

// Identity comes from the live session handshake, never a second storage read.
// SessionGate replaces the entire client on a connection or authority change.
export const devicesQuery = (credentials: ApiCredentials) =>
  queryOptions({
    queryKey: ["devices", "list"],
    queryFn: ({ signal }) => apiJson<{ devices: Device[] }>(credentials, "/api/devices", { signal }).then(value => value.devices),
    retry: false,
  });

// A pairing code is only shown while its QR is open; never reuse a stale one.
export const pairingCodeQuery = (credentials: ApiCredentials) =>
  queryOptions({
    queryKey: ["devices", "pairing-code"],
    gcTime: 0,
    queryFn: async ({ signal }) => {
      const { code } = await apiJson<{ code: string }>(credentials, "/api/devices/pairing-code", { signal }, 10_000);
      if (!/^\d{6}$/.test(code)) throw new Error("Pairing code unavailable");
      return code;
    },
    retry: false,
  });

export const claimCodeQuery = (credentials: ApiCredentials) =>
  queryOptions({
    queryKey: ["devices", "claim-code"],
    queryFn: ({ signal }) => apiJson<{ code: string }>(credentials, "/api/devices/claim-code", { signal }),
    retry: false,
  });
