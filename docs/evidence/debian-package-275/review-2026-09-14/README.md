# Review fixes and rebuilt candidate

This follow-up covers the 16 review comments on PRs [#278](https://github.com/avoid-quest/couch/pull/278),
[#279](https://github.com/avoid-quest/couch/pull/279) and
[#280](https://github.com/avoid-quest/couch/pull/280). Five fresh agents implemented
bounded fixes in separate worktrees. Their commits were integrated into the
owning stack layers before these checks.

Fourteen comments are addressed by code, corrected documentation or an explicit
installer-layer dependency. Two valid findings remain with #276 under the owner's
scope split: migrating the paused Ubuntu Package workflow and adapting installed
updates/relaunch to ordinary desktops. No desktop A-to-B update support is claimed
here. The old proxy/TLS guide is historical; existing POCs require no migration.

## Candidate identity

The AppImage and both archives come from the same clean source revision,
[`3f70d417072cdf1bea6e21b02839bb8b882aa1e2`](https://github.com/avoid-quest/couch/commit/3f70d417072cdf1bea6e21b02839bb8b882aa1e2).
[The manifest](candidate.json) records every asset's size and SHA-256, the detached
signatures, disposable public-key identity, build metadata and selected tools.

The AppImage is 289,057,272 bytes, SHA-256
`929da8c7e9521e203570a11e01e173d7cd89b1c87c0ab20b40f1cb24db94310b`.
Version `0.1.0` identifies a local test candidate. It is not an enrolled release.
The [earlier candidate record](../README.md) retains its original identities and
checks; none of those bytes have been relabeled as this build.

AppImage script downloads now use source commits. Binary downloads use exact
GitHub asset IDs or retained dated releases. The output plugin is
`1-alpha-20250213-1`, and type2-runtime is release `20251108`, commit `dd6cebe`,
with a 944,632-byte prefix. All six selected downloads passed their pinned hashes.
Upstream releases are not marked immutable; these pins prevent silent replacement
but cannot guarantee that upstream will retain assets indefinitely.

The retained Mac build container uses the same Debian 13 snapshot, Bun 1.4.2,
Rust 1.98.1 and dependency versions as the first record. Its complete package list
is byte-identical to [build-packages.tsv](../build-packages.tsv), including the
previously documented addition of `file`. This reused container was not rebuilt
from an empty image or dependency cache. The Dockerfile already declares `file`.
The [new compressed inventory](appimage-inventory.json.gz) records 2,004 files or
links and 499 ELF inspections, with the final build inputs and library ownership.

## Validation

| Check | Result |
| --- | --- |
| TypeScript typecheck | Passed |
| Bun suite, documented clock isolation | 1,236 passed, 23 skipped, 0 failed; 10,251 assertions across 130 files |
| Locked native protocol tests in release profile | 11 passed |
| Linux ELF inventory regression tests | 12 passed; 37 assertions |
| Complete AppImage build and repeat | Passed; byte-identical with compiler/dependency caches retained |
| Setup and dependency-material archive repeats | Both byte-identical |
| Real Minisign verification | AppImage and both archives passed |
| Signed installer/recovery fixture | Passed in a fresh disposable Debian container, including offline execution |
| Paused Check workflow's exact installer command | Passed locally in its pinned Debian 13 container |
| Archive allowlists | Setup has 36 entries; dependency material has 2,474; no absolute/traversal paths or links |
| Diagnostic Debian FUSE and helpers | Passed for the newly signed candidate from a separate path |

The first unsplit Bun run had one startup timeout in the existing display-session
fixture during concurrent compilation. The test and application code were unchanged
for the documented split rerun above, which passed. The skipped tests include
Linux-only inventory checks that passed separately in Debian and hardware/live
media checks that this Mac suite does not perform.

The inventory now rejects failed or empty `ldd` inspections. A dependency-free
exception requires a valid x86_64 ELF executable/shared object, load segments and
no interpreter or needed libraries, as checked by `readelf`. Regression fixtures
cover static binaries, malformed/truncated/wrong-architecture ELF and inspection
command failures. The actual package passed without unexpected host-library
fallbacks. This static inventory does not establish execution of every GUI,
codec or dynamically loaded path.

Installer checks use real Minisign, filesystem operations, accounts and lock
contention, with doubles for APT, services and successful FUSE access. They now
cover interrupted APT and boot setup, shared desktop/TV installation-recovery
locks, an attempted state-directory lock bypass, and preservation of administrator
power-policy overrides and masks. Explicit TV setup includes the existing lid
policy. The documented reboot applies it.

Maintenance checks cover Debian and Debian-Security upgrade counts, the generic
APT endpoint and removal of browser-requested host repair. LAN checks cover
multiple addresses on one NIC, optional alias failure/recovery, direct-IP
availability, Host/Origin admission, and listener changes during pending DNS.
They reuse the first-use work already merged through #272 and #273.

## Retained diagnostic clone

The [retained UTM reuse instructions](https://github.com/avoid-quest/couch/blob/7bcc7f7090948e0d355b6a4e02ee3b2d408de9a7/docs/evidence/fresh-install-debian-2026-09-14/utm/README.md)
were read before starting only the existing #275 diagnostic clone. Both original
probes and both pristine baselines stayed stopped. The clone still ran Debian
13.7 and kernel `6.12.107+deb13-amd64` with its previously provisioned host packages.

Minisign verified the new AppImage before it ran. A separate candidate copy
mounted with FUSE under the unprivileged runtime account and reported the clean
source identity above. Its helper hashes matched the inventory. Bundled Deno
returned `42` for `6 * 7`; yt-dlp reported `2026.08.19`; ffprobe decoded a generated
one-second 8 kHz mono PCM WAV. No host Bun, Cargo, Rust, compiler, ffprobe, ffmpeg,
yt-dlp or Deno command was present on PATH.

Before/after records were byte-identical for the existing installed AppImage,
administrator session environment and data sentinel, as well as disabled LightDM
and the `multi-user.target` default. No installer or APT command ran against that
existing installation during this follow-up. The clone shut down through UTM's
guest shutdown request, and all retained VMs are stopped. The build container is
also stopped and retained.

These are packaging and installer checks for #275. Hosted releases and desktop
update/relaunch remain #276 work. Final pristine Debian GUI, TV boot, playback,
loaded-library traces and Mac-offline signed update acceptance remain #277 work.
Actions stayed disabled. Nothing was published or deployed, and no physical
TV device was changed. The ticket remains open for review and merge.
