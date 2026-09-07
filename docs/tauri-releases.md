# Signed AppImage publication

The Tauri application feed is separate from Ubuntu/APT session management.
Use the official Tauri signer with a private key in protected administrator
storage. The trusted installer enrolls its public key and feed address; the TV
never discovers trust from an update response. Keep the private key off CI,
source control and the HTTP-served directory. Back it up before enrolling TVs.

The Bun publisher downloads the exact `couch-appimage-RUN.ATTEMPT` artifact from
a successful main Package run through the administrator's authenticated GitHub
CLI. It verifies GitHub's archive digest, source/build identity and the matching
runtime qualification before invoking `bunx --no-install tauri signer sign`.
The new private destination retains the source and evidence outside the feed.
Run from an installed source checkout:

```sh
export TAURI_SIGNING_PRIVATE_KEY_PATH=/absolute/private/tauri-signer/couch.key
bun scripts/publish-appimage.ts ARTIFACT_ID /absolute/private/new-release \
  /absolute/feed/tauri https://updates.example/tauri/ preview \
  'Release notes for the qualified build'
```

The signer also accepts `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` for a protected key.
Never put a private key or password in command history. The temporary LAN feed
can use its enrolled HTTP address; moving hosting does not change the format.

Publication retains immutable AppImage bytes and their original signature under
`releases/RUN.ATTEMPT/`. It signs standard Tauri JSON plus Couch's exact revision,
data format, release ID, size and seven-day expiry. JSON and its adjacent `.sig` switch through
one directory symlink. Separate HTTP requests can straddle publication; clients
reject a JSON/signature mismatch and retry. Republishing renews metadata for the
same archive; promoting to Stable reuses its bytes and signature. A lock serializes
publication, and an older build cannot move a channel backwards. Retain signed
metadata snapshots and private source/evidence. After forced termination, confirm
no publisher is running before removing `.publish.lock`; normal failures release it.

The native client verifies metadata before using the official updater, compares
its parsed response with that verified metadata, and verifies stored downloads
again before use. Tauri's install API does not repeat download verification.

Publication does not enroll a TV or activate installation. Qualify signed staging,
systemd shutdown/restart, stopped-writer backup and SSH recovery before migrating
an installed appliance or removing its existing updater.
