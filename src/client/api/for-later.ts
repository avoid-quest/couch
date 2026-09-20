import { queryOptions } from "@tanstack/react-query";
import type { ForLaterItem } from "../../shared/for-later";
import type { Credentials } from "../session/session";
import { apiFetch } from "./client";

export const forLaterQuery = (credentials: Credentials) =>
  queryOptions({
    queryKey: ["for-later"],
    queryFn: ({ signal }) => apiFetch(credentials, "/api/for-later", { signal }).then(r => r.json() as Promise<{ items: ForLaterItem[] }>),
  });
