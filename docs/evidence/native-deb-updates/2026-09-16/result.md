# In-app updates for the native deb

The app-side deb updater is implemented and qualified as far as this
environment allows. The remaining phone-triggered run on the T480 needs a
published deb release on the CDN and physical hardware; see the end of this
file for exactly what is left.

## Build

The Mac-hosted Debian 13 amd64 builder from docs/packaging.md built the deb
from this revision (a74b51d1a9c5cd8fe8fea6fe73388287159ee51b, 5 commits on
the branch) with a disposable release key instead of the owner-held
production secrets. Bun 1.4.2, Rust 1.98.1, Tauri CLI 2.11.4. Tauri produced
`Couch_0.1.2_amd64.deb` plus its updater signature, and
`scripts/package-deb-verify.ts` passed: 1464 files, native resources,
declared dependencies, broker unit, broker polkit rule and enrolled key
present, no TV policy.

- SHA-256 `2d77de9ca62a8e299a27d134a439c7dd649dcabdfb90590a381a0c1517cb01dd`
- Builder and package provenance: [compiler-image.json](compiler-image.json),
  [package-build.log.gz](package-build.log.gz),
  [package-sha256.txt](package-sha256.txt)
- Package inventory: [deb-inventory.json](deb-inventory.json)

Building the package for the first time since #314 exposed two conflicts on
main that the paused checks let through: the packaging verify still excluded
minisign from Depends after #314 added it for the broker, and the TV-policy
guard rejected the broker's own unit and polkit rule. This branch fixes both
verify assertions and corrects the doc line that claimed the package needs
no minisign.

## Broker install cycle

The broker fixture `tests/package/package-update.sh` passed in a disposable
debian:13 container
([broker-fixture.txt](broker-fixture.txt)).

A longer container run then followed the app's own install sequence with the
built package: install the deb, stage a newer signed package into the
account's `~/.local/share/couch/updates` inbox, run the root broker, and read
the receipt. The receipt recorded `outcome=installed`, the upgraded version
and a sha256 equal to the staged digest, exactly what the native worker
compares before declaring trial and relaunching
([receipt-upgrade.txt](receipt-upgrade.txt)). A deliberately mismatched
signature produced `outcome=failed` with the broker's error line and no
upgrade.

The container's systemd starts the unit and dispatches ExecStart, but
container-mode systemd cannot exec anything here (`/bin/echo` as a unit fails
identically), and polkit's active-local-session grant needs a real logind
seat. Unit start through systemd and the polkit authorization are therefore
hardware work, together with the relaunch observation.

## What passed locally

- `cargo test --lib`: 35 tests, including receipt parsing (bounded key=value
  lines, digest and final-version validation, unknown keys, UTF-8 and size
  limits) and the version policy (prerelease suffixes, build metadata, equal
  and older releases rejected).
- `bun test`: 1282 tests across 134 files, including the new deb sidecar
  worker tests (check/stage correlation, progress forwarding, idle intent,
  repair mapping) and the full existing suite.
- `tsc --noEmit` reports one pre-existing error on main
  (scripts/hosted-release.test.ts fetch conversion, unrelated to this work).

## Remaining for full acceptance

1. Publish the first deb release to the CDN (the deb update platform answers
   400 "Unknown update platform" today; see
   [feed-status.txt](feed-status.txt)) and confirm a real check plus stage
   against it.
2. Install the deb on the T480, stage a newer release, trigger install from
   the paired phone, and record the receipt, restart and post-restart health
   on real hardware, including the polkit active-session path for the desktop
   and TV accounts.
