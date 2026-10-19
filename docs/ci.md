# Checks and releases

Use the pinned Bun 1.4.2 and the frozen lockfile.

```sh
bun install --frozen-lockfile
bun run typecheck
bun run build
```

[Check](../.github/workflows/check.yml) runs the same three commands on Linux.

Nothing runs on push or on pull requests. Every workflow starts by hand:

| Workflow | Start it with | It does |
|---|---|---|
| Check | `gh workflow run check.yml` | Typecheck and build on Linux |
| Package | `gh workflow run package.yml --ref <branch>` | Unpublished installers of any branch, kept 14 days as run artifacts |
| Release | `gh workflow run release.yml -f channel=preview` | Publishes `main` as the next preview |
| Release | `gh workflow run release.yml -f channel=production` | Promotes the latest preview to production |

Housekeeping also runs weekly on its own and only deletes expired artifacts and
stale caches.

Add a test only where a behaviour must stay locked, and run it with
`bun test <path>`.

The update regressions run with `bun test tests/updates.test.ts` and
`bun test tests/remote-updates.test.ts`. Browser storage and old native bridge
coverage runs with `bun test tests/browser-device-identity.test.ts`, and browser
server switching with `bun test tests/browser-connections.test.ts`.

An integration test, `tests/<name>.integration.ts`, runs on Core's Node runtime:

```sh
bun build tests/<name>.integration.ts --target=node --outfile=build/<name>.integration.mjs
node --test build/<name>.integration.mjs
```

The TV health integration needs native Linux `/proc` (CPU emulation changes the
reported executable). The installed app's Node also runs it:
`ELECTRON_RUN_AS_NODE=1 /usr/bin/couch --test build/tv-health.integration.mjs`.
The setup integration (`tests/couch-setup.integration.ts`) runs `couch-setup`
against a fixture root with its OS commands replaced. Its `--tv` and `--refresh`
cases run as root in an unprivileged user namespace (`unshare -r`) and skip
where the runner forbids one; a skip is not setup coverage.

## Bundled live relay

Packaging also requires Go **1.27.2** on PATH. Package installs that pinned toolchain;
ordinary `bun run build` still needs only Bun/Node. The electron-builder `afterPack`
hook compiles the pinned `native/live-relay` module for the actual platform and
architecture with CGO disabled, and puts the executable and dependency notices in
`Resources/live-relay` before signing. Users need neither Go nor a separate relay
installation. macOS signing covers the helper along with the app.

For a local development Core, build its helper and check the lifecycle with:

```sh
bun scripts/build-relay.ts
bun build tests/live-relay.integration.ts --target=node --outfile=build/live-relay.integration.mjs
node --test build/live-relay.integration.mjs
(cd native/live-relay && go test -v ./...)
```

The lifecycle integration also compiles a native TURN test client with Go. It
checks real allocations before and after paired-device removal, including an
allocation held open across revocation. Keep Go on PATH for that test too.

The desktop resource pattern follows t3code's
[native resource monitor packaging](https://github.com/pingdotgg/t3code/blob/main/scripts/build-desktop-artifact.ts).
The helper uses [Pion TURN](https://github.com/pion/turn), pinned by `go.mod`/`go.sum`.
Validate native lifecycle/allocation on the target platform as well as the Linux
package workflow in `act`; cross-compilation alone is not a runtime test.
Package runs the Go allocation tests on each target OS. Network tests explicitly
skip if that runner has no active, non-loopback private IPv4
host admitted by the relay's subnet policy (for example, a /32 is ineligible).
They log interface eligibility and the TCP client source to diagnose runner
network differences. A skipped test is not relay runtime validation.

## Releases

Couch ships on two channels, both published in
[this repository's releases](https://github.com/avoid-quest/couch/releases):

- **Preview**, `vX.Y.Z-preview.N`: `main` when you run Release with
  `channel=preview`, skipped when that commit already has a preview. It
  installs as Couch Preview, with its own icon.
- **Production**, `vX.Y.Z`: Release with `channel=production`. It promotes the
  latest preview's commit and drops the suffix, so try that preview first.

`package.json` holds the base version, X.Y.Z. A preview counts N up from the
highest preview of that base; once `vX.Y.Z` ships, previews continue at
X.Y.(Z+1)-preview.1 without a commit. Bump the minor or major version by
editing `package.json`. CI sets the resolved version in the tree only for the
build ([scripts/release.ts](../scripts/release.ts)).

Couch and Couch Preview share an appId and a data directory, so only one of
them runs at a time. electron-updater keeps each on its channel: a preview
follows only previews (`preview-*.yml`), production only the latest production
release (`latest-*.yml`). **Settings > Updates** switches channel; leaving
Preview for Stable installs the older stable release. The app checks at start
and every 4 hours, and electron-updater installs the update when Couch quits or
restarts to update ([app/update.ts](../app/update.ts)). The TV installs through
a root unit ([native TV](native-tv.md)).

[Release](../.github/workflows/release.yml) resolves the version, opens a draft
release with GitHub's generated notes, builds with
[Package](../.github/workflows/package.yml) (AppImage and deb on Linux, dmg and
zip on macOS, nsis on Windows), which uploads straight into the draft, then
publishes it with a tag pointing to the built commit. Nothing passes through
artifact storage, and the updater never sees a draft, so a failed run publishes
nothing; rerun its failed jobs to finish it. Write pull request titles as plain
sentences: they become the release notes. Package can also be dispatched on its
own for a test build of `package.json`'s version, kept as run artifacts and
never published.

The Mac app is signed with Couch's own self-signed certificate,
[`Couch Releases`](../packaging/couch-releases.pem), without an Apple account or
notarization. macOS keeps an app's permissions, and Squirrel.Mac installs an
update, only when the new build satisfies the running one's
[designated requirement](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements):
its identifier and this certificate. Users' Macs need not trust it; the runner
trusts it for code signing so that codesign accepts it. The repository secrets
`CSC_LINK` (the base64 .p12) and `CSC_KEY_PASSWORD` hold the private key for
electron-builder, and a copy lives in the owner's password manager. Keep that
certificate: a new one makes every Mac user grant permissions and download
Couch again. Windows and Linux builds are unsigned.

Every build runs on [Blacksmith](https://docs.blacksmith.sh/blacksmith-runners/overview),
as in t3code: macOS on `blacksmith-6vcpu-macos-26` and Windows on
`blacksmith-4vcpu-windows-2025`, beside Linux. Their minutes cost 20× and 4×
Linux's from the same allowance, so a release costs roughly one Mac build.

Release and Package use GitHub's automatic `GITHUB_TOKEN` with
`contents: write` for release creation, uploads and publication. No separate
release repository or personal access token is needed. Existing credentials
remain available for the integrations that use them.

The repository must be public before the website and installed apps can read
its releases without authentication. Workflow dispatches do not change its
visibility. Keep the Blacksmith GitHub App enabled for this repository.

The website's fallback catalog should list only installers that have actually
been published here.

## Workflow changes

Prove workflow and packaging edits with [`act`](https://nektosact.com) before
dispatching them, using `catthehacker/ubuntu:full-latest` (the default act image
lacks `gh`). Release's preflight reads git inside the container, so run it from
a clone rather than a worktree, with an event that says the run is on `main`:

```sh
act workflow_dispatch -W .github/workflows/check.yml -j linux \
  -P blacksmith-4vcpu-ubuntu-2404=catthehacker/ubuntu:full-latest
git clone -q --depth 1 --branch v4.6.2 https://github.com/actions/upload-artifact /tmp/upload-artifact-v4
act workflow_dispatch -W .github/workflows/package.yml -j package --matrix name:linux \
  -P blacksmith-4vcpu-ubuntu-2404=catthehacker/ubuntu:full-latest \
  --container-architecture linux/amd64 --artifact-server-path /tmp/act-artifacts \
  --local-repository actions/upload-artifact@v7=/tmp/upload-artifact-v4
echo '{"ref":"refs/heads/main","inputs":{"channel":"preview"}}' > /tmp/release-event.json
act workflow_dispatch -W .github/workflows/release.yml -j preflight \
  -e /tmp/release-event.json \
  -P blacksmith-4vcpu-ubuntu-2404=catthehacker/ubuntu:full-latest \
  --container-architecture linux/amd64
```

act's artifact server doesn't accept upload-artifact v7's requests, so the
Package run swaps in v4 for that step only. A dispatched Package builds
`package.json`'s version; to build a preview, as Release does, run it from a
clone with `bun pm pkg set version=X.Y.Z-preview.N` left uncommitted. The
installers land zipped in `/tmp/act-artifacts/1/couch-linux/`. Local emulation
does not prove hosted capacity, secret access or timings.
