import { createHmac } from "node:crypto";
import { object, providerJson } from "./http";

/**
 * The web player's TOTP secrets, newest first, copied as they appear in its bundle (`web-player.<hash>.js`, the array of
 * `{secret, version}` next to `/api/server-time`). Spotify rotates them; docs/providers.md says how to update this list.
 */
export const webPlayerSecrets = [
  { version: 61, secret: ',7/*F("rLJ2oxaKL^f+E1xvP@N' },
  { version: 60, secret: 'OmE{ZA.J^":0FG\\Uz?[@WW' },
  { version: 59, secret: "{iOFn;4}<1PFYKPV?5{%u14]M>/V0hDH" },
];

/** RFC 6238 (SHA-1, 6 digits, 30 s) with the key the web player derives from a secret: each character's code XOR (i mod 33 + 9), in decimal, as UTF-8. */
export function webPlayerTotp(secret: string, seconds: number): string {
  const key = [...secret].map((character, i) => character.charCodeAt(0) ^ ((i % 33) + 9)).join("");
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(seconds / 30)));
  const hash = createHmac("sha1", Buffer.from(key, "utf8")).update(counter).digest();
  const offset = hash[hash.length - 1]! & 15;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

const headers = { Accept: "application/json", "User-Agent": "Mozilla/5.0" };
// A token is renewed this long before Spotify says it expires, so a search never starts with one about to lapse.
const marginMs = 60_000;
// Issuing a token takes up to four requests; with the search's own 12 s it stays within a provider's 30 s.
const issueMs = 15_000;

/** The anonymous token open.spotify.com gives a logged-out visitor, kept until it expires; concurrent callers share one request. */
export function createSpotifyToken(request: typeof fetch) {
  let current: { value: string; expires: number } | undefined;
  let pending: Promise<string> | undefined;

  async function issue(secret: (typeof webPlayerSecrets)[number], signal: AbortSignal) {
    const time = await providerJson(
      "https://open.spotify.com/api/server-time",
      { headers, credentials: "omit", signal },
      request,
    );
    const serverTime = object(time) ? time.serverTime : undefined;
    if (typeof serverTime !== "number" || !Number.isFinite(serverTime))
      throw new Error("Spotify sent no server time.");
    const params = new URLSearchParams({
      reason: "init",
      productType: "web-player",
      totp: webPlayerTotp(secret.secret, Date.now() / 1000),
      totpServer: webPlayerTotp(secret.secret, serverTime),
      totpVer: String(secret.version),
    });
    const token = await providerJson(
      `https://open.spotify.com/api/token?${params}`,
      { headers, credentials: "omit", signal },
      request,
    );
    if (
      !object(token) ||
      typeof token.accessToken !== "string" ||
      !/^[\w-]{20,1024}$/.test(token.accessToken) ||
      typeof token.accessTokenExpirationTimestampMs !== "number"
    )
      throw new Error("Spotify sent no access token.");
    current = { value: token.accessToken, expires: token.accessTokenExpirationTimestampMs };
    return current.value;
  }

  // The newest secret first; once more with the next, in case Spotify has already retired it. Callers share this
  // request, so it keeps its own deadline rather than any one caller's.
  async function renew() {
    const signal = AbortSignal.timeout(issueMs);
    try {
      return await issue(webPlayerSecrets[0]!, signal);
    } catch (error) {
      if (signal.aborted || !webPlayerSecrets[1]) throw error;
      return issue(webPlayerSecrets[1], signal);
    }
  }

  return {
    async token(): Promise<string> {
      if (current && current.expires - marginMs > Date.now()) return current.value;
      pending ??= renew().finally(() => (pending = undefined));
      return pending;
    },
    /** Forget a token Spotify refused, so the next call asks for a new one. */
    drop() {
      current = undefined;
    },
  };
}
