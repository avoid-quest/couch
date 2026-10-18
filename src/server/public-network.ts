import dns, { type LookupAddress, type LookupOptions } from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, connect, isIP, type LookupFunction, type Socket } from "node:net";
import { Readable } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

export class PublicNetworkError extends TypeError {
  readonly code = "ERR_NON_PUBLIC_ADDRESS";
  constructor() { super("The website points to a non-public network address."); }
}

// Conservative public-internet ranges from the IANA special-purpose registries.
// Mapped/translated IPv4, transition mechanisms and unallocated IPv6 are excluded.
const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]] as const) blocked.addSubnet(address, prefix, "ipv6");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");

export function isPublicAddress(address: string): boolean {
  if (address.includes("%")) return false;
  const family = isIP(address);
  return family === 4 ? !blocked.check(address, "ipv4") : family === 6 && globalV6.check(address, "ipv6") && !blocked.check(address, "ipv6");
}

export async function lookupPublic(hostname: string, options: LookupOptions = {}): Promise<LookupAddress[]> {
  const family = isIP(hostname);
  const addresses = family ? [{ address: hostname, family }] : await new Promise<LookupAddress[]>((resolve, reject) => {
    dns.lookup(hostname, { ...options, all: true }, (error, addresses) => error ? reject(error) : resolve(addresses));
  });
  if (!addresses.length || addresses.some(row => isIP(row.address) !== row.family || !isPublicAddress(row.address))) throw new PublicNetworkError();
  return addresses;
}

// Node calls this at socket creation. It connects to these exact checked answers;
// there is no separate preflight lookup that can race a later DNS resolution.
export const publicLookup: LookupFunction = (hostname, options, callback) => {
  void lookupPublic(hostname, options).then(addresses => callback(null, options.all ? addresses : addresses[0]!.address, options.all ? undefined : addresses[0]!.family), error => callback(error, "", 4));
};

function checkedHost(hostname: string): string {
  const host = hostname.replace(/^\[|\]$/g, "");
  // Node bypasses its lookup callback for IP literals.
  if (!host || isIP(host) && !isPublicAddress(host)) throw new PublicNetworkError();
  return host;
}

export function connectPublic(hostname: string, port: number, signal?: AbortSignal): Socket {
  return connect({ host: checkedHost(hostname), port, lookup: publicLookup, signal });
}

// Separate pools ensure a guarded request cannot reuse a socket opened elsewhere.
const agents = { "http:": new http.Agent({ keepAlive: true, lookup: publicLookup }), "https:": new https.Agent({ keepAlive: true, lookup: publicLookup }) };

function target(value: string | URL): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new TypeError("Use an HTTP or HTTPS URL."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new TypeError("Use an HTTP or HTTPS URL without credentials.");
  checkedHost(url.hostname);
  return url;
}

function send(url: URL, method: string, headers: Headers, body: ReadableStream<Uint8Array> | null, signal: AbortSignal): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const request = (url.protocol === "https:" ? https : http).request(url, {
      method, headers: Object.fromEntries(headers), signal, lookup: publicLookup,
      agent: agents[url.protocol as keyof typeof agents],
    }, resolve);
    request.once("error", reject);
    request.once("upgrade", (_response, socket) => { socket.destroy(); reject(new TypeError("HTTP upgrades are not supported.")); });
    if (!body) request.end();
    else {
      const upload = Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]);
      upload.once("error", error => request.destroy(error));
      request.once("close", () => upload.destroy());
      upload.pipe(request);
    }
  });
}

function response(incoming: http.IncomingMessage, url: URL, method: string, redirected: boolean): Response {
  const headers = new Headers();
  for (let index = 0; index < incoming.rawHeaders.length; index += 2) headers.append(incoming.rawHeaders[index]!, incoming.rawHeaders[index + 1]!);
  const empty = method === "HEAD" || [204, 205, 304].includes(incoming.statusCode!);
  let body: Readable = incoming;
  if (!empty) {
    const encoding = headers.get("content-encoding")?.toLowerCase();
    const decoder = encoding === "gzip" ? createGunzip() : encoding === "deflate" ? createInflate() : encoding === "br" ? createBrotliDecompress() : undefined;
    if (decoder) {
      incoming.once("error", error => decoder.destroy(error));
      decoder.once("close", () => incoming.destroy());
      body = incoming.pipe(decoder);
      headers.delete("content-encoding"); headers.delete("content-length");
    }
  } else incoming.resume();
  try {
    const stream = empty ? null : Readable.toWeb(body, { strategy: { highWaterMark: 64 * 1024, size: (chunk: Uint8Array) => chunk.byteLength } }) as ReadableStream<Uint8Array>;
    const result = new Response(stream, { status: incoming.statusCode, statusText: incoming.statusMessage, headers });
    Object.defineProperties(result, { url: { value: url.href }, redirected: { value: redirected } });
    return result;
  } catch (error) { body.destroy(); incoming.destroy(); throw error; }
}

// Extractors can supply custom credentials, so an auth-header denylist is not
// enough. Only media negotiation, provider context and body framing cross origins.
const crossOriginHeaders = new Set(["user-agent", "accept", "accept-language", "accept-encoding", "referer", "origin", "range", "content-type", "content-length"]);
export function stripCrossOriginHeaders(headers: Headers): void {
  for (const name of [...headers.keys()]) if (!crossOriginHeaders.has(name)) headers.delete(name);
  const referer = headers.get("referer");
  if (referer === null) return;
  // Keep public provider context without disclosing a token in the URL.
  try {
    const url = new URL(referer);
    if (/^https?:$/.test(url.protocol)) { headers.set("referer", `${url.origin}/`); return; }
  } catch { /* Malformed referrers carry no safe provider context. */ }
  headers.delete("referer");
}

/** Fetch for untrusted internet media. Every socket and redirect stays public. */
export async function publicFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let url = target(input instanceof Request ? input.url : input);
  const options = { ...init, ...(init?.body instanceof ReadableStream ? { duplex: "half" } : {}) };
  const request = new Request(input, options);
  let method = request.method, body = request.body;
  const headers = new Headers(request.headers);
  // Avoid compressed media unless a server insists; decode such responses above.
  headers.set("accept-encoding", "identity");
  for (let redirects = 0; ; redirects++) {
    request.signal.throwIfAborted();
    headers.set("host", url.host);
    const incoming = await send(url, method, headers, body, request.signal);
    const status = incoming.statusCode!, location = incoming.headers.location;
    if (![301, 302, 303, 307, 308].includes(status) || !location || request.redirect === "manual") return response(incoming, url, method, redirects > 0);
    incoming.destroy();
    if (request.redirect === "error" || redirects === 20) throw new TypeError("The website redirected this request.");
    const next = target(new URL(location, url));
    if (next.origin !== url.origin) stripCrossOriginHeaders(headers);
    if (status === 303 && method !== "HEAD" || [301, 302].includes(status) && method === "POST") {
      method = "GET"; body = null;
      for (const name of ["content-type", "content-length", "transfer-encoding"]) headers.delete(name);
    } else if (body) {
      // Native fetch also cannot replay a streaming upload across a redirect.
      if (!init?.body || init.body instanceof ReadableStream) throw new TypeError("Cannot redirect a streaming request body.");
      body = new Request(next, { method, body: init.body }).body;
    }
    url = next;
  }
}
