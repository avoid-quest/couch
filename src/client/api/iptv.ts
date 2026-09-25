import { queryOptions } from "@tanstack/react-query";
import type { GuideSource } from "../../shared/iptv";
import { apiJson, type ApiCredentials } from "./client";

export const iptvSourcesQuery = (credentials: ApiCredentials) =>
  queryOptions({
    queryKey: ["iptv", "sources"],
    queryFn: ({ signal }) => apiJson<{ sources: GuideSource[] }>(credentials, "/api/iptv/sources", { signal }),
  });

