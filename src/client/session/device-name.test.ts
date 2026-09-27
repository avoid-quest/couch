import { beforeEach, expect, test } from "bun:test";
import { setupUiTests } from "@/testing/react";
import { clientDeviceName, rememberClientDeviceName } from "./device-name";

setupUiTests();
beforeEach(() => localStorage.clear());

test("uses the paired name and migrates a meaningful legacy remote name", () => {
  localStorage.setItem("couch.remote-name", "Study laptop");
  expect(clientDeviceName()).toBe("Study laptop");
  expect(clientDeviceName("Paired laptop")).toBe("Paired laptop");
  rememberClientDeviceName("Study laptop");
  expect(localStorage.getItem("couch.device-name")).toBe("Study laptop");
  expect(localStorage.getItem("couch.remote-name")).toBeNull();
});

test("replaces the generic legacy remote name with a sensible browser name", () => {
  localStorage.setItem("couch.remote-name", "My remote");
  expect(clientDeviceName()).toBe("Couch browser");
});
