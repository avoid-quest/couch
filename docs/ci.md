# Development checks and the pre-merge gate

Use the pinned Bun 1.4.2 and the frozen lockfile. Versioning, tagging and release
publication are not part of verification.

```sh
bun install --frozen-lockfile
bun run check                 # Fast iteration, including uncommitted changes
bun run verify                # Committed revision: core checks and production build
```

`check` runs the pinned TypeScript check and `test`. `test` runs the real-clock
IPTV test in its own Bun process alongside the remaining suite, using Bun's
built-in parallel script runner. Per-file isolation and four-way parallelism
remain enabled. The same commands run locally and in hosted
verification. Tests for media intake, connection lifetime and Query cancellation
are part of that existing suite, not another harness. For focused iteration use
`bun test --isolate --parallel=4 <test paths>`; run the real-clock test separately.
A nonzero exit or unhandled error is a failure, regardless of the assertion count.

## Exact-revision evidence

`verify` refuses the wrong Bun version, an uncommitted source tree, or missing
Linux qualification dependencies (ffmpeg, minisign, ACL tools and jq). It runs
`check` followed by the frontend/sidecar build, failing immediately on a failed
step. It writes `.artifacts/verification.json`, including the before/after Git
revision and dirty state, executed commands, exit codes, timestamps, coverage and
hosted run/attempt when present. Outputs remain in the normal terminal/CI log.

The receipt is eligible only when every selected step passed and the source
remained the same clean commit. A failed or interrupted run is not a green gate;
a later source push invalidates an earlier receipt. An eligible core receipt is
necessary but not sufficient for changes requiring the additional gates below.
The PR template makes those requirements explicit. This is a recorded review
gate, not a claim that repository branch-protection settings were changed.

On Linux, install the actual test dependencies rather than accepting skips caused
by missing minisign or native libraries. A Mac result does not qualify Linux-only
installer checks. Record baseline failures separately from new regressions.

## Browser and native gates

For frontend, route, connection or build changes, run the compiled sidecar's
browser remote. The existing Linux launcher has a browser-only selection:

```sh
bun run test:linux --built-remote
```

The launcher requires a clean committed checkout, creates a Git bundle of that
revision and checks it out inside the existing Linux test container. This avoids
a partial tar copy omitting Vite configuration, workspace packages or tests, and
preserves real build identity. It does not copy build output back into the host
checkout. The browser-only selection skips native application compilation/tests,
not the shared core checks or production frontend/sidecar build.

`tests/linux/built-remote.ts` reuses the existing HTTP browser driver. It checks
that every served frontend file matches Tauri's `dist` bytes, pairs from a deep
link, navigates, refreshes and sends browser Play/Stop to the running coordinator.
It checks worker activation on loopback, which is a supported secure context;
ordinary insecure LAN HTTP must not register a worker. Its native pipe peer is
simulated, not libmpv. The build identity, checks, asset hashes and screenshot go
to `.artifacts/linux/built-remote`. After building in an already configured Linux
WebKit/X11/null-PulseAudio environment, `bun run verify --remote` runs that same
journey and includes it in the exact-revision verification receipt.

Native source changes additionally require the retained native commands:

```sh
bun run verify --native
bun run test:linux
```

`--native` adds the locked Cargo tests and the retained startup-buffer test after
the sidecar build. `test:linux` runs the compiled-browser check, then the short
native smoke: compiled Tauri/libmpv startup, one paired-controller Play command
for generated local media, a native-pixel capture, one restart/persistence check,
and a receipt tied to the running revision. Focused tests own feature behavior;
the Debian package/update gate remains separate. Neither simulated playback nor
software rendering qualifies physical TV, speaker or hardware behavior. The
launcher still accepts its existing Jellyfin/provider options. Use `preview:linux`
for an uncommitted visual preview, not qualification.

## Hosted execution and budget

[Check](../.github/workflows/check.yml) remains manually dispatched on the existing
Blacksmith Ubuntu runner. Pushes and PR edits do not dispatch it automatically.
It uses frozen dependencies and the same `bun run verify` entry point. Select the
`native` input for native changes; ordinary source verification does not install
native development packages or restore Cargo caches. Required native coverage is
not waived by leaving that input false: the PR's applicable gates must be met.
The exact JSON receipt is printed in the downloadable job log. Retrieve it with
`gh run view RUN_ID --log`; a missing receipt fails the retention step. This
keeps qualification evidence available without artifact-storage quota. The
built-browser gate runs through the existing Linux environment rather than adding another hosted
browser harness or an automatic heavy job for every push.

Workflow and packaging edits require `act` proof before hosted dispatch, using
`catthehacker/ubuntu:full-latest` (the default act image lacks gh). Exercise the
ordinary and selected-native paths after a Check workflow edit, and retain the
exact revision, command, inputs and process exits. Local emulation does not prove
hosted capacity, secret access or hosted timings. Do not dispatch an unvalidated
workflow or treat a website deployment check as Couch qualification.

The [existing CI budget decision](https://github.com/avoid-quest/couch/issues/43)
remains in force. Before increasing jobs, checks or caches, compare complete
workflow usage: setup/action downloads, dependency installation, cache restore
and save, execution and cleanup, including failures and cancellations. Distinguish
allocated runner time, queue delay and account billing. CLI step milliseconds
alone are not that whole-workflow measurement. The revised command selection has
not yet established hosted cold/warm measurements; record them before claiming a
budget improvement. Reuse valid same-revision evidence instead of rerunning it
merely because PR metadata changed.

[Package](../.github/workflows/package.yml) and the [hosted release guide](hosted-releases.md)
retain ownership of signed Debian builds, qualification, CrabNebula publication
and unchanged-byte promotion. Publication requires separate authorization. The
T480 installs/runs Couch; it is never a build worker.
