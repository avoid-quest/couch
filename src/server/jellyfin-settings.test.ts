import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ControllerIdentity } from "../shared/controllers";
import { createJellyfin } from "./jellyfin";
import { createJellyfinSettings } from "./jellyfin-settings";
import { createHub } from "./hub";

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const userId = "b".repeat(32);

function server(authWait?: () => Promise<void>, logoutWait?: () => Promise<void>) {
  const accessToken = `private-token-${crypto.randomUUID()}`;
  let health = 200;
  let logins = 0;
  let logouts = 0;
  const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/System/Info/Public") return Response.json({ Id: "private-server-id", ServerName: "Family library" });
    if (path === "/Users/AuthenticateByName") {
      logins++;
      await authWait?.();
      const body = await request.json() as { Username: string; Pw: string };
      return body.Pw === "private-password" ? Response.json({ User: { Id: userId, Name: body.Username }, AccessToken: accessToken }) : new Response("private upstream failure", { status: 401 });
    }
    if (!request.headers.get("Authorization")?.includes(`Token="${accessToken}"`)) return new Response(null, { status: 401 });
    if (path === "/Users/Me") return health === 200 ? Response.json({ Id: userId, Name: "Family" }) : new Response("private upstream failure", { status: health });
    if (path === "/Items") return Response.json({ Items: [{ Id: "a".repeat(32), Name: "Family movie", Type: "Movie" }], TotalRecordCount: 1 });
    if (path === "/Sessions/Logout") { logouts++; await logoutWait?.(); return new Response(null, { status: 204 }); }
    return new Response(null, { status: 404 });
  } });
  cleanup.push(() => upstream.stop(true));
  const url = `http://127.0.0.1:${upstream.port}`;
  return { url, credentials: { url, username: "Family", password: "private-password" }, health: (status: number) => { health = status; }, logins: () => logins, logouts: () => logouts };
}

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "couch-jellyfin-settings-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "couch.sqlite");
  const jellyfin = createJellyfin(path);
  cleanup.push(() => jellyfin.close());
  let role: ControllerIdentity["authority"] | null = "administrator";
  const identity = (): ControllerIdentity | null => role ? { authority: role, controller: null, claimAvailable: false } : null;
  let changes = 0;
  const notifications: { role: ControllerIdentity["authority"] | null; url: string | null }[] = [];
  const settings = createJellyfinSettings({ jellyfin, invalidate: () => { changes++; notifications.push({ role, url: jellyfin.connection().url }); } });
  const request = (route: string, method = "GET", value?: unknown) => settings.handle(new Request(`http://localhost${route}`, { method, headers: { "Content-Type": "application/json" }, body: value === undefined ? undefined : JSON.stringify(value) }), identity);
  const configuration = () => {
    const db = new Database(path, { readonly: true });
    try { return db.query<{ configuration: string }, []>("SELECT configuration FROM jellyfin WHERE id = 1").get()!.configuration; }
    finally { db.close(); }
  };
  return { jellyfin, settings, request, identity, configuration, notifications, role: (next: typeof role) => { role = next; }, changes: () => changes };
}

test("only an administrator or physical host can manage Jellyfin and read its private address", async () => {
  const upstream = server();
  const context = fixture();
  for (const role of ["controller", null] as const) {
    context.role(role);
    for (const [path, method] of [["/api/jellyfin", "POST"], ["/api/jellyfin", "DELETE"], ["/api/jellyfin/connection", "GET"], ["/api/jellyfin/test", "POST"]]) {
      expect((await context.request(path!, method, method === "POST" ? upstream.credentials : undefined)).status).toBe(role ? 403 : 401);
    }
  }
  expect(upstream.logins()).toBe(0);
  for (const role of ["administrator", "host"] as const) {
    context.role(role);
    expect((await context.request("/api/jellyfin", "POST", upstream.credentials)).status).toBe(200);
    expect(await (await context.request("/api/jellyfin/connection")).json()).toEqual({ connected: true, serverName: "Family library", username: "Family", url: upstream.url });
  }
  context.role("controller");
  const publicStatus = await context.request("/api/jellyfin");
  expect(publicStatus.headers.get("Cache-Control")).toBe("no-store");
  expect(await publicStatus.json()).toEqual({ connected: true, serverName: "Family library", username: "Family" });
  expect(context.configuration()).toContain("private-token");
  expect(context.configuration()).not.toContain("private-password");
});

test("a failed replacement preserves the existing token, account and library on disk", async () => {
  const upstream = server(), replacement = server();
  const context = fixture();
  await context.request("/api/jellyfin", "POST", upstream.credentials);
  const saved = context.configuration();
  const response = await context.request("/api/jellyfin", "POST", { ...replacement.credentials, password: "wrong-secret" });
  expect(response.status).toBe(502);
  expect(await response.text()).not.toMatch(/wrong-secret|127\.0\.0\.1|private/);
  expect(context.configuration()).toBe(saved);
  expect((await context.jellyfin.items()).items[0]?.title).toBe("Family movie");
  expect(context.changes()).toBe(1);
  expect(upstream.logouts()).toBe(0);
});

test("connection tests distinguish rejected credentials from an unavailable server and never change the saved connection", async () => {
  const upstream = server();
  const context = fixture();
  await context.request("/api/jellyfin", "POST", upstream.credentials);
  const saved = context.configuration();
  expect((await context.request("/api/jellyfin/test", "POST")).status).toBe(200);
  for (const code of [401, 403, 503]) {
    upstream.health(code);
    const response = await context.request("/api/jellyfin/test", "POST");
    expect(response.status).toBe(502);
    const text = await response.text();
    expect(text).toContain(code === 503 ? "Could not reach" : "rejected the saved connection");
    expect(text).not.toMatch(/private|127\.0\.0\.1/);
    expect(context.configuration()).toBe(saved);
  }
  expect(context.changes()).toBe(1);
});

for (const nextRole of ["controller", null] as const) test(`a slow login cannot commit after its caller becomes ${nextRole ?? "revoked"}`, async () => {
  const original = server();
  const gate = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>();
  const replacement = server(() => { entered.resolve(); return gate.promise; });
  const context = fixture();
  await context.request("/api/jellyfin", "POST", original.credentials);
  const saved = context.configuration();
  const pending = context.request("/api/jellyfin", "POST", replacement.credentials);
  await entered.promise;
  context.role(nextRole);
  gate.resolve();
  expect((await pending).status).toBe(nextRole ? 403 : 401);
  expect(context.configuration()).toBe(saved);
  expect(replacement.logouts()).toBe(1);
  expect(original.logouts()).toBe(0);
  expect(context.changes()).toBe(1);
});

test("authorization is checked again after a delayed request body before login", async () => {
  const upstream = server(), context = fixture();
  const chunks = new TransformStream<Uint8Array, Uint8Array>();
  const writer = chunks.writable.getWriter();
  const pending = context.settings.handle(new Request("http://localhost/api/jellyfin", { method: "POST", headers: { "Content-Type": "application/json" }, body: chunks.readable }), context.identity);
  await writer.write(new TextEncoder().encode('{"url":'));
  context.role("controller");
  await writer.write(new TextEncoder().encode(`${JSON.stringify(upstream.url)},"username":"Family","password":"private-password"}`));
  await writer.close();
  expect((await pending).status).toBe(403);
  expect(upstream.logins()).toBe(0);
  expect(context.configuration()).toBeNull();
});

for (const action of ["replace", "disconnect"] as const) test(`${action} publishes its authorized configuration change before slow logout, with no later mutation after revocation`, async () => {
  const gate = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>();
  const original = server(undefined, () => { entered.resolve(); return gate.promise; });
  const replacement = server(), context = fixture();
  await context.request("/api/jellyfin", "POST", original.credentials);
  const pending = action === "replace" ? context.request("/api/jellyfin", "POST", replacement.credentials) : context.request("/api/jellyfin", "DELETE");
  await entered.promise;
  const url = action === "replace" ? replacement.url : null;
  expect(context.jellyfin.connection().url).toBe(url);
  expect(context.notifications).toEqual([{ role: "administrator", url: original.url }, { role: "administrator", url }]);
  context.role(null);
  gate.resolve();
  expect((await pending).status).toBe(200);
  expect(context.changes()).toBe(2);
  expect(context.notifications.every(notification => notification.role === "administrator")).toBe(true);
});

test("a claimed phone manages through the HTTP hub while ordinary controllers browse and profiles stay separate", async () => {
  const upstream = server();
  const hostToken = "private-host-token-for-jellyfin-settings-tests";
  const hub = createHub({ hostname: "127.0.0.1", port: 0, databasePath: ":memory:", hostToken, sendPlayer: () => {} });
  cleanup.push(() => hub.close());
  const api = (token: string, path: string, method = "GET", body?: unknown) => fetch(`${hub.origin}${path}`, { method, headers: { Origin: hub.origin, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const pair = async () => (await (await api("", "/api/pair", "POST", { code: hub.pairingCode })).json() as { token: string }).token;
  const owner = await pair(), guest = await pair();
  const { code } = await (await api(hostToken, "/api/controllers/claim-code")).json() as { code: string };
  expect((await api(owner, "/api/controllers/claim", "POST", { code })).status).toBe(200);
  const profiles = await (await api(guest, "/api/profiles")).json();
  expect((await api(guest, "/api/jellyfin", "POST", upstream.credentials)).status).toBe(403);
  expect((await api(owner, "/api/jellyfin", "POST", upstream.credentials)).status).toBe(200);
  expect((await api(guest, "/api/jellyfin/connection")).status).toBe(403);
  expect((await api(guest, "/api/jellyfin/test", "POST")).status).toBe(403);
  const catalog = await (await api(guest, "/api/jellyfin/items")).json();
  expect(catalog).toMatchObject({ total: 1, items: [{ title: "Family movie" }] });
  expect(JSON.stringify({ state: hub.session.state, catalog })).not.toMatch(/private|127\.0\.0\.1/);
  expect(await (await api(guest, "/api/profiles")).json()).toEqual(profiles);
  expect((await api(guest, "/api/controllers/me")).status).toBe(200);
  expect((await api(guest, "/api/jellyfin", "DELETE")).status).toBe(403);
  expect((await api(owner, "/api/jellyfin", "DELETE")).status).toBe(200);
  expect((await api(guest, "/api/jellyfin/items")).status).toBe(409);
});
