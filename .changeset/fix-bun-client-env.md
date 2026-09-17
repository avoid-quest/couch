---
"couch": patch
---

Replace `import.meta.env.DEV` in the Bun-embedded client build: the server
binary's bundled copy of the client crashed with `Cannot read properties of
undefined (reading 'DEV')` because Bun.build does not perform Vite's
`import.meta.env` substitution. Adding the define to the server build fixes the
production client served at the Couch server port.
