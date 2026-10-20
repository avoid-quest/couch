import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { BrowserWindow, MenuItemConstructorOptions } from "electron";
import { desktopNavigation } from "../app/navigation";

test("native history menus, swipes and mouse buttons traverse the same bounded history", () => {
  const entries = ["/", "/saved", "/settings"];
  let index = 1;
  const window = Object.assign(new EventEmitter(), { webContents: { navigationHistory: {
    canGoBack: () => index > 0, canGoForward: () => index < entries.length - 1,
    goBack: () => { index--; }, goForward: () => { index++; },
  } } });
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
