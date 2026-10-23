import { createHmac, randomBytes } from "node:crypto";
import { isIP } from "node:net";

// Per-run fingerprints compare request context without recording header values or IPs.
const key = randomBytes(32);
const fingerprint = (value: string | null) => value ? createHmac("sha256", key).update(value).digest("hex").slice(0, 12) : null;
const label = (value: unknown) => typeof value === "string" && /^[\w.+-]{1,64}$/.test(value) ? value : null;
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const googlevideoClients = new Set(["WEB", "WEB_EMBEDDED_PLAYER", "WEB_REMIX", "WEB_CREATOR", "ANDROID", "ANDROID_VR", "IOS", "VISIONOS", "MWEB", "TVHTML5", "TVHTML5_SIMPLY"]);

export function mediaAddress(source: string) {
  const url = URL.parse(source);
  if (!url) return { host: "unknown" };
  const expires = Number(url.searchParams.get("expire"));
  const ip = url.searchParams.get("ip");
  const hostFamily = isIP(url.hostname.replace(/^\[|\]$/g, ""));
  const client = url.searchParams.get("c");
  return {
    host: hostFamily ? `IPv${hostFamily}` : url.hostname,
    itag: /^\d{1,5}$/.test(url.searchParams.get("itag") ?? "") ? url.searchParams.get("itag") : null,
    client: (url.hostname === "googlevideo.com" || url.hostname.endsWith(".googlevideo.com")) && client && googlevideoClients.has(client) ? client : null,
    expiresInSeconds: Number.isSafeInteger(expires) && expires > 0 ? Math.round(expires - Date.now() / 1000) : null,
    ipFamily: ip ? isIP(ip) : 0, ip: fingerprint(ip),
    n: url.searchParams.has("n"), pot: url.searchParams.has("pot"),
  };
}

export function mediaHeaders(value: unknown) {
  const entries = object(value) ? Object.entries(value).filter((pair): pair is [string, string] => typeof pair[1] === "string").map(([name, field]) => [name.toLowerCase(), field]) : [];
  const fields = Object.fromEntries(entries);
  const ua = fields["user-agent"] ?? "";
  const agent = /\b(Chrome|Chromium|Firefox|Version)\//.exec(ua)?.[1];
  return {
    agent: agent === "Version" ? "Safari" : agent ?? (ua === "Couch" ? "Couch" : ua ? "other" : null),
    platform: /Windows|Android|iPhone|iPad|Macintosh|Linux/.exec(ua)?.[0] ?? null,
    // Even Referer and Origin can carry credentials. Compare, never print their values.
    context: Object.fromEntries(["user-agent", "referer", "origin", "accept", "accept-language", "sec-fetch-mode"].map(name => [name, fingerprint(fields[name] ?? null)])),
    cookie: !!fields.cookie, authorization: !!fields.authorization,
    encoding: fields["accept-encoding"] === "identity" ? "identity" : fields["accept-encoding"] ? "other" : null,
  };
}

export function logMediaDiagnostic(event: string, attempt: string | undefined, detail: object) {
  console.log(`${new Date().toISOString()} media ${event} ${attempt?.slice(0, 8) ?? "unknown"} ${JSON.stringify(detail)}`);
}

export function logMediaResolution(attempt: string | undefined, info: Record<string, unknown>, headers: unknown) {
  const selected = Array.isArray(info.requested_formats) ? info.requested_formats : [info];
  logMediaDiagnostic("resolved", attempt, {
    extractor: label(info.extractor), ageLimit: typeof info.age_limit === "number" ? info.age_limit : null, availability: label(info.availability),
    forwardedHeaders: mediaHeaders(headers),
    streams: selected.filter(object).slice(0, 2).map(stream => ({
      format: label(stream.format_id), videoCodec: label(stream.vcodec), audioCodec: label(stream.acodec), protocol: label(stream.protocol),
      ...mediaAddress(typeof stream.url === "string" ? stream.url : ""),
      expectedHeaders: mediaHeaders(stream.http_headers ?? info.http_headers), cookies: !!stream.cookies || !!info.cookies,
    })),
  });
}
