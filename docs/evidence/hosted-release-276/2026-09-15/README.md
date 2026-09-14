# Hosted release implementation qualification

This records local qualification for [#276](https://github.com/avoid-quest/couch/issues/276), dated 15 September 2026 in Europe/Rome. It does not record a hosted publication or fresh-machine acceptance. The ticket remains open until its hosted verification passes.

The [accepted resolution](https://github.com/avoid-quest/couch/issues/266#issuecomment-5669079411) owns policy. Implementation started from current main `ae8012bda001dbe1f8e48f5f215acb20b8de3551`, including packaging, installer, first-use and subsequent fixes through PR #280. Main still had that identity before submission. The packaging limits in [the #275 review](../../debian-package-275/review-2026-09-14/README.md) still apply.

## Source and signed artifact identities

The complete candidate is version `0.1.0-preview.1`, built from clean source `7ff0aeaff2ac41e4a8e068fa0243e42e78df3900`. Git tag `qualification/hosted-276/2026-09-15` retains that source across stack rebases. [candidate.json](candidate.json) records all six file sizes, SHA-256 hashes and detached signatures, plus the disposable public key and inventory hash.

The AppImage is `Couch_0.1.0-preview.1_amd64.AppImage`, 289,085,944 bytes, SHA-256 `58ed2f8d8907e19b28dd147c60d70469df6b3a10515b79a5f1435f88f897ed25`. The AppImage and both archives have real Tauri signatures verified with Minisign. Their three signature files are separate public assets. The candidate uses a disposable qualification key, never enrolled for production. The SHA-256 of its outer-base64 public-key text plus a newline is `6f5bafe4109d97e686e86f633385c8f4a7ead143db0f184c4e942acbe065f409`. No private key is in these records.

The retained local bytes are in `.artifacts/hosted-276-final/` in the isolated `67a4` worktree. They also remain in the stopped task-owned `couch-hosted-276-build` container. No `qualified.json` suitable for hosted upload was manufactured from the split local checks. Production needs its own authorized run and enrolled key.

The final qualification revision is `d6c72372b0e06c292c3815ebc66d69b217b68e32`. Its only differences from the signed source are ZIP/Node build-test tools and the standard `bunx` link in `packaging/Dockerfile.mac`, plus portable expectations in `src/main.test.ts` and `src/server/hub.test.ts`. Application code, dependencies, packaging resources, release scripts and installer bytes are unchanged. Later commits only update documentation and evidence. The candidate was reused without rebuilding, resigning or claiming a new embedded revision.

[build-inputs.json](build-inputs.json) records the pinned Debian image/snapshot, Rust, Bun, helper downloads and lock hashes. The active baseline is Debian 13, snapshot `20260914T000000Z`; legacy Ubuntu fields in the input file are unused by this builder. The local cache image is `sha256:046874c85dd2c0fc9a7f7cf3642a481b227d275361edadb221c84f5895db5f18`, taken from the stopped #275 build container without starting or changing it. A fresh source checkout used that cache in a separate Linux filesystem.

Tauri is 2.11.5, updater 2.11.0, Tauri CLI 2.11.4, Rust 1.98.1 and Bun 1.4.2. The signed inventory records yt-dlp 2026.08.19, Deno 2.9.6 and ffprobe 7.1.5-0+deb13u1. [appimage-inventory.json.gz](appimage-inventory.json.gz) records 2,005 files and 499 ELF objects. Its uncompressed SHA-256 is `ba8b80b64ac1cf1bea7b975433b127a3638080bc4c9f1ff06e51c438b72e8445`. The standard AppImage runtime and dynamically loaded dependency checks are part of that inventory.

## Checks and limits

| Check | Result | Evidence and limit |
| --- | --- | --- |
| Complete Debian build, inventory, allowlist and signatures | Passed | `package-build-final.log.gz`; one complete AppImage and two archives, each signed. No sidecar download or target build. |
| TypeScript checks | Passed | `bun run typecheck` on Mac and Debian, including the final portable test fixes. |
| Mac Bun suite | Passed | `bun-tests-qualified.log.gz`: 1,247 passed, 22 skipped, zero failures. Separate clock file: one passed, two Linux-only tests skipped. The changed portable fixtures were rerun afterward: 94 passed, zero failures. |
| Linux Bun suite | Passed with the recorded platform split | 1,260 passed, 6 skipped, zero failures. Corrected Debian run excludes one Docker-emulation-specific case, which passes unchanged on native Debian. The clock tests ran separately to avoid global fake-timer interference. |
| Native Rust suite | Passed | `linux-native.log.gz`: 39 passed, one ignored across the complete locked release test run. |
| Fresh disposable installer and recovery fixture | Passed | `installer-final.log.gz`; real files, users, permissions, signatures and locks, with APT, FUSE and service doubles. Includes newer-data sentinels and incompatible retained recovery rejection. Expected interruption tests print `Killed`. This is not pristine-machine acceptance. |
| Signed standard AppImage runtime | Passed in isolated Debian VM | `vm-probe.txt` verifies the signature, extracts the signed manifest through the standard runtime, confirms the compiled native key and runs `--version`. Extracted requirements exactly match the build source file. |
| Workflow syntax and site | Passed | actionlint 1.7.12 with the documented Blacksmith runner label, shell syntax checks, `bun run web:build` and browser inspection of `/download`. The default page advertises no unverified release or dummy key. |
| Hosted draft/upload/publication, real CDN readiness and promotion | Blocked | Actions remains disabled. Release credentials, variables and protected environments are absent. No production publication or deployment is authorized. There are no Cloud release/asset IDs or public-readiness receipts for this candidate. |
| Pristine Debian desktop/TV and Mac-offline A-to-B acceptance | Not run | Owned by [#277](https://github.com/avoid-quest/couch/issues/277), including real GUI relaunch, supervision, mode readiness and recovery after newer writes. |

The initial Linux qualification run failed because the inherited builder lacked ZIP and Node and two fixtures assumed Mac behavior. The final builder supplies both test tools. The tests now expect Linux's native unity gain and use a path outside the platform's approved roots. These are recorded failures followed by fixes, not a passing first run.

A later diagnostic run used a login shell that selected Bun under `/root`, preventing a permission test's unprivileged child from starting. The corrected run uses the workflow's non-login environment and `/usr/local/bin/bun`. That exposed the builder's missing standard `bunx` link, required by two existing signing tests. The Dockerfile now supplies the link beside Bun. No product code or permission assertion was changed for these environment failures.

One unchanged extractor error test exposes a Docker-on-Mac emulation difference. Bun reports a nonexistent executable as exit 127 without stderr there; native Debian reports the expected `ENOENT`. The exact test passes when bundled and run with Bun 1.4.2 in the isolated VM. The hosted workflow retains the full test suite on native amd64. It contains no exception for this case.

The Mac Docker engine also cannot directly execute this static PIE AppImage runtime. `manifest-extraction.log` records that failed method. The VM supplies the standard-runtime check instead. The unmodified `hosted-qualify.sh` therefore has not passed end to end on a hosted runner. No local receipt claims otherwise.

## Done-when coverage

| Ticket criterion | Implementation and local evidence | Remaining verification |
| --- | --- | --- |
| Ordering, channel waiting/equality, skips, incomplete/bad downloads, prerequisites, retained bytes, activity, restart and newer data | `scripts/hosted-release.test.ts`, native updater tests, `appimage-update-native.test.ts`, `manual-update.test.ts`, `update-idle.test.ts`, `appimage-checkpoint.test.ts`, `maintenance-mode.test.ts` and the installer recovery fixture cover these cases. Manual playback confirmation cannot interrupt recordings, scans or imports. Failed candidates do not retry automatically. | Hosted selection plus real desktop/TV relaunch and retained recovery belong to the authorized hosted run and #277. |
| Exact-byte promotion and approved public assets | Manifest/signature checks, six-file Cloud allowlist, qualified receipt checks and a retained Preview readiness receipt gate final-version Stable promotion. Tests reject missing/extra assets, changed signatures and incorrect selectors. Public readiness checks six files, installer selection, updater metadata and metadata-selected AppImage bytes. | Publish an authorized final version in Preview, verify all endpoints, then promote those original files/signatures to unnamed Stable and verify again. No live promotion is claimed. |
| Integrated first use; unreachable remote cannot prevent this installation's update | Current main supplies PRs #272/#273 and subsequent fixes. Remote mode starts the same bundled backend for private installation maintenance without starting a local media server. Its tests verify independent authority, saved data, failed/successful local startup checks and operation without contacting the remote. Existing shadcn controls expose this app's update. | #277 runs saved local/remote modes with an unreachable remote against real hosted A-to-B bytes. |
| Documented fresh-install and hosted A-to-B journey with Mac offline | [Release owner instructions](../../../hosted-releases.md) and [installation instructions](../../../install-couch.md) name the HTTPS key/bootstrap, direct Cloud assets, channel/timing, native relaunch, supervision, retained recovery and exact evidence to capture. | Owner setup, authorized publication and site deployment must precede #277. The Mac must be offline during that final acceptance. |

Both deferred review findings are implemented: [Debian workflow migration](https://github.com/avoid-quest/couch/pull/278#discussion_r4009333335) and [ordinary desktop update/relaunch](https://github.com/avoid-quest/couch/pull/279#discussion_r4009347634).

## VM preservation

Before diagnostics, the retained [UTM instructions](https://github.com/avoid-quest/couch/blob/7bcc7f7090948e0d355b6a4e02ee3b2d408de9a7/docs/evidence/fresh-install-debian-2026-09-14/utm/README.md) were read. The prepared #275 diagnostic VM `D91B4BBA-159F-43D4-87F6-1E1C96DE9FB8` was cloned into task-owned VM `E1EE56A3-232D-4A29-A2CD-CC15CBCD10D4`, named `Couch 276 signed artifact diagnostic 2026-09-15`.

Only the clone was started. It runs Debian 13.7 and kernel `6.12.107+deb13-amd64`, with existing Minisign and FUSE. Candidate files and a temporary diagnostic Bun binary stayed under `/home/probe/couch-276-signed`. No APT, setup, installed AppImage replacement, session change or existing Couch process ran. `vm-before.txt` and `vm-after.txt` are identical for the retained installation/data files through depth three, administrator configuration and session policy. This is a bounded preservation check, not a claim about every guest filesystem byte.

The clone received an orderly guest shutdown. `utm-final.txt` records it and all original diagnostic/pristine VMs stopped. UTM reported a macOS `-10004` UI warning during clone/start; its inventory, process state and SSH verified the actual operations. No pristine baseline, existing installation or physical T480 was modified.

## Tracker and owner handoff

Wayfinder inspection checked issue bodies, comments, assignments and native dependencies. [#275 was resolved and closed](https://github.com/avoid-quest/couch/issues/275#issuecomment-5671037841) against merged packaging evidence. [#25 was resolved and closed](https://github.com/avoid-quest/couch/issues/25#issuecomment-5671039092) after its destination and all 26 native children were satisfied. Its decision index remains unchanged. #276 is assigned to `fcastrovilli`; its recorded blocker #275 is closed. #276 remains open.

[actions-permissions.json](actions-permissions.json) records `enabled: false`. The concrete remaining owner actions are in [Owner setup](../../../hosted-releases.md#owner-setup-before-an-authorized-hosted-run): enroll and back up the production signing key, configure release credentials/variables and protected environments, separately authorize an Actions run, then approve publication and website deployment. Until those actions are authorized, no real hosted readiness or final-version promotion result can be recorded. Keep #276 open for that evidence and hand final pristine/Mac-offline acceptance to #277.
