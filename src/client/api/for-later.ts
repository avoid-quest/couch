import { queryOptions } from "@tanstack/react-query";
import type { ForLaterItem } from "../../shared/for-later";
import { apiJson, type ApiCredentials } from "./client";

export const forLaterQuery = (credentials: ApiCredentials) =>
  queryOptions({
    queryKey: ["for-later"],
    staleTime: 30_000,
    queryFn: ({ signal }) => apiJson<{ items: ForLaterItem[] }>(credentials, "/api/for-later", { signal }),
  });
