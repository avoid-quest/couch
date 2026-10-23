import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { ALL } from "../apps/web/src/pages/u/[...path]";

afterEach(() => { mock.restore(); });

function proxy(path: string, init?: RequestInit) {
  return ALL({ params: { path }, request: new Request(`https://couch.avoid.quest/u/${path}`, init) } as Parameters<typeof ALL>[0]);
}

test("the tracker stays on the fixed upstream and caches no cookies", async () => {
  const upstream = spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    expect(String(url)).toBe("https://umami.net-work.studio/script.js");
    const headers = new Headers(init?.headers);
    expect(headers.has("cookie")).toBe(false);
    expect(headers.has("authorization")).toBe(false);
    return new Response("window.umami = {};", { headers: { "Content-Type": "application/javascript", "Set-Cookie": "session=private" } });
  });
  const response = await proxy("script.js", { headers: { Cookie: "private", Authorization: "Bearer private" } });
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("window.umami = {};");
  expect(response.headers.get("Content-Type")).toBe("application/javascript");
  expect(response.headers.get("Cache-Control")).toBe("public, max-age=3600");
  expect(response.headers.has("Set-Cookie")).toBe(false);
  expect(upstream).toHaveBeenCalledTimes(1);
});

test("download events preserve target OS, format, channel and session metadata with the trusted visitor IP", async () => {
  const event = { type: "event", payload: { website: "90980392-7c3c-43f4-96c2-cff6645daa5a", name: "download", data: { os: "linux", format: "deb", channel: "preview" }, ip: "spoofed" } };
  spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const request = new Request(url, init);
    expect(request.url).toBe("https://umami.net-work.studio/api/send");
    expect(request.method).toBe("POST");
    expect(request.headers.get("user-agent")).toBe("Visitor browser");
    expect(request.headers.get("x-umami-cache")).toBe("session-token");
    expect(request.headers.get("x-umami-website-id")).toBe(event.payload.website);
    expect(request.headers.get("x-umami-hostname")).toBe("couch.avoid.quest");
    expect(await request.json()).toEqual({ ...event, payload: { ...event.payload, ip: "2001:db8::42" } });
    return Response.json({ cache: "next-session-token" });
  });
  const response = await proxy("api/send", {
    method: "POST", body: JSON.stringify(event),
    headers: { "Content-Type": "application/json", "User-Agent": "Visitor browser", "CF-Connecting-IP": "2001:db8::42", "x-umami-cache": "session-token", "x-umami-website-id": event.payload.website, "x-umami-hostname": "couch.avoid.quest" },
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({ cache: "next-session-token" });
});

test("without Cloudflare's header the proxy removes client-supplied IPs", async () => {
  spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    expect(await new Request(url, init).json()).toEqual({ type: "event", payload: { url: "/" } });
    return Response.json({});
  });
  expect((await proxy("api/send", { method: "POST", body: JSON.stringify({ type: "event", payload: { url: "/", ip: "spoofed" } }) })).status).toBe(200);
});

test("unrelated APIs, unsupported methods and invalid events never reach Umami", async () => {
  const upstream = spyOn(globalThis, "fetch");
  expect((await proxy("api/auth/login", { method: "POST" })).status).toBe(404);
  expect((await proxy("/elsewhere.example/script.js")).status).toBe(404);
  const script = await proxy("script.js", { method: "POST" });
  expect(script.status).toBe(405);
  expect(script.headers.get("Allow")).toBe("GET, HEAD");
  expect((await proxy("api/send")).status).toBe(405);
  for (const body of ["{", "null", "{}", '{"payload":[]}']) {
    expect((await proxy("api/send", { method: "POST", body })).status).toBe(400);
  }
  expect(upstream).not.toHaveBeenCalled();
});

test("upstream errors and redirects are uncached and cannot redirect the browser off-origin", async () => {
  const upstream = spyOn(globalThis, "fetch").mockResolvedValue(new Response("Unavailable", { status: 503 }));
  const failed = await proxy("script.js");
  expect(failed.status).toBe(503);
  expect(failed.headers.get("Cache-Control")).toBe("no-store");
  upstream.mockResolvedValue(Response.redirect("https://elsewhere.example", 302));
  const redirected = await proxy("script.js");
  expect(redirected.status).toBe(502);
  expect(redirected.headers.has("Location")).toBe(false);
  expect(redirected.headers.get("Cache-Control")).toBe("no-store");
  upstream.mockRejectedValue(new TypeError("fetch failed"));
  expect((await proxy("script.js")).status).toBe(502);
});

test("HEAD serves the tracker headers without a body", async () => {
  spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    expect(init?.method).toBe("HEAD");
    return new Response(null, { headers: { "Content-Type": "application/javascript" } });
  });
  const response = await proxy("script.js", { method: "HEAD" });
  expect(response.status).toBe(200);
  expect(response.body).toBeNull();
  expect(response.headers.get("Content-Type")).toBe("application/javascript");
});
