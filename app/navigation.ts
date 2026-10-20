import type { BrowserWindow, MenuItemConstructorOptions } from "electron";

/** Native history commands share Chromium's history, including the router's pushState entries. */
export function desktopNavigation(window: BrowserWindow): MenuItemConstructorOptions {
  const history = window.webContents.navigationHistory;
  const back = () => { if (history.canGoBack()) history.goBack(); };
  const forward = () => { if (history.canGoForward()) history.goForward(); };
  window.on("app-command", (_event, command) => {
    if (command === "browser-backward") back();
    else if (command === "browser-forward") forward();
  });
  // Electron exposes macOS's discrete three-finger swipe, not its two-finger scroll gesture.
  window.on("swipe", (_event, direction) => {
    if (direction === "left") back();
    else if (direction === "right") forward();
  });
  return { label: "History", submenu: [
    { label: "Back", accelerator: process.platform === "darwin" ? "Command+[" : "Alt+Left", click: back },
    { label: "Forward", accelerator: process.platform === "darwin" ? "Command+]" : "Alt+Right", click: forward },
  ] };
}
