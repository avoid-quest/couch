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

The following appliance commands exercise the retained Ubuntu POC. For the
current Debian package and the upper installer layer, use the
[Mac package and installer checks](packaging.md#isolated-mac-build).
Run `sudo "$(command -v bun)" scripts/test-publish-release.ts` and
`sudo bash scripts/test-appliance.sh` only in disposable Ubuntu environments.
They install packages and change system files. For real systemd/APT lifecycle
checks, `bash scripts/test-appliance-systemd.sh` creates its own privileged Docker
fixture on an amd64 Linux host.

GitHub Actions is paused at repository level, verified on 14 September 2026.
Use local checks during the capacity pause. The known current-main Happy DOM
teardown failure is tracked in [#247](https://github.com/avoid-quest/couch/issues/247);
see the [dated baseline](qualification/current-status-2026-09-14.md#local-validation).
A passing assertion count with unhandled errors and exit 1 is a failed run.

The workflow descriptions below document the retained, paused Ubuntu definitions.
The Package workflow needs the Debian release implementation in
[#276](https://github.com/avoid-quest/couch/issues/276) before it can deliver the
current package; restored capacity alone is insufficient. Use Actions only for
PR checks, builds and releases. The temporary
[Mac build path](tauri-releases.md) uses Debian 13 containers; the T480 only
installs and runs Couch.

[Check](../.github/workflows/check.yml) is configured as a manually dispatched
Ubuntu check. Pushes and PR edits do not start it.

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

[Package](../.github/workflows/package.yml) retains the POC's explicit release
qualification, configured for manual dispatch or the `qualify-package` PR label.
Its official Tauri action builds a `.deb` and AppImage together on Ubuntu. A
two-format matrix qualifies those exact binaries in separate clean Ubuntu
containers. These jobs do not implement the Debian 13 AppImage contract.
In that historical flow, failed qualification
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
