import { expect, test } from "bun:test";
import { createRemoteAccess } from "./remote-access";

const origin = "https://couch.example:8443";
const host = "couch.example:8443";
const proxy = "127.0.0.1";
const access = createRemoteAccess({ origin, trustedProxyIps: [proxy] });
const request = (headers: HeadersInit = {}) => new Request("http://127.0.0.1:4100/api/connection", { headers: { host: "127.0.0.1:4100", ...Object.fromEntries(new Headers(headers)) } });
const external = (headers: HeadersInit = {}) => request({ host, "x-forwarded-host": host, "x-forwarded-proto": "https", ...Object.fromEntries(new Headers(headers)) });

test("requires a canonical HTTPS origin and exact literal proxy addresses", () => {
  for (const value of ["invalid", "http://couch.example", `${origin}/`, `${origin}/path`, `${origin}?`, `${origin}#`, "https://user:secret@couch.example", "https://COUCH.example", "https://couch.example:443", ` ${origin}`, `${origin}\\`]) {
    expect(() => createRemoteAccess({ origin: value, trustedProxyIps: [proxy] })).toThrow("canonical HTTPS origin");
  }
  for (const ips of [[], ["localhost"], ["127.0.0.1:4100"], ["127.0.0.0/8"], [" 127.0.0.1"], ["999.0.0.1"], ["fe80::1%eth0"], ["[::1]"]]) {
    expect(() => createRemoteAccess({ origin, trustedProxyIps: ips })).toThrow("proxy");
  }
  expect(access.origin).toBe(origin);
  expect(access.pairing).toBe(false);
  expect(createRemoteAccess({ origin, trustedProxyIps: [proxy], pairing: true }).pairing).toBe(true);
});

test("disabled external access preserves direct traffic and rejects all forwarded traffic", () => {
  const disabled = createRemoteAccess();
  expect(disabled.origin).toBeUndefined();
  expect(disabled.pairing).toBe(false);
  for (const peer of [proxy, "192.168.1.25", "203.0.113.1"]) {
    expect(disabled.classify(request(), peer)).toBe("direct");
    for (const header of ["Forwarded", "X-Forwarded-For", "X-Forwarded-Host", "X-Forwarded-Proto", "X-Forwarded-Port", "X-Forwarded-Prefix"]) {
      expect(disabled.classify(request({ [header]: "" }), peer)).toBe("rejected");
    }
  }
});

test("ordinary requests retain LAN admission and the configured proxy can make direct requests", () => {
  for (const peer of [proxy, "192.168.1.25", "203.0.113.1"]) {
    expect(access.classify(request(), peer)).toBe("direct");
    expect(access.classify(request({ host }), peer)).toBe("rejected");
  }
});

test("only trusted socket peers can assert external access, irrespective of forwarded client IP", () => {
  expect(access.classify(external(), proxy)).toBe("external");
  expect(access.classify(external({ origin }), proxy)).toBe("external");
  expect(access.classify(external({ "x-forwarded-for": "203.0.113.1, 10.0.0.1" }), proxy)).toBe("external");
  for (const peer of ["", "localhost", "127.0.0.2", "192.168.1.25", "203.0.113.1"]) {
    expect(access.classify(external({ "x-forwarded-for": proxy }), peer)).toBe("rejected");
    expect(access.classify(request({ "x-forwarded-for": proxy }), peer)).toBe("rejected");
  }
});

test("normalizes IPv4-mapped peers and canonical IPv6 without widening proxy trust", () => {
  for (const peer of [proxy, "::ffff:127.0.0.1", "::FFFF:7F00:1", "0:0:0:0:0:ffff:7f00:0001"]) {
    expect(access.classify(external(), peer)).toBe("external");
    expect(createRemoteAccess({ origin, trustedProxyIps: ["::ffff:127.0.0.1"] }).classify(external(), peer)).toBe("external");
  }
  const ipv6 = createRemoteAccess({ origin, trustedProxyIps: ["2001:0db8:0:0:0:0:0:1"] });
  expect(ipv6.classify(external(), "2001:db8::1")).toBe("external");
  expect(ipv6.classify(external(), "2001:db8::2")).toBe("rejected");
});

test("rejects malformed, conflicting or multi-value host, protocol and origin metadata", () => {
  const invalid: HeadersInit[] = [
    { host: "127.0.0.1:4100" }, { host: "evil.example" }, { host: `${host}, ${host}` },
    { "x-forwarded-host": "evil.example" }, { "x-forwarded-host": `${host}, ${host}` }, { "x-forwarded-host": "" },
    { "x-forwarded-proto": "http" }, { "x-forwarded-proto": "HTTPS" }, { "x-forwarded-proto": "https, https" }, { "x-forwarded-proto": "" },
    { origin: "https://evil.example" }, { origin: "null" }, { origin: `${origin}, ${origin}` }, { origin: `${origin}/` },
    { forwarded: `for=203.0.113.1;proto=https;host=${host}` }, { forwarded: "" },
  ];
  for (const headers of invalid) expect(access.classify(external(headers), proxy)).toBe("rejected");
  for (const missing of ["x-forwarded-host", "x-forwarded-proto"]) {
    const value = external();
    value.headers.delete(missing);
    expect(access.classify(value, proxy)).toBe("rejected");
  }
  const duplicate = external();
  duplicate.headers.append("x-forwarded-host", host);
  expect(access.classify(duplicate, proxy)).toBe("rejected");
});
