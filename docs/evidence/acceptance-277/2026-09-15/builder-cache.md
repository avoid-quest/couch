# Debian builder layer cache

The release workflow now uses Docker's Buildx actions to import and export the Debian builder's layers through the GitHub Actions cache backend. It loads `couch-release-builder` into the local Docker daemon without publishing a container image. The existing Blacksmith 4 CPU runner and application build container settings remain unchanged.

The cache uses scope `couch-debian-builder-amd64`, API version 2 and `mode=min`. This single-stage Dockerfile needs only the layers of its final image. Cache export failure does not fail the release. Automatic Docker build-record artifact upload is disabled. The first build populates the cache; a hosted cache hit and elapsed-time improvement have not yet been measured.

## Inputs and action pins

Official GitHub release refs were resolved on 2026-09-15:

- [setup-buildx-action v4.3.0](https://github.com/docker/setup-buildx-action/releases/tag/v4.3.0): `37fe631027851001ddb9b187196cc803df7f5f0e`.
- [build-push-action v7.3.0](https://github.com/docker/build-push-action/releases/tag/v7.3.0): `53b7df96c91f9c12dcc8a07bcb9ccacbed38856a`.

The action uses the checked-out `packaging` directory and `packaging/Dockerfile.mac`, including when requalifying a retained release's original revision. All four evaluated build arguments match the previous shell command: Debian image digest `abc9cb88a5587630d7f915f47b23b0668fe250fbfc6457aa4d52b534c1bbf73f`, snapshot `20260914T000000Z`, Bun `1.4.2`, Rust `1.98.1`. The Dockerfile and subsequent container creation, startup and source transfer were not changed.

Docker's [GitHub Actions cache documentation](https://docs.docker.com/build/cache/backends/gha/) recommends the backend for Actions workflows within GitHub's cache limits. The build action supplies runtime cache credentials automatically; a standalone shell command needs additional runtime-variable setup. This is why the workflow uses the official actions. Docker documents [local image loading and build-record controls](https://github.com/docker/build-push-action/tree/v7.3.0).

## Local validation

Workflow SHA-256: `1aa9875113d637366e960aa4777e468d6ed1d08bab808bef6865936e3badfa91`.

- `act` v0.2.89 schema validation passed.
- Eleven isolated mocked control-flow scenarios passed in 25.387 seconds. They cover fresh builds, Preview publication, qualified retained Stable promotion, incomplete retained qualification, readiness-only, invalid inputs, disabled/non-main guards, builder failure and qualification failure. Qualified retained releases skip every builder step. Builder failure prevents the application build and publication.
- The existing act fixture was copied into `.artifacts/acceptance-277/builder-cache-act/`. Its step checks use names instead of old numeric positions, and it adds a builder-failure scenario. All remote actions and build operations are inert markers; containers have no network, Docker socket or credentials.
- A separate local shell comparison evaluated both the original build arguments and the new output step against repository inputs. All four values match. It also verifies the unchanged container lifecycle, explicit context/platform/image tag, local load, disabled push, cache configuration and qualification gates.
- `git diff --check` passed.

The [scripts, results and logs](builder-cache/) are retained in this evidence directory. Generated fixture workflows remain under `.artifacts/acceptance-277/builder-cache-act/`. These tests establish workflow selection and input preservation. They do not exercise GitHub's cache service, execute the Docker actions or establish a hosted performance result. No hosted run was started for this validation.
