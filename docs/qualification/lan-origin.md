# HTTPS origin software qualification

[Add the ability to set an Origin](https://github.com/avoid-quest/couch/issues/170) passed a real Caddy and Chromium software journey on 2026-09-08. Two browser remotes paired over trusted HTTPS, exchanged authenticated WSS commands and shared state, then retained their identities through separate Caddy and Couch restarts.

This used the official compiled Linux ARM64 Bun sidecar without a native player. It does not establish installed appliance behavior, actual LAN name resolution, phone certificate enrollment or port 80/443 reachability on the intended network. Those deployment requirements keep the issue open. Certificate issuance and retained trust passed; elapsed renewal was not measured.

## Identity and boundaries

| Component | Qualified identity |
| --- | --- |
| Source | `d77af244cf6d1f6aab872e2fee0a11897284815f` |
| Build | Unchanged `scripts/build.ts`, Bun 1.4.2, `aarch64-unknown-linux-gnu`, `packaged: false` |
| Sidecar SHA-256 | `e606f8609db83df5611945e473e6a157d2d035c95b75ac7f77d8fddc054e3fb2` |
| Caddy | Official v2.11.4 Linux ARM64 release, module checksum `h1:XKxkMTgNSizEvKG6QHue6cAsFOteU2qA61w2tKkCWi0=` |
| Caddy archive SHA-256 | `52d42ae12b3462097e9868da6dfed3c9648ae12edd3b3638102312af84cb6904`, matching the official release API digest |
| Browser | Chromium Headless Shell 151.0.7922.34, Playwright revision 1234, Playwright Core 1.62.1 |
| Browser archive SHA-256 | `b03443e1e1a60d06e07b6cdfe650b8c2bfcbb3db497d2b652f73dc6912f4ae15` |
| Ubuntu image | `sha256:d6ee346fcadb8a466236d0e3dd174895c6be3e2d10387a3fbfb99fb2aecde798` |
| Dependencies | libnss3 and libnss3-tools `2:3.98-1ubuntu0.2`; libasound2t64 `1.2.11-1ubuntu0.3` |

The private clone had no tracked source modifications. Its read-only `node_modules` symlink appeared as the sole untracked entry, so the official builder accurately embedded `dirty: true`. The retained `source-status.txt` contains exactly `?? node_modules`. This is not a signed package or a clean release assertion. `frontend.sha256` records every generated frontend asset.

Caddy listened inside one disposable container and proxied the unchanged Couch listener. The test used `https://couch-origin.test:8443`, a process-local Chromium hostname mapping and `tls internal`. Caddy's `skip_install_trust` prevented automatic trust installation. Only the trusted Chromium process's private HOME/NSS database received the generated public root. No host trust store, DNS setting, published port, device or T480 data changed. The other browser process began without that root.

The container had a 1 GiB memory and swap limit, two CPUs and 256 PIDs. An outer 300-second deadline covered preparation and execution; the inner test had a 180-second limit. The final run took approximately nine seconds, including the official Bun build and package preparation. Its container exited normally without OOM and was removed; a separate host check verified its absence. No Rust, native-player or AppImage build ran.

## Observed sequence

All eight named groups passed between 04:05:22.725 and 04:05:24.570 UTC:

1. Actual Caddy TLS served Couch's configured HTTPS origin and reported native playback unavailable.
2. Fresh Chromium rejected the site with `ERR_CERT_AUTHORITY_INVALID` before private trust enrollment.
3. After enrolling only the generated CA, two independent browser contexts at 390×844 and 1024×768 used the real pairing form. Their tokens and controller identities differed. Secure-context, authenticated identity and unauthenticated rejection checks passed.
4. An authenticated WSS queue command appeared in the other browser. Every observed control socket used WSS. The generated media URL was never played or fetched.
5. Actual TLS requests with the wrong Origin, the HTTP twin of the configured HTTPS origin, or invalid authentication were rejected. Caddy returned an empty 200 response for an unmatched Host, without Couch connection details. Couch's separate direct Host guard returned 403 despite forged forwarded headers. These are distinct observations; no proxy-layer 403 is claimed.
6. Caddy stopped and restarted using the same private data. Both browsers reconnected without pairing, and the CA SHA-256 stayed unchanged.
7. Couch stopped and restarted using its same database and exact sidecar. Both controllers and the queue persisted. A WSS removal command from the second browser updated the first.
8. A browser refresh retained its pairing and restored the connected server state, accurately labelled Player unavailable.

The test never enabled `ignoreHTTPSErrors`, `ignore-certificate-errors`, `allow-insecure-localhost` or `disable-web-security`. The pre-trust failure and post-trust browser success establish certificate validation, rather than an ignored certificate error. The browser's NSS database contained only the disposable added CA.

## Evidence and reproduction

The retained passing directory is `/tmp/couch-origin-qualification-20260908/.artifacts/run-tAmte2`. Public evidence includes `result.json`, `qualification-receipt.json`, `cleanup.json`, `phone.png`, installed versions, embedded build metadata and source/frontend/sidecar hashes. Public manifest SHA-256 is `2d01a51295331a4bf49ec56484ca6e0b1fe93aa6660748ce2ce529dd3a532a6a`. Generated tokens, database and CA private material stay in the private directory and are excluded from the public manifest.

The original `result.json` limits text calls this a source coordinator. The separate qualification receipt corrects that wording: the passing run launched the official compiled sidecar. Original results remain unchanged.

[The runner](../../tests/linux/origin.ts) and [container script](../../tests/linux/origin-run.sh) use a read-only `/inputs` directory containing the pinned Caddy/browser archives, copied Playwright and Linux application dependencies, and a Git bundle for the exact source revision. A fresh writable `/artifacts` directory retains each attempt. The private `.artifacts/launch.ts` recipe enforces container bounds and removal in `finally`; it must run only in the coordinator's granted resource window. Inputs are never mounted writable into another worker's caches. The [operator guide](../lan-origin.md) remains the deployment procedure.

Four earlier attempts are retained:

- `run-xBUZLe` omitted `src-tauri/tauri.conf.json` from a temporary source copy. The coordinator failed before serving the app.
- `run-s2h4k0` passed the TLS discovery check, then used the wrong executable path for the actual Chromium archive layout.
- `run-wHhQWe` passed TLS discovery and the untrusted-browser rejection, then found a blank source-mode frontend.
- `run-Kz4YgR` retained browser diagnostics for that failure: HTTP 200 and loaded assets, followed by `ReferenceError: process is not defined` before React rendered. This remains a separate development/startup finding. The normal compiled builder supplies the frontend build constant; source-mode behavior must be assessed against the documented development commands.

All failed containers were removed. No failed attempt is counted as a complete journey.

The upstream mechanisms used are Caddy's [local certificates](https://caddyserver.com/docs/automatic-https#local-https), [skip_install_trust](https://caddyserver.com/docs/caddyfile/options#skip_install_trust) and [HTTP reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy), plus Chromium's [Linux NSS trust database](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/linux/cert_management.md).
