import { isIP } from "node:net";

type HttpsProxyConfig = { origin: string; trustedProxyIps: string[] };
type Admission = "direct" | "proxied" | "rejected";

const normalizeIp = (value: string): string | null => {
  const version = isIP(value);
  if (!version || value.includes("%")) return null;
  if (version === 4) return value;
  const address = new URL(`http://[${value}]`).hostname.slice(1, -1);
  const mapped = /^::ffff:([\da-f]+):([\da-f]+)$/.exec(address);
  if (!mapped) return address;
  const high = parseInt(mapped[1]!, 16), low = parseInt(mapped[2]!, 16);
  return [high >>> 8, high & 255, low >>> 8, low & 255].join(".");
};

/** Forwarded metadata never confers local or native-host authority. */
export function createHttpsProxy(config?: HttpsProxyConfig) {
  let origin: string | undefined, host: string | undefined;
  const proxies = new Set<string>();
  if (config) {
    let url: URL;
    try { url = new URL(config.origin); } catch { throw new Error("Local HTTPS requires a canonical HTTPS origin."); }
    if (url.protocol !== "https:" || url.origin !== config.origin) throw new Error("Local HTTPS requires a canonical HTTPS origin without credentials, paths, query or fragment.");
    if (!config.trustedProxyIps.length) throw new Error("Local HTTPS requires at least one trusted proxy IP address.");
    for (const value of config.trustedProxyIps) {
      const address = normalizeIp(value);
      if (!address) throw new Error("Trusted proxy addresses must be literal IP addresses without ports, subnets or interface names.");
      proxies.add(address);
    }
    origin = url.origin;
    host = url.host;
  }
  return {
    origin,
    classify(request: Request, rawPeer: string): Admission {
      const headers = request.headers;
      const forwarded = [...headers.keys()].some(name => name === "forwarded" || name.startsWith("x-forwarded-"));
      if (!forwarded) return host && headers.get("host") === host ? "rejected" : "direct";
      if (!origin || !proxies.has(normalizeIp(rawPeer) ?? "") || headers.has("forwarded")) return "rejected";
      if (headers.get("host") !== host || headers.get("x-forwarded-host") !== host || headers.get("x-forwarded-proto") !== "https") return "rejected";
      const browserOrigin = headers.get("origin");
      return browserOrigin === null || browserOrigin === origin ? "proxied" : "rejected";
    },
  };
}
