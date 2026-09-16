import { queryOptions } from "@tanstack/react-query";
import type { RecordingsPage } from "../../shared/recordings";
import type { Credentials } from "../session/session";
import { apiFetch } from "./client";

export const recordingsQuery = (credentials: Credentials) =>
  queryOptions({
    queryKey: ["recordings"],
    queryFn: () => apiFetch(credentials, "/api/recordings").then(r => r.json() as Promise<RecordingsPage>),
  });
