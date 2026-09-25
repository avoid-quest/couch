import { queryOptions } from "@tanstack/react-query";
import type { Controller } from "../../shared/controllers";
import { apiJson, type ApiCredentials } from "./client";

// Identity comes from the live session handshake, never a second storage read.
// SessionGate replaces the entire client on a connection or authority change.
export const controllersQuery = (credentials: ApiCredentials) =>
  queryOptions({
    queryKey: ["controllers", "list"],
    queryFn: ({ signal }) => apiJson<{ controllers: Controller[] }>(credentials, "/api/controllers", { signal }).then(value => value.controllers),
    retry: false,
  });

// A pairing code is only shown while its QR is open; never reuse a stale one.
export const pairingCodeQuery = (credentials: ApiCredentials) =>
  queryOptions({
    queryKey: ["controllers", "pairing-code"],
    gcTime: 0,
    queryFn: async ({ signal }) => {
      const { code } = await apiJson<{ code: string }>(credentials, "/api/controllers/pairing-code", { signal }, 10_000);
      if (!/^\d{6}$/.test(code)) throw new Error("Pairing code unavailable");
      return code;
    },
    retry: false,
  });

export const claimCodeQuery = (credentials: ApiCredentials) =>
  queryOptions({
    queryKey: ["controllers", "claim-code"],
    queryFn: ({ signal }) => apiJson<{ code: string }>(credentials, "/api/controllers/claim-code", { signal }),
    retry: false,
  });
