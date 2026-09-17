# Development checks and release qualification

Iterate locally. Run the tests affected by a change, then the broader checks when
needed. Install the pinned Bun dependencies once per lockfile change.

```sh
bun install --frozen-lockfile
bun run typecheck
bun test --parallel=4 ./tests/linux/iptv-clock.test.ts
bun test --parallel=4 --path-ignore-patterns 'tests/linux/iptv-clock.test.ts'
bun run build
```

The two test commands keep the real-clock test in a separate Bun process from
tests that mock process-wide clocks. `bun run check` currently runs typechecking
and the parallel Bun suite; use the commands above for the full suite with clock isolation.
For native changes, run these after `bun run build` generates Tauri's sidecar,
with the platform's native build dependencies installed:

```sh
cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo test --manifest-path src-tauri/Cargo.toml --locked -p tauri-plugin-video startup_buffer
```

GitHub Actions is enabled. Use it for PR checks, builds and releases. Local checks
remain the quickest way to iterate. A passing assertion count with unhandled
errors or a nonzero exit is a failed run.

[Check](../.github/workflows/check.yml) is manually dispatched on Blacksmith's
Ubuntu runner. It runs typechecking, the isolated-clock Bun suite, the
frontend/sidecar build, locked Cargo tests and retained installer tests. Pushes
and PR edits do not dispatch it automatically.

[Package](../.github/workflows/package.yml) uses the pinned Debian 13 builder for
native packaging. A single job builds, signs, qualifies and uploads directly to
CrabNebula. Publication is an explicit input and fresh candidates enter Preview.
Actions artifacts contain small receipts, not required binary handoffs. The
[hosted release guide](hosted-releases.md) owns exact commands, retry rules and
unchanged-byte Stable promotion.

Run the release workflow locally with `act` after workflow edits, then verify a
real hosted run. Local emulation does not establish hosted quota availability,
secret access or successful publication. If GitHub capacity blocks a release,
use the same pinned Debian build on the Mac and upload to CrabNebula. The T480
never builds Couch, and published downloads do not depend on the Mac being online.

Before adding jobs, caches or repeated checks, compare complete usage against
[the CI budgets](https://github.com/avoid-quest/couch/issues/43#budgets). Record
run/attempt, exact source, cache state, checks and job/step timestamps.
Include failures, cancellation, setup and cleanup; distinguish queue delay from
allocated runner time and account billing. A passing build does not establish
package runtime or physical appliance acceptance. Reuse evidence unless a
change invalidates it, and state when warm performance has not been measured.
