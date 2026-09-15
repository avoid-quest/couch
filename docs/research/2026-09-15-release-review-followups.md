# Release review follow-ups

Read-only GitHub and source inspection on 15 September 2026, against main
`2d1ddda88d4cafca534562ba1f82baf4a3013e01`. This is a focused triage of recent
review comments, not a new hardware campaign or complete security audit.

## Work can proceed

GitHub reports no open PRs and one open issue, [#295](https://github.com/avoid-quest/couch/issues/295).
It asks for an actionable rejected-download message and a fresh-download recovery
action. Its description explicitly says it has no blockers and does not block
0.1.0 publication.

[#296](https://github.com/avoid-quest/couch/pull/296) merged at 10:50:18 UTC.
Its [Cloudflare comment](https://github.com/avoid-quest/couch/pull/296#issuecomment-5678957518)
reports successful deployment. [#276](https://github.com/avoid-quest/couch/issues/276#issuecomment-5678866142)
and [#277](https://github.com/avoid-quest/couch/issues/277#issuecomment-5678866699)
closed after the owner accepted the release scope. The closure records the
Mac-offline signed T480 update and unchanged-file Stable publication. Pristine
desktop qualification, remaining rare failure/activity/version-transition cases,
and the offline signing-key backup were deferred, not reported as passed.

There is no architecture prerequisite for small UI work. The owner resolved
[#175](https://github.com/avoid-quest/couch/issues/175#issuecomment-5581978494)
by retaining Bun and the existing Rust player/updater and requiring measurements
before a future port. Live timeshift and growing-recording work was
[closed as not planned](https://github.com/avoid-quest/couch/issues/67#issuecomment-5666020344).
Independent UI fixes can use separate branches while installation and release
work continues. Changes to shared Updates components should have one owner.

## Unresolved thread counts need interpretation

The latest 25 PRs contain 39 unresolved review threads. This does not mean 39
current defects. The [first-use review ledger](../qualification/first-use-review-2026-09-14.md)
accounts for all 24 threads on #269 through #273: eleven fixed, nine already
handled by the integrated stack, and four rejected for a false premise or conflict
with accepted scope. It explicitly says GitHub threads were left unresolved.

The Debian workflow and desktop-update threads on #278/#279 also retain unresolved
metadata, but the [hosted-release evidence](../evidence/hosted-release-276/2026-09-15/README.md)
records both implementations. Several #282 comments refer to the old updater
contract replaced by #283. The following comments still warrant work or an
explicit disposition after tracing current callers.

## Confirmed reachable UI follow-up

### Hide the unsupported repair action

[Review comment](https://github.com/avoid-quest/couch/pull/283#discussion_r4010280101).
Normal Administrator Settings mounts `UpdatesSettings` with tools enabled.
Native status returns a current build identity and `repairCurrent: false`.
`createManualUpdate.read` forwards both `current` and `repairAvailable: false`.
The button in [UpdatesSettings](../../src/client/UpdatesSettings.tsx) checks
`current` but ignores `repairAvailable`, so it appears on an enrolled, idle
installation despite repair being unavailable.

The [native updater](../../src-tauri/src/appimage_update.rs) rejects this operation
before creating an installation transaction. The
[native request adapter](../../src/server/appimage-update-native.ts) throws that
error; [manual-update](../../src/server/manual-update.ts) returns its generic
failure without `accepted: false`. The UI therefore retains the saved repair
request and offers to retry the unsupported action. This is a UX failure, not
evidence that an unsupported repair can replace the app. The separate local
update dialog in `PlaybackDevice` uses `showTools={false}` and does not expose it.

Priority: a small immediate fix alongside #295. This inspection traced the complete
source path; it did not operate the installed T480 or run a new browser regression.

## Conditional recovery follow-ups

### Damaged transaction metadata can leave recovery stopped

[Review comment](https://github.com/avoid-quest/couch/pull/283#discussion_r4010280098).
[couch-recover](../../packaging/appliance/root/usr/sbin/couch-recover) stops the TV,
verifies and replaces the AppImage, then annotates `transaction.json` before
restarting. Malformed JSON, a missing or invalid `requestId`, or an unavailable
requests directory fails under `set -e` after replacement and before restart.
This requires damaged recovery metadata; ordinary successful recovery is not
shown to fail. Make optional annotation best-effort or validate it before stopping.
Priority: focused recovery robustness work, with a disposable fixture.

### Repeat setup does not restore a missing recovery public key

[Review comment](https://github.com/avoid-quest/couch/pull/283#discussion_r4010280089).
[install-couch](../../install-couch) first requires existing app bytes to match the
verified input, then writes `couch-updater.pub` only when the AppImage is absent.
The recovery command always reads that key. A same-version installation with a
missing key cannot repair that omission by rerunning setup. Fresh 0.1.0 installs
write the key correctly. Old POC migration is outside accepted scope, so this is
not a general first-release installation blocker. It is a small repairability
improvement if rerunning setup should restore missing support files.

### Recovery key ownership is a hardening question

[Review comment](https://github.com/avoid-quest/couch/pull/283#discussion_r4010280093).
TV recovery reads its public key from the runtime-owned application directory.
If the runtime account is already compromised, an attacker can replace that key
and retained signed files together. However, that account can already replace its
running AppImage, and the recovery command executes the candidate as the runtime
user. This inspection establishes neither a privilege escalation nor a compromise
of the release signing key. A root-owned trust anchor would strengthen operator
recovery after runtime compromise. Treat this as an explicit threat-model decision,
not evidence of private data in the public artifact.

## Release tooling follow-ups

### Require enrolled trust for retained publication

[Review comment](https://github.com/avoid-quest/couch/pull/282#discussion_r4010297287).
[hosted-release.ts](../../scripts/hosted-release.ts) checks retained signatures
against the manifest's key, then compares that key with the enrolled environment
value only if the environment value is nonempty. The
[workflow](../../.github/workflows/package.yml) normally supplies the repository
variable and checks retained-run provenance. The gap requires an unset or cleared
variable, or a direct local invocation without it, plus a retained candidate using
another key. Fresh source drafting and sealing already require the enrolled key.
No incorrect signing key was observed in the published release. Require the key
for retained draft/upload/publish operations so a misconfigured publisher fails
before publication. Local verification of a deliberately disposable candidate
can remain a separate use case.

### Malformed Retry-After can cause immediate retries

[Review comment](https://github.com/avoid-quest/couch/pull/290#discussion_r4010857033).
The public-readiness verifier uses `Date.parse` for every noninteger header.
A direct Bun check confirms `Date.parse("1.5")` is 5 January 2001, resulting in a
zero-second wait instead of the intended 60-second fallback. This requires a
malformed CDN response; valid integer delays such as the recorded 60-second
response work. It can prematurely fail verification and does not alter installed
apps. Validate HTTP-date syntax or use a suitable existing parser.

No PRs, issues, review comments, account settings, published assets or devices were
modified during this inspection. The only repository change is this note.
