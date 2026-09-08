# Signed AppImage publication

The Tauri application feed is separate from Ubuntu/APT session management.
Use the official Tauri signer with a private key in protected administrator
storage. The trusted installer enrolls its public key and feed address; the TV
never discovers trust from an update response. Keep the private key off CI,
source control and the HTTP-served directory. Back it up before enrolling TVs.

Build the target package in local Ubuntu 24.04 x86_64 Docker from a clean
committed source revision. The publisher accepts its already qualified local
directory and needs no GitHub run or artifact download. It checks the clean
packaged build identity and the AppImage hash against the matching runtime
qualification before invoking `bunx --no-install tauri signer sign`.

The private directory must contain exactly one `.AppImage`, `build-info.json`,
`couch-source.tar.gz`, and one `appimage-qualification/ATTEMPT/result.json` from
`tests/package/qualify.ts`. Keep that source and evidence outside the feed.
Run from an installed source checkout on the Mac:

```sh
export TAURI_SIGNING_PRIVATE_KEY_PATH=/absolute/private/tauri-signer/couch.key
bun scripts/publish-appimage.ts /absolute/private/qualified-release \
  /absolute/feed/tauri https://updates.example/tauri/ preview \
  'Release notes for the qualified build'
```

The signer also accepts `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` for a protected key.
Never put a private key or password in command history. The temporary LAN feed
can use its enrolled HTTP address; moving hosting does not change the format.

For a new local build, set `COUCH_RELEASE_ID` before package preparation using
the existing positive `BUILD.ATTEMPT` format, for example
`export COUCH_RELEASE_ID="$(date -u +%Y%m%d%H%M%S).1"`. A UTC build timestamp such as
`20260908123456.1` sorts after the retained GitHub build `34172088324.1` without
changing the installed updater's version format. A fresh build needs a new
identity; requalification, signing and promotion keep the original identity.
This is a local build identifier, not a GitHub run. Preserve the source revision,
build inputs, package hashes and qualification evidence with it.

The installed A-to-B runner accepts a local qualified B directory too. On the
scheduled Linux qualification host, run:

```sh
bun scripts/test-installed-update.ts /absolute/retained-A.AppImage \
  /absolute/private/qualified-B /absolute/private/installed-evidence
```

It uses the same publisher with a disposable key and feed, then the existing
systemd Docker fixture. It does not install on the real TV. The current fixture
still requires a Linux x86_64 runner and real installed qualification; the Mac
publisher alone does not establish that acceptance.

Publication retains immutable AppImage bytes and their original signature under
`releases/BUILD.ATTEMPT/`. It signs standard Tauri JSON plus Couch's exact revision,
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
