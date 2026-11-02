import { expect, spyOn, test } from "bun:test";
import { logMediaResolution, mediaAddress } from "../src/server/media-diagnostics";

const source =
  "https://user:password@rr1.googlevideo.com/videoplayback?itag=303&c=TVHTML5&expire=1&ip=203.0.113.7&n=private-challenge&pot=private-token&sig=private-signature";
const headers = {
  "User-Agent": "Mozilla/5.0 (Macintosh) Chrome/150.0.0.0 private-ua",
  Referer: "https://private-user:private-password@youtube.com/private-path?secret=private-ref",
  Origin: "https://private-origin.example",
  Cookie: "private-cookie",
  Authorization: "Bearer private-auth",
};

test("media addresses expose only known Googlevideo clients and redact IP-literal hosts", () => {
  for (const host of ["rr1.googlevideo.com", "evilgooglevideo.com", "googlevideo.com.example"]) {
    expect(mediaAddress(`https://${host}/?c=TVHTML5`).client).toBe(
      host === "rr1.googlevideo.com" ? "TVHTML5" : null,
    );
    const redacted = mediaAddress(`https://${host}/?c=private-token`);
    expect(redacted.client).toBeNull();
    expect(JSON.stringify(redacted)).not.toContain("private-token");
  }
  for (const [host, family] of [
    ["192.168.1.27", 4],
    ["0xc0a8011b", 4],
    ["[2001:db8::27]", 6],
  ] as const) {
    const redacted = mediaAddress(`http://${host}/private-path?c=private-token`);
    expect(redacted.host).toBe(`IPv${family}`);
    for (const secret of [host, "private-"]) expect(JSON.stringify(redacted)).not.toContain(secret);
  }
});

test("resolution diagnostics compare per-format context without logging secrets", () => {
  const lines: string[] = [],
    log = spyOn(console, "log").mockImplementation((line) => {
      lines.push(line);
    });
  try {
    logMediaResolution(
      "attempt-id",
      {
        extractor: "youtube",
        age_limit: 0,
        availability: "public",
        requested_formats: [
          {
            url: source,
            format_id: "303",
            vcodec: "vp9",
            acodec: "none",
            protocol: "https",
            http_headers: headers,
            cookies: "private-cookies",
          },
          {
            url: source.replace("itag=303", "itag=251"),
            format_id: "251",
            vcodec: "none",
            acodec: "opus",
            protocol: "https",
            http_headers: headers,
          },
        ],
      },
      {},
    );
    const detail = JSON.parse(lines[0]!.slice(lines[0]!.indexOf("{")));
    expect(detail.streams[0]).toMatchObject({
      host: "rr1.googlevideo.com",
      format: "303",
      client: "TVHTML5",
      ipFamily: 4,
      n: true,
      pot: true,
      cookies: true,
    });
    for (const secret of [
      "https://",
      "private-",
      "password",
      "203.0.113.7",
      "videoplayback",
      "sig=",
    ])
      expect(lines.join("\n")).not.toContain(secret);
  } finally {
    log.mockRestore();
  }
});
