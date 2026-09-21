## Change

Describe the behavior changed, relevant issues and any real PR dependency.

## Exact-revision merge gate

Do not mark ready or merge based on a website deployment or assertion count alone.
Attach the `bun run verify` receipt and relevant logs for the final head SHA.
A later code push invalidates that receipt. See `docs/ci.md`.

- [ ] Core checks/build: eligible receipt, exit 0, exact clean source revision.
- [ ] Frontend/build changes: same-revision built-sidecar remote journey receipt.
- [ ] Native changes: retained native tests and relevant Linux qualification.
- [ ] Workflow/packaging changes: required `act` proof before hosted dispatch.

State baseline failures separately from regressions. Record unhandled errors,
nonzero exits, skipped/container-only checks, simulated playback and hardware
acceptance separately. Explain any non-applicable gate rather than ticking it.

## Release

State whether a release was authorized. A review PR is not permission to publish,
tag, bump a version, or merge.
