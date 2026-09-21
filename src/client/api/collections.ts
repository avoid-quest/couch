import { queryOptions } from "@tanstack/react-query";
import type { SavedCollection } from "../../shared/collections";
import type { Credentials } from "../session/session";
import { apiFetch } from "./client";

export const collectionsQuery = (credentials: Credentials) =>
  queryOptions({
    queryKey: ["collections"],
    queryFn: ({ signal }) => apiFetch(credentials, "/api/collections", { signal }).then(r => r.json() as Promise<SavedCollection[]>),
  });
