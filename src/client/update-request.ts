import { createId } from "./session";

type Request = { candidateId: string; requestId: string; confirmInterrupt: boolean; version: string; revision: string };
const key = (origin: string) => `couch.update-request:${origin}`;
export function readUpdateRequest(origin: string): Request | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(key(origin)) || "null");
    return value && /^[a-f0-9]{64}$/.test(value.candidateId) && /^[a-f0-9]{32}$/.test(value.requestId) && typeof value.confirmInterrupt === "boolean" && typeof value.version === "string" && typeof value.revision === "string" ? value : null;
  } catch { return null; }
}
export function saveUpdateRequest(origin: string, candidate: { id: string; version: string; revision: string }, confirmInterrupt: boolean): Request {
  const previous = readUpdateRequest(origin);
  if (previous) return previous;
  const value = { candidateId: candidate.id, version: candidate.version, revision: candidate.revision, requestId: createId(), confirmInterrupt };
  window.localStorage.setItem(key(origin), JSON.stringify(value));
  return value;
}
export function clearUpdateRequest(origin: string) { window.localStorage.removeItem(key(origin)); }
