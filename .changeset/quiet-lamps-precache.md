---
"couch": patch
---

Wire the installable PWA shell (#338): vite-plugin-pwa precaches the built app
shell only, registration stays in the browser path, and the Tauri webview keeps
its native update path. Every API and WebSocket request remains on the network.
LAN installs still wait on a trusted HTTPS origin.
