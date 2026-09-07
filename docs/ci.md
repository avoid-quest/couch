# CI maintenance

[Check](../.github/workflows/check.yml) runs on main pushes and PR code changes.
Title/body edits skip work; retargeting a PR tests its new merge result. Path
detection compares the PR merge tree with its first parent, or a push with its
previous tip. Failed detection runs all checks.

Documentation-only changes skip source checks. Code changes run typechecking,
Bun tests and the frontend/sidecar build. The real-clock test file runs in a
separate Bun process from tests that mock process-wide clocks. Tauri sources,
configuration, toolchain, dependency manifests/lockfiles, build scripts and the
Check workflow also select locked Cargo tests, including the vendored video
plugin's startup-buffer tests. Release scripts and installer changes select
artifact-origin and signed-release trust tests within Check.

Cargo tests omit debug symbols while retaining assertions and overflow checks.
The cache action stores dependency downloads/build outputs, excludes installed
binaries and removes workspace/incremental outputs. Stable profile keys separate
Ubuntu test and release builds; the release key also includes pinned packaging
inputs. The action includes compiler and Cargo dependency identity. Workflow
and application source edits do not create extra copies of all dependencies.
Check saves caches only on main. Package also saves on explicitly labeled PR
qualification, so packaging fixes can reuse dependencies after a failed attempt.
Cache misses build normally.

[Package](../.github/workflows/package.yml) runs only on manual dispatch or the
`qualify-package` PR label. The official Tauri action builds Debian and AppImage
together. A two-format matrix then qualifies those exact binaries in separate
clean Ubuntu containers. Failed qualification jobs can be retried without
rebuilding. For changed fixtures, dispatch with `build-run` and `build-attempt`
to test saved bytes using the current fixtures; this mode uploads evidence only.
Binary identity and fixture revision remain distinct. Raw inputs and diagnostics
expire after seven days; qualified artifacts expire after thirty days. See
[package verification](packaging.md#build-and-qualify).

[Update worker](../.github/workflows/updater.yml) remains a small path-gated
workflow while the installed migration still depends on that implementation.
Its disposable runner verifies signatures and installs tiny dummy packages.
Keeping those system mutations separate from application checks costs no native
build or cache transfer. Remove it with the obsolete worker only after migration
and SSH recovery are qualified.

Before adding jobs, caches or repeated checks, compare complete usage against
[the CI budgets](https://github.com/avoid-quest/couch/issues/43#budgets). Record
run/attempt, exact source, cache state, selected checks and job/step timestamps.
Include failures, cancellation, setup and cleanup; distinguish queue delay from
allocated runner time and account billing. A passing build does not establish
package runtime or physical appliance acceptance. Reuse evidence unless a
change invalidates it, and state when warm performance has not been measured.
