import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { BrowserWindow, MenuItemConstructorOptions } from "electron";
import { desktopNavigation, loadCouch } from "../app/navigation";

test("only a successful explicit Couch switch clears history", async () => {
  let entries = ["http://old/", "http://old/saved"];
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const window = {
    loadURL: (url: string) => new Promise<void>((yes, no) => {
      resolve = () => { entries.push(url); yes(); };
      reject = no;
    }),
    webContents: { navigationHistory: { clear: () => { entries = entries.slice(-1); } } },
  } as unknown as BrowserWindow;
  const failed = loadCouch(window, "http://unreachable/", true);
  reject(new Error("Connection failed"));
  await expect(failed).rejects.toThrow("Connection failed");
  expect(entries).toEqual(["http://old/", "http://old/saved"]);
  const switched = loadCouch(window, "http://new/", true);
  expect(entries).toHaveLength(2);
  resolve(); await switched;
  expect(entries).toEqual(["http://new/"]);
  entries.push("http://new/saved");
  const reload = loadCouch(window, "http://new/saved");
  resolve(); await reload;
  expect(entries).toContain("http://new/");
});

test("native history menus, swipes and mouse buttons traverse the same bounded history", () => {
  const entries = ["/", "/saved", "/settings"];
  let index = 1;
  const window = Object.assign(new EventEmitter(), { webContents: Object.assign(new EventEmitter(), { send() {}, navigationHistory: {
    canGoBack: () => index > 0, canGoForward: () => index < entries.length - 1,
    goBack: () => { index--; }, goForward: () => { index++; },
  } }) });
  const menu = desktopNavigation(window as unknown as BrowserWindow);
  const [back, forward] = menu.submenu as MenuItemConstructorOptions[];
  const click = (item: MenuItemConstructorOptions) => item.click?.(null!, window as unknown as BrowserWindow, null!);
  expect(back!.accelerator).toBe(process.platform === "darwin" ? "Command+[" : "Alt+Left");
  expect(forward!.accelerator).toBe(process.platform === "darwin" ? "Command+]" : "Alt+Right");
  click(back!);
  expect(entries[index]).toBe("/");
  window.emit("swipe", {}, "left");
  window.emit("app-command", {}, "browser-backward");
  expect(index).toBe(0);
  window.emit("swipe", {}, "right");
  expect(entries[index]).toBe("/saved");
  window.emit("app-command", {}, "browser-forward");
  expect(entries[index]).toBe("/settings");
  click(forward!);
  window.emit("swipe", {}, "right");
  expect(index).toBe(2);
  window.emit("app-command", {}, "browser-backward");
  expect(entries[index]).toBe("/saved");
  for (const direction of ["up", "down"]) window.emit("swipe", {}, direction);
  window.emit("app-command", {}, "media-play-pause");
  expect(index).toBe(1);
});
