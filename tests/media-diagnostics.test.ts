import { expect, spyOn, test } from "bun:test";
import { logMediaResolution, mediaAddress, mediaHeaders } from "../src/server/media-diagnostics";
import { createPassThrough } from "../src/server/pass-through";

const source = "https://user:password@rr1.googlevideo.com/videoplayback?itag=303&c=TVHTML5&expire=1&ip=203.0.113.7&n=private-challenge&pot=private-token&sig=private-signature";
const headers = { "User-Agent": "Mozilla/5.0 (Macintosh) Chrome/150.0.0.0 private-ua", Referer: "https://private-user:private-password@youtube.com/private-path?secret=private-ref", Origin: "https://private-origin.example", Cookie: "private-cookie", Authorization: "Bearer private-auth" };

test("media addresses expose only known Googlevideo clients and redact IP-literal hosts", () => {
  for (const host of ["googlevideo.com", "rr1.googlevideo.com", "media.example", "evilgooglevideo.com", "googlevideo.com.example"]) {
    const knownHost = host === "googlevideo.com" || host === "rr1.googlevideo.com";
    expect(mediaAddress(`https://${host}/?c=TVHTML5`).client).toBe(knownHost ? "TVHTML5" : null);
    const redacted = mediaAddress(`https://${host}/?c=private-token`);
    expect(redacted.client).toBeNull();
    expect(JSON.stringify(redacted)).not.toContain("private-token");
  }
  for (const [host, family] of [["192.168.1.27", 4], ["0xc0a8011b", 4], ["[2001:db8::27]", 6], ["[::ffff:192.168.1.27]", 6]] as const) {
    const redacted = mediaAddress(`http://${host}/private-path?c=private-token`);
    expect(redacted.host).toBe(`IPv${family}`);
    for (const secret of [host, "private-"]) expect(JSON.stringify(redacted)).not.toContain(secret);
  }
});

test("resolution diagnostics compare per-format context without logging secrets", () => {
  const lines: string[] = [], log = spyOn(console, "log").mockImplementation(line => { lines.push(line); });
  try {
    logMediaResolution("attempt-id", { extractor: "youtube", age_limit: 0, availability: "public", requested_formats: [
      { url: source, format_id: "303", vcodec: "vp9", acodec: "none", protocol: "https", http_headers: headers, cookies: "private-cookies" },
      { url: source.replace("itag=303", "itag=251"), format_id: "251", vcodec: "none", acodec: "opus", protocol: "https", http_headers: headers },
    ] }, {});
    const detail = JSON.parse(lines[0]!.slice(lines[0]!.indexOf("{")));
    expect(detail.streams[0]).toMatchObject({ host: "rr1.googlevideo.com", format: "303", client: "TVHTML5", ipFamily: 4, n: true, pot: true, cookies: true });
    expect(detail.streams[0].expiresInSeconds).toBeLessThan(0);
    expect(detail.streams[0].expectedHeaders.context["user-agent"]).toBe(detail.streams[1].expectedHeaders.context["user-agent"]);
    expect(detail.forwardedHeaders.context["user-agent"]).toBeNull();
    expect(detail.streams[0].expectedHeaders).toMatchObject({ cookie: true, authorization: true, agent: "Chrome", platform: "Macintosh" });
    for (const secret of ["https://", "private-", "password", "203.0.113.7", "videoplayback", "sig="]) expect(lines.join("\n")).not.toContain(secret);
    expect(mediaHeaders({ "user-agent": headers["User-Agent"] }).context["user-agent"]).toBe(detail.streams[0].expectedHeaders.context["user-agent"]);
    expect(mediaAddress("not a URL")).toEqual({ host: "unknown" });
  } finally { log.mockRestore(); }
});

test("header diagnostics emit fixed browser families without numeric identifiers", () => {
  const identifier = "1234567890".repeat(1000);
  for (const [name, family] of [["Chrome", "Chrome"], ["Chromium", "Chromium"], ["Firefox", "Firefox"], ["Version", "Safari"]]) {
    const detail = mediaHeaders({ "User-Agent": `${name}/${identifier}` });
    expect(detail.agent).toBe(family);
    expect(JSON.stringify(detail)).not.toContain("1234567890");
    expect(JSON.stringify(detail).length).toBeLessThan(500);
  }
  expect(mediaHeaders({ "User-Agent": "Couch" }).agent).toBe("Couch");
  expect(mediaHeaders({ "User-Agent": identifier }).agent).toBe("other");
  expect(mediaHeaders({}).agent).toBeNull();
});

test("relay logs each stream's answer and a later 403 without needing a renderer report", async () => {
  const lines: string[] = [], log = spyOn(console, "log").mockImplementation(line => { lines.push(line); });
  let status = 206;
  const requests: Headers[] = [];
  const relay = createPassThrough(() => true, (async (_input, init) => {
    requests.push(new Headers(init?.headers));
    return new Response("bytes", { status, headers: { "Content-Type": "video/webm", "Access-Control-Allow-Origin": "*" } });
  }) as typeof fetch);
  try {
    const main = source.replace("user:password@", ""), audio = main.replace("itag=303", "itag=251");
    const prepared = await relay.prepare("attempt", { source: main, audioSource: audio, publicNetwork: true }, headers, { origin: "http://localhost:1234", userAgent: "Device" }, AbortSignal.timeout(3000));
    for (const url of [prepared.source, prepared.audioSource!, prepared.source]) await (await relay.serve(new Request(url, { headers: { Range: "bytes=0-1048575" } }))).body?.cancel();
    status = 403;
    for (let n = 0; n < 5; n++) await (await relay.serve(new Request(prepared.audioSource!, { headers: { Range: "bytes=1048576-" } }))).body?.cancel();
    expect(lines).toHaveLength(3);
    const details = lines.map(line => JSON.parse(line.slice(line.indexOf("{"))));
    expect(details.map(row => [row.stream, row.status])).toEqual([["main", 206], ["audio", 206], ["audio", 403]]);
    expect(details[2]).toMatchObject({ fetcher: "Core", consumer: "Device", host: "rr1.googlevideo.com", itag: "251", client: "TVHTML5", range: "bytes=1048576-" });
    expect(details[2].headers.context["user-agent"]).toBe(mediaHeaders(headers).context["user-agent"]);
    expect(requests.at(-1)!.get("range")).toBe("bytes=1048576-");
    expect(relay.refused("attempt", prepared.audioSource!)).toBe(403);
    for (const secret of ["https://", "private-", "password", "203.0.113.7", "videoplayback", "sig="]) expect(lines.join("\n")).not.toContain(secret);
  } finally { await relay.close(); log.mockRestore(); }
});

test("relay diagnostics use the sent Range and redact arbitrary extractor values", async () => {
  const lines: string[] = [], log = spyOn(console, "log").mockImplementation(line => { lines.push(line); });
  const requests: Headers[] = [];
  const relay = createPassThrough(() => true, (async (_input, init) => {
    requests.push(new Headers(init?.headers));
    return new Response("bytes", { status: 206 });
  }) as typeof fetch);
  try {
    for (const [extracted, requested, expected] of [
      ["bytes=64-127", undefined, "bytes=64-127"],
      ["bytes=64-127", "bytes=128-", "bytes=128-"],
      ["private-range", undefined, "other"],
    ] as const) {
      const prepared = await relay.prepare("attempt", { source: "http://192.168.1.27/media?c=private-token", publicNetwork: true }, { Range: extracted }, { origin: "http://localhost:1234", userAgent: "Device" }, AbortSignal.timeout(3000));
      await (await relay.serve(new Request(prepared.source, { headers: requested ? { Range: requested } : {} }))).body?.cancel();
      expect(requests.at(-1)!.get("range")).toBe(requested ?? extracted);
      const line = lines.at(-1)!;
      expect(JSON.parse(line.slice(line.indexOf("{")))).toMatchObject({ range: expected, host: "IPv4", responseHost: "IPv4", client: null });
    }
    expect(lines).toHaveLength(3);
    for (const secret of ["192.168.1.27", "private-"]) expect(lines.join("\n")).not.toContain(secret);
  } finally { await relay.close(); log.mockRestore(); }
});
