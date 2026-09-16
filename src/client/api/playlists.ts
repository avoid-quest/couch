import { queryOptions } from "@tanstack/react-query";
import type { SavedPlaylistSummary } from "../../shared/playlists";
import type { Credentials } from "../session/session";
import { apiFetch } from "./client";

export const playlistsQuery = (credentials: Credentials) =>
  queryOptions({
    queryKey: ["playlists"],
    queryFn: () => apiFetch(credentials, "/api/playlists").then(r => r.json() as Promise<SavedPlaylistSummary[]>),
  });
