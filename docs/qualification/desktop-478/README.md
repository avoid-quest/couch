# Mac Client-only DMG qualification

## Current evidence

The packaging path targets macOS 26 on Apple Silicon. A preliminary ad-hoc
signed DMG built on macOS 26.6.2 (25G83), arm64, with Bun 1.4.2 and the locked
Rust toolchain. Its app and sidecar were arm64 and linked only Apple system
libraries. The preliminary build used a disposable Tauri updater key and was
made before the final payload-hash and updater-archive build changes. It is not
the qualified release artifact.

An interactive preflight copied that preliminary `.app` from its mounted DMG to
an isolated temporary install path. It launched with `COUCH_DATA_DIR` pointing
to a temporary directory and paired with a temporary Couch host on port 4192.
The host's player was unavailable, as expected for this headless host. After
stopping the host, a relaunch kept the selected address and exposed Retry, Use
this computer and Update this app in the trusted recovery window. Close kept the
app and its private coordinator running; launcher reopen restored the recovery
window; Cmd+Q stopped both processes. The temporary host, install and backend
data were removed. No OS trust or Local Network prompt appeared for this local,
non-quarantined copy. Downloaded-artifact prompt behavior remains unobserved.

This preflight does not satisfy the issue's installed-app acceptance gate. The
test `.app` kept the production `quest.avoid.couch` bundle identity. Although
the backend data directory was separate, WebView local storage wrote an origin
for the temporary host under the user's shared WebKit store. The normal Couch
backend operating-mode file did not change, but that shared WebKit store was
left untouched to protect the user's other Couch session. Do not repeat a
visible installed test in this shared session with only a data-directory
override. Use a separate macOS user session for exact-artifact qualification;
a distinct test bundle and WebView identity is suitable only for preflight.

## Required final gate

- Build a clean committed source revision with the enrolled Tauri updater key.
  Retain the DMG, updater archive, signatures, hashes and
  `.artifacts/mac-inventory.json` privately.
- Mount the exact DMG in a separate Mac user session, copy the app, eject the
  image and launch the installed copy. Record OS build, architecture, account
  scope, app/coordinator/UI identity, bundle path, data path and all trust and
  Local Network prompts. Check the signed sidecar and system library closure
  without Homebrew or a source checkout.
- Pair with a separate host, then check Close, launcher reopen, Quit and
  host-offline recovery from that installed copy. Verify that Quit stops only
  the client's private coordinator, leaves the selected host running and
  retains pairing and mode across restart. Installed upgrade and repair behavior
  belongs to [#490](https://github.com/avoid-quest/couch/issues/490).
