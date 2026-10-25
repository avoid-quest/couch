# Player modes recovery snapshot

Branch: `recovery/player-modes-20261026`.

This branch preserves the entire pushed playback refactor through `27e580c`, followed by the exact 112-file source snapshot from the stopped investigation. It includes browser fixes, native host capture, research, regression tests and the later native-client experiments. It is recovery material, not a release-qualified integration.

The owner remembers **R4** as probably the last Mac build they saw, with uncertainty. Two separate naming sequences exist: `Couch Audio Lab R4.app` was the 55 ms browser comparison; `Couch Audio Lab Native R4.app` was a later native-host checkpoint. Both are preserved by distinct artifact names. This recollection does not establish which binary the owner last used.

## Start here

1. Read the [history audit](history-audit.md) for the Mac-host switch, browser fixes, native-host work, native-client detour and the generic fixes discovered afterward.
2. Use the source in this branch. [manifest.json](manifest.json) identifies every file in the original source overlay by SHA-256. [source-overlay.tar.gz](source-overlay.tar.gz) and [tracked-changes.patch](tracked-changes.patch) preserve that same overlay separately.
3. Read [evidence-index.json](evidence-index.json) to locate earlier source snapshots, source pins, before/after patches, scripts, research notes, test receipts, detector results and complete diagnostic traces in the evidence archive. It records original and archived hashes and identifies redactions.
4. Use [checkpoints.json](checkpoints.json) for the ten exact deployed `app.asar` identities and their compressed copies under `checkpoints/`. [native-helper.json](native-helper.json) identifies the matching macOS arm64 capture helper recovered from the Mac.
5. [recordings.json](recordings.json) identifies representative raw synthetic-signal recordings: browser r12/r15, repeat r16, and the native-host sample-coherence comparison. These supplement the experiment results and traces in the evidence archive.

The history audit records the original machine paths. Inside the evidence archive, paths start at the investigation checkout's `.scratch/` directory. A fresh checkout does not need access to those original worktrees to read the preserved material.

[source-checkpoints.json](source-checkpoints.json) also preserves the exact source delta of the earlier 09:13 UTC latency checkpoint. The later 23:19 assigned-checkout checkpoint is recorded as identical to `27e580c`, explaining why it contains none of the subsequent Mac-host changes. [pushed-history.txt](pushed-history.txt) records the original pushed commits.

## Verify and extract

Run these commands from this directory. Extraction writes to the temporary directories shown and does not start Couch or change an installed app.

```sh
sha256sum -c SHA256SUMS
mkdir -p /tmp/couch-player-evidence /tmp/couch-player-recordings
cat evidence.tar.zst.part-* | zstd -d | tar -x -C /tmp/couch-player-evidence
cat recordings.tar.zst.part-* | zstd -d | tar -x -C /tmp/couch-player-recordings
```

Parts are ordered lexically and kept below GitHub's per-file size limit. [archives.json](archives.json) contains the assembled archive hashes, per-part hashes and sizes. [preservation-checks.json](preservation-checks.json) records source verification, archive round-trip verification and the credential scan.

For example, recover the browser R4 application archive without launching it:

```sh
zstd -d checkpoints/candidate-owned55-r6-pcm-clock200-r1.asar.zst -o /tmp/couch-browser-r4.asar
sha256sum /tmp/couch-browser-r4.asar
```

Its original SHA-256 is `5ce1d68ecb8ec96cffff0505770032fbb8ccd7955803154fe32c60e25de9d211`. The `app.asar` files and native helper preserve the changed application payloads; they are not complete signed Electron application distributions. Build/deployment scripts and receipts are in the evidence archive.

## What was retained

- The original entire-refactor commits, including the product contract and validation documents.
- Every modified/untracked source file from the actual edited worktree, including both SDK patches and all new native source.
- Earlier experimental source trees, focused patches and regression receipts; browser output-clock replay fixtures; routed-network and Wi-Fi results; host capture timing and sample comparisons; generic late-join and relaxed-queue fixes; later native-output findings.
- All selected text evidence from the experiment scratch tree, including full numeric traces rather than only successful summaries. Credential-bearing fields are redacted in copied evidence; original and archived hashes are recorded separately. The original source snapshot is unchanged.
- Ten application archive checkpoints, the Mac capture helper, and five raw synthetic-signal recording files. Other raw recordings remain local; their associated result/trace files are retained here. These selections do not convert individual passing runs into reliability qualification.

Repeated Electron distributions, dependency installations/caches, third-party build outputs, app databases/runtime data and the complete set of repetitive raw recordings are outside this Git archive. The source pins, application payloads, recipes, measurement records and representative recordings preserve the useful implementation and findings without copying entire scratch installations. Original local evidence has not been deleted or overwritten.

## Completion contract

The scope is still the [entire player modes refactor](../../audio-video-refactor-plan.md), with its [code map](../../audio-video-refactor-code-map.md), [use cases](../../audio-video-use-cases.md), [validation](../../audio-video-refactor-validation.md) and [authority model](../../adr/0002-playback-delivery-and-authority.md):

- Direct playback: independent destination queues, Play on and queue-preserving Move.
- Relaxed synchronized A/V: collaborative transport/queue, shared or split picture/sound, consent, volume and correction.
- Live audio: native host capture/server processing and browser receivers using browser APIs, with audience Join/Leave/local volume and independent admission of slow receivers.

The desktop host should own native sound-card access. The new native-client output path is outside the requested integration, but its generic bug fixes and findings must survive selective recovery. Preserve WebRTC/TURN, buffered captured-video fallback, mpv compatibility and hardware/Bluetooth routing.

Use the pre-native browser/server patch snapshots and host checkpoints as comparison points; review shared scheduling, protocol, settings and packaging hunks individually. Validate the reconstructed product across all three modes, including the continuing Mac-host/Linux-browser setup and actual Wi-Fi browsers, before producing the ready-for-review PR stack. This preservation task did not restart the lab, dispatch CI or qualify the current source for release.
