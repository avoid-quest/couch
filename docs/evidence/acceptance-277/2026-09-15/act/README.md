# Local act validation for hosted release acceptance

Source baseline: `b38b01f5beb92c8f6e08ae0ffae70d715c41b18c`.
Date: 2026-09-15 Europe/Rome.

The original workflow is recoverable from `git show b38b01f5beb92c8f6e08ae0ffae70d715c41b18c:.github/workflows/package.yml`. `package.fixed.yml` preserves the workflow-efficiency agent's follow-up version with receipt retry and cache-retention fixes. Original SHA-256: `ade4abdbc214880541aadd16f52a779e6d7b70580b06aef7e45693cdf031e0bd`. Tested fixed SHA-256: `238bdd0fe0a268a5003d3340ff0805e4a18a1ccefac92110fc6f05f1af1f83a2`. These also appear in `results-original.json` and `results.json`. Later edits to the tracked workflow comment and publish-input description do not change this tested control flow. The tracked workflow was not edited by this validation task.

## Results

- Original and fixed workflows pass `act --validate`.
- Original event listing contains only `workflow_dispatch` with five stages: draft, candidate, upload, publish, readiness.
- Original workflow with `COUCH_RELEASES_ENABLED=false` passes dry-run with no selected jobs.
- Original and fixed workflows pass all 10 isolated mocked act scenarios. Fixed scenarios took 21.252 seconds in total. This measures local control-flow validation, not build performance.
- All 19 exact-shell fixtures pass their assertions. These include deliberate reproduction of the original defects, not a claim that the original behavior was acceptable.
- Existing `couch-debian-275-builder:latest` has `systemd-analyze`, `adduser`, `jq`, `minisign`, `bun` and `rustc`. The disposable read-only probe reported systemd `257.13-1~deb13u1` and adduser `3.152`.
- All task-created containers completed and were removed. Pre-existing containers remained stopped. No hosted run, publication, deployment or full build was performed.

| Act scenario | Completed jobs | AppImage build selected | Qualification selected |
| --- | --- | --- | --- |
| Default inputs | draft, candidate, upload | yes | yes |
| Preview publish | draft, candidate, upload, publish, readiness | yes | yes |
| Qualified retained Stable | draft, candidate, upload, publish, readiness | no | no |
| Unqualified retained retry | draft, candidate, upload | no | yes |
| Readiness-only retained | draft, candidate, readiness | no | no |
| Stable with build-run 0 | input rejection | no | no |
| Readiness-only with build-run 0 | input rejection | no | no |
| Non-main ref | none | no | no |
| Release gate disabled | none | no | no |
| Qualification fails with publish requested | draft only | yes | yes, fails |

The failure scenario confirms downstream upload, publication and readiness do not run after qualification fails. The retained scenarios confirm the expensive builder and AppImage build are skipped when a complete matching qualification receipt exists.

## Exact-shell regression checks

`shell-fixtures.ts` extracts the actual workflow shell commands and runs them with real `jq`, temporary files and inert `git`/`docker` command fixtures. Results and captured command traces are in `shell-results.json`.

- Missing receipt reruns qualification in both versions.
- Complete matching receipt skips qualification in both versions.
- Original workflow incorrectly skips partial, malformed and mismatched version/revision/file receipts. The fixed workflow reruns qualification in all five cases.
- Original retention stops at the missing artifact directory, before copying any compiler/dependency cache. Fixed retention attempts all four caches without depending on artifact output.
- If the first cache copy fails, fixed retention still attempts the other three and completes with a warning.
- Fixed cache retention and stop safely handle a missing builder container.

## First failure preserved

The first mock event payload used JSON boolean `true`. act v0.2.89 interpreted it as false for boolean workflow-dispatch inputs. Four scenarios therefore failed the expected flow. `results-boolean-fixture-failure.json` preserves those first outcomes. The original fixture script and full logs remain in the local `.artifacts/acceptance-277/act/` directory.

The linked pinned act source at lines 500-510 compares a dispatch input value to the string `"true"`. The fixture was corrected to use string values in `github.event.inputs`, matching the documented GitHub event representation. All ten scenarios then passed. This is a local act fixture issue, not a product/workflow defect.

## Isolation and tools

- Installed only under local `.artifacts/acceptance-277/act/`: official act v0.2.89 Darwin arm64 archive, verified against the release SHA-256 checksum. See `act-checksum.txt`.
- Docker Desktop 4.89.0 with Docker Engine 29.7.2 on Apple arm64.
- All act execution had an empty credential environment, a task-specific HOME, `/dev/null` for secret/variable/input/env files, explicit `DOCKER_HOST`, and no authentication tokens.
- Mock job containers used `--network none --container-daemon-socket - --pull=false`. Existing local images were reused only as shell/jq fixtures, without claiming application qualification.
- Blacksmith's workflow runner label is mapped locally to the shell fixture. Original run used `debian:13-slim`; the fixed run used `couch-local-systemd-arm64-5832:latest` for native arm64 `jq` availability.
- Every remote action and every provider/build/installation command was replaced with an inert marker. Original job dependencies, conditions, step conditions and input defaults were retained. Real source-build shell assertions and receipt-selection shell were executed.
- The complete per-scenario act argument lists and timings are in the results JSON files. The generated workflows and event payloads remain in the local `.artifacts/acceptance-277/act/workspace/` directory. The committed scripts regenerate them.

Reproduce in a disposable directory from the repository root. Install act v0.2.89 in that directory's `bin/act` and verify it against `act-checksum.txt`. The two named local shell fixture images must be available; they are not public production images. Another native Linux image with bash and jq can replace the platform mapping for these mocked checks.

```sh
mkdir -p .artifacts/acceptance-277/replay/{bin,home,workspace}
cp docs/evidence/acceptance-277/2026-09-15/act/{validate.ts,shell-fixtures.ts,package.fixed.yml} .artifacts/acceptance-277/replay/
git show b38b01f5beb92c8f6e08ae0ffae70d715c41b18c:.github/workflows/package.yml > .artifacts/acceptance-277/replay/package.original.yml
bun .artifacts/acceptance-277/replay/validate.ts .artifacts/acceptance-277/replay/package.fixed.yml
bun .artifacts/acceptance-277/replay/shell-fixtures.ts
```

The scripts use the original Mac's explicit Docker socket. Adjust that socket for another machine. The local full evidence and act binary remain under `.artifacts/acceptance-277/act/`; no downloaded binary, cache or generated mock workspace is committed.

The direct shell fixtures compare the preserved original to the current tracked workflow. Running them after additional edits validates those later edits, rather than the exact fixed snapshot above.

## Performance guidance and remaining hosted checks

Use retained run/attempt inputs after a failed upload or readiness check. A complete matching receipt skips the Debian builder, dependency restoration, compilation and qualification. An incomplete receipt reruns qualification against retained signed bytes without rebuilding the AppImage. The cache-retention fix preserves reusable compiler/dependency state even before artifact output exists.

Keep public release-asset upload compression at zero because the AppImage and archives are already compressed. The workflow already does this. Time the first native Blacksmith build before changing CPU/memory limits or concurrency. Native local control-flow timing does not predict hosted compilation time.

act does not establish Blacksmith availability, the runner's Node/Docker/toolchain support, repository permissions, protected-environment approvals, concurrency locking, publication, CDN readiness or cross-run artifact download compatibility. Real signed bytes and hosted acceptance remain separate requirements. In particular, act documentation says job environments, permissions, timeouts and concurrency are unsupported, and cross-run artifact downloads are unsupported by its artifact server.

## Official references

- [act v0.2.89 release](https://github.com/nektos/act/releases/tag/v0.2.89)
- [act installation](https://nektosact.com/installation/index.html)
- [act usage and dispatch inputs](https://nektosact.com/usage/index.html)
- [act unsupported features](https://nektosact.com/not_supported.html)
- [Pinned boolean input evaluation](https://github.com/nektos/act/blob/v0.2.89/pkg/runner/expression.go#L500-L510)
