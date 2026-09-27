import { afterEach, beforeEach, expect, test } from "bun:test";
import { setupUiTests, testWindow } from "@/testing/react";
import { clientDeviceName, rememberClientDeviceName } from "./device-name";

setupUiTests();
const initialUrl = location.href;
beforeEach(() => localStorage.clear());
afterEach(() => {
  Reflect.deleteProperty(navigator, "userAgent");
  Reflect.deleteProperty(navigator, "userAgentData");
  Reflect.deleteProperty(navigator, "platform");
  Reflect.deleteProperty(window, "__COUCH_NATIVE_HOST__");
  testWindow.happyDOM.setURL(initialUrl);
});
function browser(agent: string, platform = "") {
  Object.defineProperty(navigator, "userAgent", { configurable: true, value: agent });
  Object.defineProperty(navigator, "platform", { configurable: true, value: platform });
}

test("uses the paired name and migrates a meaningful legacy remote name", () => {
  localStorage.setItem("couch.remote-name", "Study laptop");
  expect(clientDeviceName()).toBe("Study laptop");
  expect(clientDeviceName("Paired laptop")).toBe("Paired laptop");
  rememberClientDeviceName("Study laptop");
  expect(localStorage.getItem("couch.device-name")).toBe("Study laptop");
  expect(localStorage.getItem("couch.remote-name")).toBeNull();
});

test("replaces the generic legacy remote name with a sensible browser name", () => {
  browser("Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15", "MacIntel");
  localStorage.setItem("couch.remote-name", "My remote");
  expect(clientDeviceName()).toBe("Mac · Safari");
});

test("fresh browser names describe the device and browser using client hints where available", () => {
  browser("Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/130.0 Safari/537.36", "MacIntel");
  Object.defineProperty(navigator, "userAgentData", { configurable: true, value: { platform: "macOS", mobile: false, brands: [{ brand: "Chromium" }, { brand: "Google Chrome" }] } });
  expect(clientDeviceName()).toBe("Mac · Chrome");
  Reflect.deleteProperty(navigator, "userAgentData");
  browser("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1");
  expect(clientDeviceName()).toBe("iPhone · Safari");
  browser("Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36");
  expect(clientDeviceName()).toBe("Android phone · Chrome");
  browser("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0", "Win32");
  expect(clientDeviceName()).toBe("Windows PC · Edge");
});

test("native machine names apply only before a saved or paired rename", () => {
  browser("Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Safari/605.1.15", "MacIntel");
  testWindow.happyDOM.setURL("tauri://localhost");
  window.__COUCH_NATIVE_HOST__ = true;
  expect(clientDeviceName(undefined, "Kitchen Mac")).toBe("Kitchen Mac");
  localStorage.setItem("couch.device-name", "My laptop");
  expect(clientDeviceName(undefined, "Kitchen Mac")).toBe("My laptop");
  expect(clientDeviceName("Paired laptop", "Kitchen Mac")).toBe("Paired laptop");
});
