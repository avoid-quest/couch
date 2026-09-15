# Fresh Debian acceptance preparation

For the current public releases, physical installation results, GLES fix and remaining checks, read [Release and device verification](AFK-VERIFICATION.md). The initial preparation record below is retained with its original scope and outcomes.

Work for [Pass fresh Debian installation and Mac-offline signed-update acceptance](https://github.com/avoid-quest/couch/issues/277), on 15 September 2026 in Europe/Rome. UTC receipts are dated 14 September.

Release acceptance remains blocked. [Deliver hosted Stable/Preview releases and Tauri updates](https://github.com/avoid-quest/couch/issues/276) remains its open native dependency. This record adds isolated preparation results to the [previous qualification evidence](../../hosted-release-276/2026-09-15/README.md). It does not replace those results or their limits.

## Identity and authorization

Fetched main was `b38b01f5beb92c8f6e08ae0ffae70d715c41b18c`, containing the three squash merges. The task branch was advanced to that revision before tests. [run-identity.json](run-identity.json) records the source, manifest, inventory, key and all six asset identities.

The retained `0.1.0-preview.1` candidate still identifies source `7ff0aeaff2ac41e4a8e068fa0243e42e78df3900` and tag `qualification/hosted-276/2026-09-15`. Its AppImage SHA-256 is `58ed2f8d8907e19b28dd147c60d70469df6b3a10515b79a5f1435f88f897ed25`. Tests used a separate copy under `.artifacts/acceptance-277/candidate`. No asset was rebuilt, resigned or relabeled. No `qualified.json` was added. The candidate's disposable key has no production enrollment.

Application code, dependencies, installer and packaged setup files match the integrated source. Differences from the signed source are the previously recorded builder/test-tool fixes, two portable test expectations and documentation/evidence. [Archive comparison](archive-inventory.json) confirms all 17 setup files match main, including the README after version substitution. The distribution archive has 1,402 regular files under its approved dependency-material entries, without archive links or traversal paths. This is an archive/inventory check; it does not establish execution of every bundled library.

At the initial preflight, Actions was disabled and [secret names](secret-names.json), [variable names](variable-names.json) and [environments](environments.json) were empty. The owner subsequently authorized release publication and hosted activation after local `act` checks, removed the separate publication reviewer requirement, and deferred the offline signing-key backup. Main-only release environments and release credentials are configured; the initial receipts remain unchanged. No T480 operation or existing-installation change was performed.

After local checks passed, the owner approved merging [Preserve release caches and requalify incomplete candidates](https://github.com/avoid-quest/couch/pull/286) and running the release. Its squash merge is `7f480f382699cd0f4013406802ae6010911d8862`. Actions is enabled and `COUCH_RELEASES_ENABLED=true`. [The authorized Preview run](https://github.com/avoid-quest/couch/actions/runs/34907856876) used that revision, the production key and `publish=true`. It was canceled before publication when the minimal VM exposed the nonexecutable TV session script described below. No qualified assets were produced. The [cache receipts](hosted/builder-cache-observations.md) record successful retention after cancellation; actual reuse remains to be measured on the next run.

An unsupported `gh stack merge` option caused the first merge command to fail. An incorrectly chained dispatch then started [a run on the previous main](https://github.com/avoid-quest/couch/actions/runs/34907749143). It was canceled immediately before any job steps executed. This does not establish zero billed usage. The single nonstack PR was then merged with `gh pr merge --squash --match-head-commit`, its exact merged workflow was verified, and the authorized run above was dispatched.

## Hosted gate

[Endpoint checks](public-endpoints.json) used curl and normal HTTPS redirects. The download page returned 200 after one redirect. The enrolled key, Stable and Preview installer selectors, and both updater feeds from `0.0.0` returned 404. These are availability observations, not verified artifact downloads. The [initial Python urllib attempt](public-endpoints-urllib-initial.json) returned 403 for every endpoint; it is retained separately rather than attributed to CrabNebula's release state.

There are no qualified hosted A/B artifacts, enrolled-key receipt, public-readiness receipt or final-version promotion receipt for this run. The Mac stayed online and hosted the VMs, SSH access and initial artifact transfer. No Mac-offline condition was exercised. The owner has now authorized the freshly installed Debian T480 as the independent local target consuming published packages. Its initial baseline is recorded separately; no installation or build occurred during that inspection. A separately recorded Mac shutdown/network-disconnection interval is still required.

Continue through [release configuration](../../../hosted-releases.md#owner-setup-before-an-authorized-hosted-run) after local readiness passes. The encrypted production signing key has been created and its signature verified independently with Minisign. Both main-only environments are configured without a required reviewer, as requested by the owner. The key and password remain in `/Users/devit/.config/couch-release`; the owner accepted making the offline copy later. Run qualification and hosted readiness for A and B, retain both accepted sets before provider expiration, and authorize the enrolled-key/download site deployment. Final-version Preview-to-Stable promotion must retain the tested files and signatures. The existing instructions provide the exact dispatch, retry and promotion commands. The owner has authorized publication; qualification and readiness still must pass.

## Isolated checks

[Local act validation](act/README.md) covers ten workflow scenarios and nineteen
shell regression checks. It reproduces and verifies fixes for lost caches after
early build failure and retries that skipped incomplete qualification receipts.
The fixed mocked workflow suite took 21.252 seconds, with no hosted usage. Those
checks establish workflow control flow; they do not qualify a native hosted build.

| Check | Result | Receipt and limit |
| --- | --- | --- |
| Main TypeScript check | Passed | [typecheck.txt](typecheck.txt), Bun 1.4.2 and locked dependencies. |
| Focused updater, authority, idle, checkpoint and remote-maintenance tests | Passed | [focused-tests.txt](focused-tests.txt), 36 passed, one Minisign-dependent test skipped on the Mac. |
| Hosted version, signature reuse, Cloud allowlist and readiness tests | Passed | [hosted-linux-tests.txt](hosted-linux-tests.txt), five passed in disposable Debian, including the Mac-skipped case. |
| Retained real candidate verification | Passed in Debian | [linux-fixture.txt](linux-fixture.txt) begins with successful verification of the original signed source. The [Mac attempt](signature-check.txt) failed because Minisign is absent there. |
| Installer and retained recovery fixture | Passed | Same [Debian log](linux-fixture.txt). Real signatures/files/users/locks, with APT, FUSE and service doubles. Includes interrupted setup, incompatible recovery, newer data, desktop policy and TV overrides. |

The container used retained cache image `sha256:046874c85dd2c0fc9a7f7cf3642a481b227d275361edadb221c84f5895db5f18` with this worktree mounted read-only. Original build containers stayed stopped. Existing native Rust qualification applies to the unchanged native application source; this task does not claim a new native test run or hosted qualification receipt.

## VM preparation

Read the [retained UTM guide](https://github.com/avoid-quest/couch/blob/7bcc7f7090948e0d355b6a4e02ee3b2d408de9a7/docs/evidence/fresh-install-debian-2026-09-14/utm/README.md) before VM work. UTM cloned the two pristine baselines into these task-owned environments:

| Profile | New preparation clone | Pristine parent |
| --- | --- | --- |
| Minimal | `19C197A2-BAE0-49B4-B487-2E5C515747A9` | `21D3726B-624A-484F-A87E-39CDE695F095` |
| Xfce | `C8DD4D22-CDFB-4BEC-AA3B-BE7EE2C21B78` | `FD89B060-C26A-4DFF-B68F-3FCB203E3516` |

Names are `Couch 277 minimal preparation 2026-09-15` and `Couch 277 xfce preparation 2026-09-15`. They inherit the guide's separate loopback SSH ports, hardware and access material. Original probes, both pristine parents and the prior diagnostic installations stayed stopped. No access credentials enter this evidence.

[prepare-guest.sh](prepare-guest.sh) records the OS/package/service baseline, runs the documented verifier bootstrap, verifies all three signed assets, then invokes the archive's unchanged installer once for the selected profile. It records the first exit before further work. These disposable-key runs cannot pass production acceptance. Fresh clones and production-qualified bytes remain required for the final gate.

## Remaining acceptance matrix

Both preparatory bootstraps and unchanged installers exited zero.
[The Xfce receipts](xfce/) record 1,415 baseline packages and 1,422 afterward, with
seven additions, no upgrades or removals, and identical recorded session-policy
hashes. Its installed build retains the signed candidate's original identity.
GUI launch, playback and idle memory are separate checks.

The [minimal receipts](minimal/) record 321 baseline packages and 577 afterward,
with 256 additions, no upgrades or removals, and no full desktop task installed.
Both profiles passed the [packaged-helper checks](helper-checks.md), including
standard FUSE mounts, signed helper hashes, resolved linkage and actual Deno,
yt-dlp and ffprobe execution. Minimal's first helper-test script could not be
read from the administrator's home directory by `couch-tv`; that test setup
failure is retained separately. The unchanged test script ran from `/tmp`.
No application or installed permission repair occurred.

The unchanged minimal clone's first TV boot failed before Couch started.
LightDM logged into `couch-tv`, then Xsession reported
`/usr/lib/couch-appliance/session: Permission denied`. The setup archive and
tracked source both give that command mode `0644`; the installer preserves the
source mode. `initialize-audio`, `set-autostart` and `couch-session` have the same
mode defect. No native Couch process was observed, so idle memory and playback
remain unrun. The [first failure](minimal/boot/README.md) is retained before any
separate diagnosis or fix. Four source executable modes are corrected to `0755`.
The installer fixture now checks that `couch-tv` can execute every affected
installed command. It [fails with the original modes](minimal/boot/installer-regression-red.txt)
and [passes the full fixture after correction](minimal/boot/installer-regression-green.txt).
Both preparation clones received orderly shutdowns and remain preserved.

Keep the ordered checks in the [accepted contract](https://github.com/avoid-quest/couch/issues/266#issuecomment-5669079411). Each final receipt must name source/artifact hashes, key, Cloud IDs, original/final URLs, profile, installed/running identities, saved mode and durable request ID.

| Ordered check | Acceptance status | Required final evidence |
| --- | --- | --- |
| Public assets and complete inventory | Blocked | Six public files match the authorized signed manifest and enrolled key; archive review and loaded-helper/library evidence. |
| Pristine desktop installation and minimal TV boot | Unrun with qualified production bytes | Both new OS baselines, unchanged installer exit, GUI/session behavior, package/service deltas, footprint and five-minute idle sample. Freeze failures before a separate diagnostic clone. |
| Helpers, external playback and personal/shared/native remote behavior | Unrun | Execute bundled helpers, play external avoid radio without a library, record advancing playback, pair browser roles, and show native remote isolation and unreachable-target recovery. Emulated output cannot qualify physical hardware. |
| Hosted A-to-B with Mac offline | Blocked | Actual Mac-offline interval; independent dependency/artifact acquisition; local and paired Administrator actions; Controller denial; manual confirmation and ten-minute idle deferral; both saved modes; correct running B; retained settings/pairings/sources/queue/progress and no autoplay. |
| Ordering, channels and preflight failures | Blocked in installed hosted journey | Direct skipped release; lower/equal no-op; Preview-to-Stable waiting; missing/corrupt download; missing prerequisites; low storage; recording/scan/import; paused/loading media, reconnect and late input. The current app stays usable after preflight failure. |
| Interruption, failed startup and retained recovery | Blocked in installed hosted journey | Interrupt download and actual replacement separately; force startup failure; reject incompatible retained app; recover compatible local bytes while app/old hosted bytes are unavailable. Keep newer writes and failed-candidate suppression. |
| Final-version promotion and readiness | Blocked | Original qualified final-version Preview files/signatures become Stable unchanged; complete public readiness before any separately authorized announcement. |

No acceptance issue or native blocker was closed. The planning maps and their decision indexes remain unchanged.
