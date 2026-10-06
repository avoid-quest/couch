import { expect, test } from "bun:test";
import { appDiagnostic } from "../app/diagnostics";

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
