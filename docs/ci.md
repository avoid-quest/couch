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

Live audio's correctness checks are listed in [Live audio](live-audio.md#checks).

The update regressions run with `bun test tests/updates.test.ts` and
`bun test tests/remote-updates.test.ts`. Browser storage and old native bridge
coverage runs with `bun test tests/browser-device-identity.test.ts`, and browser
server switching with `bun test tests/browser-connections.test.ts`.

Run Bun suites separately: module mocks in a combined process can interfere.
Build Core and `build/audio-worker.mjs` together before Node audio integrations.

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
The diagnosis integration (`tests/tv-diagnose.integration.ts`) runs
`packaging/tv/diagnose.js` the same way, with a hung sound server and seeded
secrets. Set `COUCH_EVIDENCE=<directory>` on the latency integrations to keep
their measurements ([native TV](native-tv.md#a-repeatable-hardware-run)).

Main's window lifecycle has a native check, after `bun run build`, on a display
(`xvfb-run -a` without one): `bun tests/renderer-status.native.ts <evidence
directory>`. It reserves `COUCH_PORT` (default 42870) and the next two ports.

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

## Bundled AirPlay receiver

On Linux, the same `afterPack` hook builds the pinned UxPlay with CMake
(`scripts/build-airplay.ts`) with Couch's patch
(`native/airplay/uxplay-sender-address.patch`), and puts it, its license,
`NOTICE.txt`, the unmodified pinned source and the patch in `Resources/airplay`. Package installs its build packages on the Linux
runner; a local Linux package needs `cmake pkg-config libssl-dev libplist-dev
libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev` and git, and fetches the
pinned commit once into `.artifacts/uxplay`. macOS and Windows packages have no
receiver. Build it for a development Core and run its tests as
[Receive AirPlay](airplay.md#develop-and-test) describes; prove changes to it in a
Package run under `act` as for any packaging change.

electron-builder loads `scripts/after-pack.ts` with Node, not Bun, so its imports
name their `.ts` extension; `bun test tests/package-hooks.test.ts` loads the hook
as electron-builder does.

## Bundled Mac JavaScript runtime

Mac packages also need CMake, git and Xcode command line tools. Package installs
CMake if missing. The `afterPack` hook builds unmodified QuickJS-NG **0.17.0**
from pinned commit `6d46d07d04041b40f4f49eaa7fdebe44c314c699`, for the
**target** architecture, into `Resources/quickjs`, with its MIT license and
source notice. CMake's `CMAKE_OSX_ARCHITECTURES` selects arm64 or x86_64 and
`CMAKE_OSX_DEPLOYMENT_TARGET=13.0` covers Intel Ventura while the Apple Silicon
app keeps its macOS 14 floor.
Packaging checks the Mach-O architecture and deployment target before signing;
only the host architecture is smoke-tested there. The official prebuilt
QuickJS-NG 0.17.0 binaries require macOS 26, so packaged Macs use this bundled
runtime instead of downloading them. It updates with Couch; manual helper
checks keep it. A compatible `qjs` on PATH can still take precedence.

After packaging, the Mac job verifies both app bundles with
`codesign --verify --deep --strict` and each bundled QuickJS executable with
`codesign --verify --strict`. Its explicit `mac/*.app` and `mac-arm64/*.app`
patterns also fail if either architecture is missing.

For development on a Mac without a compatible system QuickJS:

```sh
bun scripts/build-quickjs.ts
# Supply COUCH_QJS_PATH="$PWD/build/quickjs/qjs" to the isolated development Core.
```

`tests/helper-updates.integration.ts` covers bundled selection and manual checks
using isolated executable fixtures on Linux. This does not validate the Mac binary.

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

The single Mac invocation builds **arm64 and x64 DMGs and ZIPs** with architecture
in every filename. ZIPs are the updater payloads. The pinned electron-builder
merges both architectures into one `preview-mac.yml` or `latest-mac.yml`;
electron-updater chooses the matching ZIP. Keep both architectures in this
invocation: separate jobs uploading the same feed with `--clobber` would lose
one architecture. `bun test tests/package-hooks.test.ts` exercises the pinned
builder's merge and updater's selection on both channels.

Mac support is **Apple Silicon on macOS 14+**, **Intel on macOS 13+**. The app's
`LSMinimumSystemVersionByArchitecture` declares those floors; the common floor
is 13. Intel's optional native TV codec fallback downloads an official mpv build
only on 15+. Intel 13–14 can use a compatible mpv 0.35+ on PATH or in the helper
cache; otherwise just the channel needing it reports the installation requirement.
Core reads Apple's `/usr/bin/sw_vers -productVersion` before an automatic Intel
mpv download, leaving other platforms unchanged. System audio needs 14.2.
`tests/intel-mpv.integration.ts`, run on Node as above, covers first-use failure,
PATH/cache precedence, manual checks and the newer-OS download route using
simulated Mac selection and executable fixtures on Linux.
The Intel FFmpeg supplier stops making
new Intel releases in January 2027; migrate that verified distribution source
before promising continued maintained support ([audit](intel-macos-research.md)).
Cross-packaging on the ARM runner and Linux `act` are not Intel runtime tests:
before shipping, validate clean helper setup, playback (including native TV
codecs with a compatible local mpv, and their clear failure without one), screen
and audio-input capture, pairing and signed install/update on an Intel Ventura
Mac. System audio on 14.2+ and the existing Apple Silicon 14 floor need their
own device checks. A hosted ARM Package run proves cross-build/targets/signatures,
not Ventura execution.

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
been published here. Intel downloads come from real release assets; add no
Intel entry to `apps/web/src/releases.json` until one has shipped. Catalog
coverage runs with `bun test tests/release-catalog.test.ts`.

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
