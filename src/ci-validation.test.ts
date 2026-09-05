import { expect, test } from "bun:test";

test("a selected failing test fails Check", () => expect(true).toBe(false));
