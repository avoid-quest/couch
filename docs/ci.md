# Development checks and release qualification

Iterate locally. Run the tests affected by a change, then the broader checks when
needed. Install the pinned Bun dependencies once per lockfile change.

```sh
bun install --frozen-lockfile
bun run typecheck
bun test ./tests/linux/iptv-clock.test.ts
bun test --path-ignore-patterns 'tests/linux/iptv-clock.test.ts'
bun run build
```

The two test commands keep the real-clock test in a separate Bun process from
tests that mock process-wide clocks. `bun run check` currently runs typechecking
and plain `bun test`; use the commands above for the full suite with clock isolation.
For native changes, run these after `bun run build` generates Tauri's sidecar,
with the platform's native build dependencies installed:

```sh
cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo test --manifest-path src-tauri/Cargo.toml --locked -p tauri-plugin-video startup_buffer
```

Run `sudo "$(command -v bun)" scripts/test-publish-release.ts` and
`sudo bash scripts/test-appliance.sh` only in disposable Ubuntu environments.
They install packages and change system files. For real systemd/APT lifecycle
checks, `bash scripts/test-appliance-systemd.sh` creates its own privileged Docker
fixture on an amd64 Linux host.

[Check](../.github/workflows/check.yml) is an optional, manually dispatched full
Ubuntu check. Pushes and PR edits do not start it. Request it explicitly when a
hosted Linux run is useful:

```sh
gh workflow run check.yml --repo avoid-quest/couch --ref <branch-or-tag>
```

Check always runs typechecking, the isolated-clock Bun suite, the frontend/sidecar
build, locked Cargo tests, signed-release tests and appliance recovery tests.
It installs host dependencies in one step and retains a 15-minute timeout.
A newer manual run on the same ref cancels its predecessor.

Cargo tests omit debug symbols while retaining assertions and overflow checks.
The cache action stores dependency downloads/build outputs, excludes installed
binaries and removes workspace/incremental outputs. Stable profile keys separate
Ubuntu test and release builds; the release key also includes pinned packaging
inputs. The action includes compiler and Cargo dependency identity. Workflow
and application source edits do not create extra copies of all dependencies.
Check saves caches only on main. Package also saves on explicitly labeled PR
qualification. Cache misses build normally.

[Package](../.github/workflows/package.yml) is explicit release qualification,
started by manual dispatch or the `qualify-package` PR label. The official Tauri
action builds Debian and AppImage together. A two-format matrix then qualifies
those exact binaries in separate clean Ubuntu containers. Failed qualification
jobs can be retried without rebuilding. For changed fixtures, dispatch with
`build-run` and `build-attempt` to test saved bytes using the current fixtures;
this mode uploads evidence only. Binary identity and fixture revision remain
distinct. Raw inputs and diagnostics expire after seven days; qualified artifacts
expire after thirty days. See [package verification](packaging.md#build-and-qualify).

Before adding jobs, caches or repeated checks, compare complete usage against
[the CI budgets](https://github.com/avoid-quest/couch/issues/43#budgets). Record
run/attempt, exact source, cache state, checks and job/step timestamps.
Include failures, cancellation, setup and cleanup; distinguish queue delay from
allocated runner time and account billing. A passing build does not establish
package runtime or physical appliance acceptance. Reuse evidence unless a
change invalidates it, and state when warm performance has not been measured.
