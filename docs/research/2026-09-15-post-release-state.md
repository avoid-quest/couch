# Couch after the first public release

Checked on 15 September 2026 against fetched Git state, the GitHub API, recent
issues and PR comments, the public download page, and public release payloads.
Four agents investigated installation, publishing, artifact privacy and GitHub
history in parallel. This is an assessment and proposed work order. No product
code, deployment, release, issue or PR was changed.

## Current baseline

- The initial checkout was clean. Local `main` and freshly fetched `origin/main`
  both point to `2d1ddda88d4cafca534562ba1f82baf4a3013e01`.
- [PR #296](https://github.com/avoid-quest/couch/pull/296) merged on 15 September
  at 10:50:18 UTC and records Stable 0.1.0 publication. Its app was built from
  `61739ad7ce782da5482067f16a5727306cd65d6a`. The later main commits contain
  publication and acceptance records rather than another app build.
- GitHub had no open PRs and one open issue,
  [#295](https://github.com/avoid-quest/couch/issues/295), for actionable rejected
  update-download errors and recovery. It explicitly has no blocker.
- [#275](https://github.com/avoid-quest/couch/issues/275),
  [#276](https://github.com/avoid-quest/couch/issues/276) and
  [#277](https://github.com/avoid-quest/couch/issues/277) are closed. The owner
  accepted the release while deferring pristine desktop qualification, some
  failure/activity/version-transition cases and an offline signing-key backup.
  Closure does not mean every original acceptance checkbox passed.
- Of 269 registered Git worktrees, 34 directories still exist and 235 entries
  are prunable. Five existing worktrees have only untracked `.scratch/`
  directories; none had tracked working-file changes. This is optional local
  housekeeping, not an integration prerequisite. No worktrees were removed.

The README and `docs/ci.md` still describe parts of the older Ubuntu/LAN delivery
and Actions pause. For release state, use the later
[Stable publication record](../evidence/acceptance-277/2026-09-15/stable-publication/README.md)
and issue closure comments. Historical evidence should retain its original
failures and dates.

## Installation should have one entry point

The [live download page](https://couch.avoid.quest/download) lists six assets for
Stable and six for Preview even though both advertise 0.1.0. It then asks users
to install two tools, decode signatures and a public key, substitute `VERSION`,
verify an archive and open its README to find installation instructions. See
[the Astro source](../../apps/web/src/pages/download.astro).

`minisign` verifies setup, AppImage and recovery bytes. `jq` reads package and
build metadata in [install-couch](../../install-couch) and
[couch-recover](../../packaging/appliance/root/usr/sbin/couch-recover). They are
also declared in the signed host requirements through
[files.json](../../packaging/setup/files.json) and
[build.ts](../../scripts/build.ts). Users should not have to manage them
manually, but removing them from the current installation would break these
scripts and future prerequisite checks.

The requested first-class installation path is Tauri's native Debian package.
Its bundler supplies desktop integration, declared dependencies, extra files and
maintainer-script hooks. The user downloads one `.deb`, installs it through APT
or a graphical package installer, and launches Couch. See
[the official Tauri investigation](2026-09-15-tauri-installation.md).

Show one primary Stable action, the supported Debian 13 amd64/X11 target, and a
separate dedicated-TV option. Put Preview and dependency material behind secondary
links. Remove duplicate Preview choices when there is no newer Preview.

An HTTPS bootstrap around the current scripts was the initial low-change option
considered during this review. It would automate prerequisites and verification,
but remains custom installation logic. The official Debian package better fits
the owner's clarified preference. An AppImage hidden inside a `.deb` would still
need custom installation and update ownership rules.

Six hosted files do not need to be six user-facing downloads. The current
[publication contract](../../scripts/hosted-policy.ts) consists of an AppImage,
setup archive and third-party distribution archive, each with a signature.
The distribution archive is not needed for installation. Consolidating the
physical files requires coordinated packaging and publication-check changes;
keep dependency materials available and preserve existing update URLs.

[Tauri's updater](https://v2.tauri.app/plugin/updater/) verifies signed updates
inside the application. Source inspection of Couch's pinned updater 2.11.0
confirms native `.deb` update support as well as AppImage support. The guide's
AppImage examples are not the full list of implemented formats.

There is still a real integration change. Couch's code requires an AppImage at
specific user-owned paths. Tauri's native Debian update invokes privileged
`dpkg -i`; it needs system authorization and does not fetch new dependencies
through APT. Desktop updates can use that supported implementation. The locked
TV account and unattended idle/phone-only update behavior need an explicit
privilege and lifecycle decision. Do not promise unchanged unattended behavior
or remove the current update flow as part of a page cleanup.

## Publishing works, hosted build handoff needs attention

Actions is enabled, but its latest Package run failed at GitHub artifact upload
after build, signing and qualification succeeded. The repository has about
13.96 GiB of unexpired artifacts. The successful release used the existing Mac
Debian container build path and published to CrabNebula. Users download and
update directly from CrabNebula; the Mac can be offline. The T480 only installs
and runs the application.

See [the publishing audit](2026-09-15-publishing-state.md) for API results,
artifact sizes, the failing run and operational options. No storage deletion,
billing change or workflow dispatch is part of this assessment. The retained
Mac path permits another release while the storage issue is addressed.

## Public artifact privacy

The [artifact privacy check](2026-09-15-public-artifact-privacy.md) downloaded
the actual Stable AppImage and both archives. Their hashes match the retained
qualified release. It scanned 3,440 decoded regular files and found no owner
identity, personal home paths, saved application data or production credential
evidence. Generic build paths, dependency notices and the public updater key are
visible. Suspicious key-like strings were classified as upstream dependency test
inputs or data, not Couch credentials.

The compiled Bun server contains readable minified application JavaScript.
The private Git checkout and history are absent, but distribution makes the
application logic inspectable. This distinction matters if private source code
itself is considered sensitive. The report separates the fresh content scan
from the earlier exact-secret comparison and states the inspection limits.

## Small UI changes can proceed now

There is no unmerged release stack to integrate first. The
[architecture decision](https://github.com/avoid-quest/couch/issues/175#issuecomment-5581978494)
keeps the existing Bun coordinator and Rust player/updater and requires measured
evidence before considering a port.

Use separate branches or worktrees from current main for:

1. The installation entry point and Astro page.
2. Small application UI fixes, including #295 and repair-action eligibility.
3. Release-tooling/recovery follow-ups and Actions storage use.

Preserve existing components and shadcn styles. Test the affected behavior and
typecheck. Native/update changes need their focused integration checks; initial
installation changes need fresh desktop/TV setup and update/recovery checks.
Do not repeat the entire release hardware campaign for unrelated copy or layout.

See [review follow-ups](2026-09-15-release-review-followups.md) for current
caller-traced defects and conditional robustness improvements.
Unresolved review-thread counts are not a reliable backlog. The
[first-use reconciliation](../qualification/first-use-review-2026-09-14.md)
records 11 fixes, nine findings already handled in integration and four findings
rejected against the accepted scope. Other release/recovery comments still
need focused triage. An empty PR list does not establish that every comment was
fixed.
