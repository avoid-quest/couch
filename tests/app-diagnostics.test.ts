import { expect, test } from "bun:test";
import { appDiagnostic } from "../app/diagnostics";
import { redact } from "../packaging/tv/redact.js";
import { sentryOptions } from "../src/shared/sentry";

test("Sentry spans keep route timings without the device address or pairing link", () => {
  const link = "https://living-room.example:4100/pair/tv?token=private#pair=123456";
  const span = sentryOptions.beforeSendSpan({
    name: link,
    attributes: {
      "url.full": link,
      "url.query": "token=private",
      "url.fragment": "pair=123456",
      "server.address": "living-room.example",
      "network.local.address": "192.0.2.1",
      "client.port": 4242,
      "user_agent.original": "another device",
      "http.response.status_code": 200,
    },
  });
  expect(span.name).toBe("/pair/tv");
  expect(span.attributes).toEqual({ "url.full": "/pair/tv", "http.response.status_code": 200 });
});

test("Sentry timings discard private path segments and keep recognized Couch routes", () => {
  const span = sentryOptions.beforeSendSpan({
    name: "GET /api/synthetic-private-title",
    attributes: {
      "url.full": "https://media.example/films/private.m3u8?signature=secret",
      "url.path": "/pair/tv/123456",
      "sentry.segment.name": "GET /api/health",
    },
  });
  expect(span.name).toBe("GET [Filtered]");
  expect(span.attributes).toEqual({
    "url.full": "[Filtered]",
    "url.path": "[Filtered]",
    "sentry.segment.name": "GET /api/health",
  });
});

test("app evidence keeps only hosts for complete URL tokens, including embedded separators", () => {
  for (const separator of ["", "\n", "\u2028"]) {
    for (const quote of ["", "'"]) {
      const line = appDiagnostic(
        "main",
        "error",
        `Input refused ${quote}https://synthetic-user:synthetic-password@media.example/movie's/private?sig=synthetic${separator}suffix${quote}`,
      );
      expect(line).toContain("media.example");
      for (const value of ["https://", "synthetic", "movie", "private", "sig=", "suffix"])
        expect(line).not.toContain(value);
      expect(line).not.toMatch(/[\p{Cc}\u2028\u2029]/u);
    }
  }
});

test("app evidence redacts explicit credentials and filesystem paths", () => {
  for (const value of [
    "Authorization: Bearer synthetic-secret",
    "Cookie: session=synthetic-secret",
    "Bearer synthetic-secret",
    "password='synthetic secret'",
    'token="synthetic secret"',
    "api_key=synthetic-secret",
    "sig=synthetic-secret",
    "/Users/synthetic/private.txt",
    "C:\\Users\\synthetic\\private.txt",
    "\\\\server\\synthetic\\private.txt",
    "./synthetic/private.txt",
    "file:///Users/synthetic/private.txt",
    "data:text/plain,synthetic-secret",
    "blob:https://media.example/synthetic-secret",
  ]) {
    const line = appDiagnostic("update", "error", `Input refused ${value}`);
    expect(line).toContain("Input refused");
    expect(line).not.toContain("synthetic");
    expect(line).not.toContain("private.txt");
  }
});

test("updater cache messages redact unquoted paths containing spaces", () => {
  for (const path of [
    "/Users/review name/synthetic-update.zip",
    "C:\\Users\\review name\\synthetic-update.exe",
  ]) {
    const line = appDiagnostic("update", "info", `Update has already been downloaded to ${path}).`);
    expect(line).not.toMatch(/review|name|synthetic-update/);
  }
});

test("app evidence consumes quoted paths and embedded controls before flattening", () => {
  for (const separator of [" ", "'", '"', "\n", "\u2028"]) {
    for (const path of [
      `/Users/review/private${separator}synthetic-file.txt`,
      `C:\\Users\\review${separator}synthetic-file.txt`,
    ]) {
      for (const quote of ["'", '"']) {
        const line = appDiagnostic(
          "renderer",
          "error",
          `ENOENT: open ${quote}${path}${quote}; refused https://user:pass@media.example/private?sig=synthetic`,
        );
        expect(line).toContain("media.example");
        expect(line).not.toMatch(/synthetic|private|review|user:pass/);
      }
    }
  }
});

test("app evidence redacts JSON credential keys and escaped HTTP error descriptions", () => {
  for (const key of ["token", "password", "secret", "api_key", "sig", "credentials"]) {
    for (const value of [
      "synthetic-credential",
      'synthetic-before"synthetic-after',
      "synthetic-before\\synthetic-after",
    ]) {
      const json = JSON.stringify({ [key]: value, status: 401 });
      for (const message of [json, JSON.stringify(json), `{'${key}':'synthetic credential'}`]) {
        expect(appDiagnostic("update", "error", `Response: ${message}`)).not.toContain("synthetic");
      }
    }
  }
});

// couch-session diagnose shares this rule (packaging/tv/redact.js); these once leaked from its own copy.
test("prefixed credential keys and PINs, quoted values with spaces, home paths and hardware addresses are redacted", () => {
  for (const message of [
    '{"token":"synthetic"}',
    'password="two synthetic words"',
    "access_token=synthetic",
    "x-api-key: synthetic",
    "client_secret='synthetic value'",
    "open ~/synthetic/x",
    '{"pin":"synthetic","pairing_pin":"synthetic"}',
    'pin="synthetic 1"',
    "pin: synthetic",
    '"pins": {"host":"synthetic"}',
    "sink bluez_output.AA_BB_CC_DD_EE_F0.1",
  ]) {
    const line = redact(`Failed: ${message}`);
    expect(line).not.toContain("synthetic");
    expect(line).not.toContain("AA_BB");
  }
});
