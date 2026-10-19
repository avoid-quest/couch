import { expect, test } from "bun:test";
import { appDiagnostic } from "../app/diagnostics";
import { redact } from "../packaging/tv/redact.js";

test("app evidence keeps only hosts for complete URL tokens, including embedded separators", () => {
  for (const separator of ["", "\t", "\n", "\u0085", "\u2028", "\u2029"]) {
    for (const quote of ["", "'", '"']) {
      const line = appDiagnostic("main", "error", `Input refused ${quote}https://synthetic-user:synthetic-password@media.example/movie's/private?sig=synthetic${separator}suffix${quote}`);
      expect(line).toContain("media.example");
      for (const value of ["https://", "synthetic", "movie", "private", "sig=", "suffix"]) expect(line).not.toContain(value);
      expect(line).not.toMatch(/[\p{Cc}\u2028\u2029]/u);
    }
  }
});

test("app evidence redacts explicit credentials and filesystem paths", () => {
  for (const value of [
    "Authorization: Bearer synthetic-secret", "Cookie: session=synthetic-secret", "Bearer synthetic-secret",
    "password='synthetic secret'", 'token="synthetic secret"', "api_key=synthetic-secret", "sig=synthetic-secret",
    "/Users/synthetic/private.txt", "C:\\Users\\synthetic\\private.txt", "\\\\server\\synthetic\\private.txt",
    "./synthetic/private.txt", "file:///Users/synthetic/private.txt", "data:text/plain,synthetic-secret", "blob:https://media.example/synthetic-secret",
  ]) {
    const line = appDiagnostic("update", "error", `Input refused ${value}`);
    expect(line).toContain("Input refused");
    expect(line).not.toContain("synthetic");
    expect(line).not.toContain("private.txt");
  }
});

test("app evidence redacts complete long userinfo before applying its bound", () => {
  const line = appDiagnostic("renderer", "error", `Input refused https://${"synthetic-user".repeat(100)}:synthetic-password@media.example/private?sig=synthetic-secret`);
  expect(line).toContain("media.example");
  expect(line).not.toContain("synthetic");
  expect(line).not.toContain("private");
  expect(line.length).toBeLessThan(100);
});

test("updater cache messages redact unquoted paths containing spaces", () => {
  for (const path of ["/Users/review name/synthetic-update.zip", "C:\\Users\\review name\\synthetic-update.exe"]) {
    const line = appDiagnostic("update", "info", `Update has already been downloaded to ${path}).`);
    expect(line).toContain("Update has already been downloaded to [path]");
    expect(line).not.toMatch(/review|name|synthetic-update/);
  }
});

test("app evidence consumes quoted paths and embedded controls before flattening", () => {
  for (const separator of [" ", "'", "' ", '"', '" ', "\t", "\n", "\r\n", "\u0085", "\u2028", "\u2029"]) {
    for (const path of [`/Users/review/private${separator}synthetic-file.txt`, `C:\\Users\\review${separator}synthetic-file.txt`, `\\\\server\\review${separator}synthetic-file.txt`]) {
      for (const quote of ["'", '"']) {
        const line = appDiagnostic("renderer", "error", `ENOENT: open ${quote}${path}${quote}; refused https://user:pass@media.example/private?sig=synthetic`);
        expect(line).toContain("ENOENT: open [path]");
        expect(line).toContain("media.example");
        expect(line).not.toMatch(/synthetic|private|review|user:pass/);
        expect(line).not.toMatch(/[\p{Cc}\u2028\u2029]/u);
      }
    }
    if (!separator.includes(" ")) {
      expect(appDiagnostic("update", "error", `ENOENT: open /Users/review/private${separator}synthetic-tail`)).not.toContain("synthetic-tail");
    }
  }
});

test("app evidence redacts JSON credential keys and escaped HTTP error descriptions", () => {
  for (const key of ["token", "password", "passwd", "secret", "api_key", "api-key", "signature", "sig", "credential", "credentials"]) {
    for (const value of ["synthetic-credential", 'synthetic-before"synthetic-after', "synthetic-before\\synthetic-after", "synthetic value\\"]) {
      const json = JSON.stringify({ [key]: value, status: 401 });
      for (const message of [json, JSON.stringify(json), `{'${key}':'synthetic credential'}`]) {
        const line = appDiagnostic("update", "error", `Response: ${message}`);
        expect(line).toContain("Response:");
        expect(line).not.toContain("synthetic");
      }
    }
  }
});

// couch-session diagnose shares this rule (packaging/tv/redact.js); these once leaked from its own copy.
test("prefixed credential keys, quoted values with spaces, home paths and hardware addresses are redacted", () => {
  for (const message of ['{"token":"synthetic"}', 'password="two synthetic words"', "access_token=synthetic", "x-api-key: synthetic", "client_secret='synthetic value'", "open ~/synthetic/x", "sink bluez_output.AA_BB_CC_DD_EE_F0.1"]) {
    const line = redact(`Failed: ${message}`);
    expect(line).toStartWith("Failed: ");
    expect(line).not.toContain("synthetic");
    expect(line).not.toContain("AA_BB");
  }
  expect(redact("dpkg-query: no packages found matching couch")).toBe("dpkg-query: no packages found matching couch");
});

test("app failure records carry current ISO time, component and a bounded single line", () => {
  const before = Date.now();
  const line = appDiagnostic("renderer", "error", new Error("Input refused\n\t\u0085\u009b\u2028\u2029" + "x".repeat(400)));
  expect(line).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z renderer error: Input refused /);
  expect(Date.parse(line.slice(0, 24))).toBeGreaterThanOrEqual(before);
  expect(Date.parse(line.slice(0, 24))).toBeLessThanOrEqual(Date.now());
  expect(line.split("renderer error: ")[1]!.length).toBe(300);
  expect(line).not.toMatch(/[\p{Cc}\u2028\u2029]/u);
  expect(line).not.toContain("app-diagnostics.test.ts");
});
