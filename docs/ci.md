# CI maintenance

[Check](../.github/workflows/check.yml) owns events, commands, Linux packages,
the Cargo cache, and inline path filters. Unknown paths or failed detection
select native validation. Bun commands live in [package.json](../package.json).

Native validation runs locked Cargo tests on the Rust version in
[rust-toolchain.toml](../rust-toolchain.toml). The default test command compiles
the normal library and binary, library/binary unit-test targets, the Linux
`render_abi` integration test, and library doctests. The manifest has no custom
features or target overrides; Linux keeps the video plugin's `mpv-runtime`
feature. This covers the former default Cargo check as well as native tests.
Frontend and sidecar generation still precede Cargo. Release packaging and
other platforms remain separate product qualification work.

CI omits debug symbols from dev/test artifacts to reduce compilation and cache
transfer. Debug assertions, overflow checks, and the default optimization level
remain unchanged. The Ubuntu runner supplies build tools; APT adds WebKit,
XDo, TLS, mpv, OpenGL development libraries, and ffmpeg for media tests. This
validation does not build installers or enable Tauri's tray feature.

The Cargo action caches downloads and dependency build outputs, removes
workspace and incremental artifacts, and disables incremental compilation.
Its key includes compiler/host, OS/architecture, Cargo environment, manifests,
and lockfiles. Our additional key covers the Ubuntu version, selected command
and features, workflow, vendor sources, and native/build inputs. Vendor or
workflow changes therefore also invalidate fallback caches. Application source
edits reuse dependencies and rebuild the application; frontend and sidecar
outputs are always regenerated. Cache misses build normally. Only Cargo cache
directories are stored, without credentials or the full Cargo home. PR caches
use GitHub's unprivileged PR scope and cannot populate the base branch's cache.

Before adding checks, jobs, platforms, or repeated validation, compare complete
before/after usage against the [CI gate's budgets and evidence rules](https://github.com/avoid-quest/couch/issues/43#budgets).
Use Actions logs for selected coverage, cache hits and
compiler commands, and `gh api repos/avoid-quest/couch/actions/runs/RUN_ID` plus
`gh api repos/avoid-quest/couch/actions/runs/RUN_ID/attempts/ATTEMPT/jobs --paginate`
for run/job/step timestamps. Record every attempt and exact commit, including
failures, cancellations, and metadata-only events. Measure first allocated job
start through the final workflow result, including setup, cache transfer and
cleanup; report initial queue delay and commit-to-result latency separately.
Sum each allocated job's upward-rounded minutes, then aggregate per revision
across events and retries. Keep post-merge main validation visible separately.
These timestamp estimates are distinct from account billing data.

A cold native measurement needs no usable Cargo dependency/build cache. Warm
proof needs two consecutive relevant native source edits that reuse an earlier
compatible cache; rerunning one SHA does not prove incremental performance.
Reuse existing documentation/ordinary evidence when their behavior is unchanged.
