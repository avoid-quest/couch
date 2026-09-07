# Signed AppImage publication

The Tauri application feed is separate from Ubuntu/APT session management.
Use the official Tauri signer with a private key in protected administrator
storage. The public key and feed address are enrolled by the trusted installer;
the TV must never discover trust from an update response. Keep the key off CI,
source control and the HTTP-served directory. Back it up before enrolling TVs.

Download the exact `couch-appimage-RUN.ATTEMPT` artifact from a successful main
Package run using authenticated `gh run download`. Verify its SHA256SUMS and
retain the matching source and qualification evidence in private storage. The
publisher checks the main run/source identity, retained qualified artifact,
build identity and qualification hash; it signs the unchanged AppImage using
`bunx --no-install tauri signer sign`. Run it from an installed source checkout:

```sh
export TAURI_SIGNING_PRIVATE_KEY_PATH=/absolute/private/tauri-signer/couch.key
python3 scripts/publish-appimage.py /absolute/private/qualified-artifact \
  /absolute/private/qualified-artifact/appimage-qualification/QUALIFICATION/result.json \
  /absolute/feed/tauri https://updates.example/tauri/ preview \
  --notes 'Release notes for the qualified build'
```

The signer also accepts `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` for a protected key.
Never put the private key or password in command history. The existing temporary
LAN transport can use its enrolled HTTP address; moving hosting later does not
change the signed format.

Publication retains immutable AppImage bytes and their original signature under
`releases/RUN.ATTEMPT/`. It signs standard Tauri JSON plus Couch's exact revision,
release ID, size and seven-day expiry. JSON and its adjacent `.sig` switch through
one directory symlink. Republishing renews metadata for the same archive; promoting
to Stable reuses its bytes and signature. A lock serializes publication, and an
older build cannot move a channel backwards. Private source/evidence stay outside
the served tree. Retain signed metadata snapshots so in-flight reads can finish.

The native client verifies metadata before using the official updater, compares
its parsed response to those verified bytes, and verifies stored downloads again
before use. Tauri's install API does not repeat download signature verification.
These checks preserve authenticated build identity and expiry on the LAN feed.

This publisher does not enroll a TV or activate installation. Qualify signed
staging, systemd shutdown/restart, stopped-writer backup and SSH recovery before
migrating an installed appliance or removing its existing updater.
