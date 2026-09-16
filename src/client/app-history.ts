import { createBrowserHistory, createHashHistory } from "@tanstack/react-router";
import { isNativeHost } from "./native-context";

// The Tauri webview keeps hash history; the browser client keeps browser history.
export const createAppHistory = () => isNativeHost() ? createHashHistory() : createBrowserHistory();
