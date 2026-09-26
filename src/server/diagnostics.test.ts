import { afterEach, expect, jest, test } from "bun:test";
import type { ControllerIdentity } from "../shared/controllers";
import { createDiagnostics } from "./diagnostics";
import { createNativeDiagnostics } from "./diagnostics-native";
import { createDiagnosticLog } from "./diagnostics-log";
import { diagnosticLimits, redactDiagnosticText } from "./diagnostics-redaction";
import { configurationFacts, diagnosticBuild, helperFacts } from "./diagnostics-system";

const administrator: ControllerIdentity = { authority: "administrator", controller: null, claimAvailable: false };
const request = (path = "") => new Request(`http://localhost/api/diagnostics${path}`);
const collectors: ReturnType<typeof createDiagnostics>[] = [];
afterEach(() => { for (const diagnostics of collectors.splice(0)) diagnostics.close(); });
function collector(overrides: Partial<Parameters<typeof createDiagnostics>[0]> = {}) {
  const diagnostics = createDiagnostics({ databasePath: ":memory:", runtime: () => ({ hostname: "localhost", port: 4100, native: false }), native: async () => null, sources: () => [], system: async () => [], helpers: async () => [], ...overrides });
  collectors.push(diagnostics);
  return diagnostics;
}

test("redacts representative credentials, URL paths and signed queries", () => {
  const secrets = ["482913", "known host value", "administrator-only"];
  const inputs = [
    "Administrator code 1847293105", "Pair with 482913", "known%20host%20value", "administrator-only",
    "password=quiet-word token=abc secret='two words'", '"apiKey":"private"',
    "Authorization: Bearer private\nCookie: session=private", "Basic c2VjcmV0",
    "https://user:password@host/private-path?unusualSignature=secret", "file:///private/token", "smb://user:pass@host/share", "rtsp://user:private@host/feed", "https%3A%2F%2Fuser%3Aprivate%40host%2Ffeed",
    "eyJhbGciOiJub25lIn0.eyJzZWNyZXQiOiJ4In0.signature", "-----BEGIN PRIVATE KEY-----\nprivate\n-----END PRIVATE KEY-----",
  ];
  for (const input of inputs) {
    const output = redactDiagnosticText(input, secrets);
    for (const forbidden of [...secrets, "1847293105", "private", "quiet-word", "two words", "unusualSignature", "c2VjcmV0"]) expect(output).not.toContain(forbidden);
  }
  expect(redactDiagnosticText("Native host is ready.")).toBe("Native host is ready.");
  expect(redactDiagnosticText("x".repeat(20000))).toContain("input limit");
  expect(redactDiagnosticText("x".repeat(1000))).toHaveLength(diagnosticLimits.messageCharacters);
});

test("recent log is sanitized, bounded, deduplicated and copied", () => {
  const log = createDiagnosticLog(["482913"]);
  log.add("pair", "482913"); log.add("pair", "482913");
  expect(log.recent()).toHaveLength(1);
  for (let i = 0; i < 100; i++) log.add("source", `Failure ${i}`);
  expect(log.recent()).toHaveLength(80);
  log.recent()[0]!.message = "changed";
  expect(log.recent()[0]!.message).not.toBe("changed");
  log.close();
});

test("ordinary controllers cannot trigger collection or export", async () => {
  let calls = 0;
  const diagnostics = collector({ system: async () => { calls++; return []; } });
  for (const authority of ["controller"] as const) {
    for (const path of ["", "/export"]) expect((await diagnostics.handle(request(path), () => ({ ...administrator, authority }))).status).toBe(403);
  }
  expect((await diagnostics.handle(request(), () => null)).status).toBe(403);
  expect(calls).toBe(0);
});

test("coalesces concurrent reads, bounds export and sanitizes every report section", async () => {
  let calls = 0;
  const diagnostics = collector({ secrets: ["482913"], system: async () => { calls++; return [{ name: "482913", value: "https://private/secret", source: "password=secret" }]; }, native: async () => { throw new Error("Cookie: private"); }, sources: () => [{ name: "482913", status: "error", error: "token=secret" }] });
  const responses = await Promise.all([diagnostics.handle(request(), () => administrator), diagnostics.handle(request("/export"), () => administrator)]);
  expect(calls).toBe(1);
  const text = await responses[1]!.text();
  expect(text.length).toBeLessThan(diagnosticLimits.exportBytes);
  expect(text).not.toContain("482913"); expect(text).not.toContain("private"); expect(text).not.toContain("=secret");
  expect(responses[1]!.headers.get("content-disposition")).toContain("attachment");
  expect(responses[0]!.headers.get("cache-control")).toBe("no-store");
  const report = JSON.parse(text);
  expect(report.native).toBeNull(); expect(report.sources[0].status).toBe("error");
  diagnostics.log.add("later", "Late failure");
  expect((await (await diagnostics.handle(request(), () => administrator)).json()).recent.at(-1).message).toBe("Late failure");
  expect(calls).toBe(1);
});

test("revocation during collection denies the completed report", async () => {
  let identity: ControllerIdentity | null = administrator;
  const gate = Promise.withResolvers<void>();
  const diagnostics = collector({ system: async () => { await gate.promise; return []; } });
  const response = diagnostics.handle(request(), () => identity);
  identity = null; gate.resolve();
  expect((await response).status).toBe(403);
});

test("source and helper failures remain an honest report and mutations are denied", async () => {
  const diagnostics = collector({ sources: () => { throw new Error("private"); }, helpers: async () => { throw new Error("private"); }, system: async () => { throw new Error("private"); } });
  const response = await diagnostics.handle(request(), () => administrator);
  const report = await response.json();
  expect(report.sources[0].status).toBe("unavailable"); expect(report.helpers[0].status).toBe("error"); expect(report.system[0].value).toBeNull();
  expect(JSON.stringify(report)).not.toContain("private");
  expect((await diagnostics.handle(new Request(request(), { method: "POST" }), () => administrator)).status).toBe(405);
});

test("native bridge correlates replies and bounds malformed facts", async () => {
  let id = "";
  const bridge = createNativeDiagnostics(value => { id = value; });
  const pending = bridge.collect();
  bridge.receive("wrong", { facts: [] });
  bridge.receive(id, { facts: Array.from({ length: 100 }, () => ({ name: "fact", value: Infinity, source: "native" })) });
  const report = await pending;
  expect(report!.facts).toHaveLength(40); expect(report!.facts[0]!.value).toBeNull();
  const invalid = bridge.collect(); bridge.receive(id, { bad: true });
  await expect(invalid).rejects.toThrow("invalid report");
  const closed = bridge.collect(); bridge.close(); await expect(closed).rejects.toThrow("disconnected");
  expect(await createNativeDiagnostics().collect()).toBeNull();
  await expect(createNativeDiagnostics(() => { throw new Error("secret"); }).collect()).rejects.toThrow("Couldn't reach the app");
});

test("native timeout is bounded and late replies are ignored", async () => {
  jest.useFakeTimers();
  const bridge = createNativeDiagnostics(() => {});
  try {
    const pending = bridge.collect();
    jest.advanceTimersByTime(2_000);
    await expect(pending).rejects.toThrow("didn't respond");
    bridge.receive("late", { facts: [] });
  } finally { bridge.close(); jest.useRealTimers(); }
});

test("helper commands are fixed and do not inherit credentials", async () => {
  const reports = await helperFacts({ COUCH_YT_DLP: "/fixture/yt-dlp", COUCH_DENO: "/fixture/deno", COUCH_HOST_TOKEN: "private", PATH: "/missing" }, async (command, args, env) => {
    expect(env).toEqual({ PATH: "/missing", LANG: "C", LC_ALL: "C" });
    if (command.endsWith("yt-dlp")) { expect(args).toEqual(["--ignore-config", "--no-plugin-dirs", "--version"]); return "2026.09.01"; }
    throw new Error("Authorization: private");
  });
  expect(reports.map(report => report.status)).toEqual(["ready", "error", "unavailable"]);
  expect(JSON.stringify(reports)).not.toContain("private");
  expect(diagnosticBuild({ version: "secret", revision: "https://private", packaged: "yes" })).toEqual({ version: null, revision: null, target: null, packaged: false });
  expect(JSON.stringify(configurationFacts({ COUCH_ADVERTISE_URLS: "https://private" }, { hostname: "localhost", port: 4100, native: true }))).not.toContain("https://private");
});


test("maximum-size source facts and logs cannot create an unbounded export", async () => {
  const diagnostics = collector({ sources: () => Array.from({ length: 1000 }, () => ({ name: "界".repeat(100), status: "error", error: "界".repeat(500) })), system: async () => Array.from({ length: 100 }, () => ({ name: "界".repeat(80), value: "界".repeat(500), source: "界".repeat(500) })) });
  for (let index = 0; index < 100; index++) diagnostics.log.add(`Source ${index}`, "界".repeat(500));
  const response = await diagnostics.handle(request("/export"), () => administrator);
  expect(response.status).toBe(503);
  expect(Buffer.byteLength(await response.text())).toBeLessThan(diagnosticLimits.exportBytes);
});

test("redacts unknown quoted header and URL credentials in source errors and logs", async () => {
  for (const error of ['{"Cookie":"sid=quiet-word"}', '{"Set-Cookie":"sid=quiet-word; HttpOnly"}', '{"Authorization":"Digest username=owner,response=quiet-word"}', 'https://owner:"quiet-word"@example.test/private', 'https://owner:"two quiet-word words"@example.test/private']) {
    const diagnostics = collector({ sources: () => [{ name: "Provider", status: "Error", error }] });
    diagnostics.log.add("Provider", error);
    const body = await (await diagnostics.handle(request("/export"), () => administrator)).text();
    expect(body).not.toContain("quiet-word");
  }
});


test("a stalled filesystem observation times out without accumulating unfinished probes", async () => {
  let calls = 0;
  const gate = Promise.withResolvers<[]>(), started = Promise.withResolvers<void>();
  jest.useFakeTimers();
  const diagnostics = collector({ system: () => { calls++; started.resolve(); return gate.promise; } });
  try {
    const pending = diagnostics.handle(request(), () => administrator);
    await started.promise;
    jest.advanceTimersByTime(1_500);
    const first = await pending;
    expect(first.status).toBe(200);
    expect((await first.json()).system[0].value).toBeNull();
    jest.advanceTimersByTime(6_000);
    const refreshed = diagnostics.handle(request("/export"), () => administrator);
    jest.advanceTimersByTime(1_500);
    const next = await refreshed;
    expect(next.status).toBe(200);
    expect((await next.json()).system[0].source).toContain("1.5 seconds");
    expect(calls).toBe(1);
  } finally { gate.resolve([]); diagnostics.close(); jest.useRealTimers(); }
});
