import { ControllerError } from "./devices";
import type { LiveRelay } from "../shared/live-relay";

export function parseLiveRelay(value: unknown): LiveRelay | null {
  if (value === null) return null;
  if (typeof value !== "object" || !value) throw new ControllerError("Enter a TURN address, username and password.");
  const { urls, username, credential } = value as Partial<LiveRelay>;
  if (typeof urls !== "string" || urls.length > 2048 || !/^turns?:[^/\s?#@]+(?:\?transport=(?:tcp|udp))?$/.test(urls)
    || typeof username !== "string" || !username || username.length > 1024
    || typeof credential !== "string" || !credential || credential.length > 1024) {
    throw new ControllerError("Enter a turn: or turns: address and a username and password.");
  }
  return { urls, username, credential };
}

// Standard TURN configuration is optional; Core's LAN STUN remains the default.
export function liveTurnFromEnvironment(environment: NodeJS.ProcessEnv): RTCIceServer | undefined {
  const urls = environment.COUCH_LIVE_TURN_URL, username = environment.COUCH_LIVE_TURN_USERNAME, credential = environment.COUCH_LIVE_TURN_CREDENTIAL;
  if (!urls && !username && !credential) return;
  if (!urls || urls.length > 2048 || !/^turns?:[^/\s?#]+(?:\?transport=(?:tcp|udp))?$/.test(urls)
    || !username || username.length > 1024 || !credential || credential.length > 1024) {
    throw new Error("Set COUCH_LIVE_TURN_URL to a turn: or turns: URL and provide COUCH_LIVE_TURN_USERNAME and COUCH_LIVE_TURN_CREDENTIAL.");
  }
  return { urls, username, credential };
}
