# Checks and releases

## Local checks

Use the latest stable Bun (1.4.4 or newer, as `package.json` `engines` says),
Node 24 or newer and the committed lockfile. Run these before asking for review:

```sh
bun install --frozen-lockfile
bun run typecheck
bun run test      # bun test --isolate: mocks, globals and timers stay per file
bun run build
```

`bun run test` isolates each file. When you run suites by hand with plain
`bun test`, run them one file at a time: module mocks in a combined process can
interfere. Run one file with `bun run test <path>`. Add a test only where a
behaviour must stay locked.

Dependencies use semver ranges. Update with `bun update --recursive` (or
`bun update --latest --recursive` across majors), run the checks, and commit the
manifests and `bun.lock` together.

### Focused suites

- Updates: `bun test tests/updates.test.ts` and `bun test tests/remote-updates.test.ts`.
- Browser storage and the old native bridge: `bun test tests/browser-device-identity.test.ts`;
  browser server switching: `bun test tests/browser-connections.test.ts`.
- Packaging hooks and the combined Mac update feed: `bun test tests/package-hooks.test.ts`.
- Website release catalog: `bun test tests/release-catalog.test.ts`.
- Live audio: see [Live audio](live-audio.md#checks).

An integration test, `tests/<name>.integration.ts`, runs on Core's Node runtime.
Build Core and `build/audio-worker.mjs` first for the audio integrations.

```sh
bun build tests/<name>.integration.ts --target=node --outfile=build/<name>.integration.mjs
node --test build/<name>.integration.mjs
```

- The TV health integration needs native Linux `/proc` (CPU emulation changes the
  reported executable). The installed app's Node can run it too:
  `ELECTRON_RUN_AS_NODE=1 /usr/bin/couch --test build/tv-health.integration.mjs`.
- `tests/couch-setup.integration.ts` runs `couch-setup` against a fixture root with
  its OS commands replaced. Its `--tv` and `--refresh` cases run as root in an
  unprivileged user namespace (`unshare -r`) and skip where the runner forbids
  one; a skip is not setup coverage. `tests/tv-diagnose.integration.ts` runs
  `packaging/tv/diagnose.js` the same way, with a hung sound server and seeded
  secrets.
- Set `COUCH_EVIDENCE=<directory>` on the latency integrations to keep their
  measurements ([native TV](native-tv.md#a-repeatable-hardware-run)).
- Main's window lifecycle has a native check, after `bun run build`, on a display
  (`xvfb-run -a` without one): `bun tests/renderer-status.native.ts <evidence directory>`.
  It reserves `COUCH_PORT` and the next two ports; this test defaults to 42870,
  not Couch's 4100.

## Workflows

Nothing runs on push or on pull requests. Check, Package and Release start only
by hand, and only when the owner asks: agents never dispatch them on their own.
Housekeeping is the one scheduled workflow.

| Workflow | Start it with | It does |
|---|---|---|
| [Check](../.github/workflows/check.yml) | `gh workflow run check.yml --ref <branch>` | Typecheck, test and build `<branch>` on Linux |
| [Package](../.github/workflows/package.yml) | `gh workflow run package.yml --ref <branch>` | Typecheck, tests, Go tests and installers of `<branch>` on Linux, macOS and Windows, kept 14 days as run artifacts and never published |
| [Release](../.github/workflows/release.yml) | Owner only ([For the owner](#for-the-owner), [Releases](#releases)) | Publishes a preview or promotes one to production |
| [Housekeeping](../.github/workflows/housekeeping.yml) | Scheduled | Weekly, Mondays 02:23 UTC: deletes expired artifacts and caches unused for 30 days |

Check and Package install the latest stable Bun and use the frozen lockfile.
Without `--ref`, a run uses the default branch, not your work. Follow a run on
the same branch: `gh run list --workflow check.yml --branch <branch>`, then
`gh run watch <run id>`.

Housekeeping keeps GitHub storage in check; agents don't edit or dispatch it
unless the owner asks.

### For the owner

The owner's usual flow: build test installers from a branch or PR, then publish
a preview from `main`. **Agents never run these commands unless the owner
explicitly asks for that specific run.**

```sh
gh workflow run package.yml --ref <branch>                 # installers of a branch or PR, as run artifacts
gh workflow run release.yml -f channel=preview             # publish main as the next preview
gh workflow run release.yml -f channel=production          # promote the latest preview to production
```

For a PR, `<branch>` is its head branch (`gh pr view <number> --json headRefName`).

Check, Package and Release run on [Blacksmith](https://docs.blacksmith.sh/blacksmith-runners/overview)
runners: Linux on `blacksmith-4vcpu-ubuntu-2404`, macOS on
`blacksmith-6vcpu-macos-26` and Windows on `blacksmith-4vcpu-windows-2025`;
Housekeeping uses GitHub's `ubuntu-latest`. Mac and Windows minutes cost more
than Linux's, so a Package or Release run costs roughly one Mac build. Keep the
Blacksmith GitHub App enabled for this repository.

## Bundled live relay

Packaging also requires Go on PATH (at least the version in `native/live-relay/go.mod`).
Package installs the latest stable Go;
ordinary `bun run build` still needs only Bun/Node. The electron-builder `afterPack`
hook compiles the `native/live-relay` module for the actual platform and
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

The packaging follows t3code's
[native resource monitor packaging](https://github.com/pingdotgg/t3code/blob/main/scripts/build-desktop-artifact.ts).
The helper uses [Pion TURN](https://github.com/pion/turn), recorded in `go.mod`/`go.sum`.
Update it with `go get -u ./...` and `go mod tidy` in `native/live-relay`, then run
the Go tests and the lifecycle integration above.
Validate native lifecycle/allocation on the target platform; cross-compilation
alone is not a runtime test.
Package runs the Go allocation tests on each target OS. Network tests explicitly
skip if that runner has no active, non-loopback private IPv4
host admitted by the relay's subnet policy (for example, a /32 is ineligible).
They log interface eligibility and the TCP client source to diagnose runner
network differences. A skipped test is not relay runtime validation.

## Bundled Mac capture input

The `afterPack` hook also builds `scripts/build-live-audio.ts` before signing.
It verifies the PortAudio archive for commit
`1ca0eeedb678c3cca80f3306c474d69a7a4b5278` against SHA-256
`2602de95236428dcf1329e66f1adb1b603b12d16f8d368e11f909a84ba1ccd83`.
CMake builds unmodified static PortAudio/CoreAudio for each target with
`CMAKE_OSX_ARCHITECTURES=arm64|x86_64` and a macOS 13 deployment target,
matching the existing QuickJS cross-build. The capture compilation uses that
same architecture and floor. Apple Silicon's app floor remains macOS 14.

`Resources/live-audio` contains `couch-capture`, `PortAudio-LICENSE.txt`,
`NOTICE.txt` and `build-info.json` (source, queue and pre-app-signing binary
hashes, target architecture, deployment target and native-smoke result).
The builder verifies both library/helper slices with `lipo`, helper deployment
with `otool`, system-only dynamic dependencies and an ad-hoc signature.
It runs permission-free `--list` only for the host's native architecture.
The Mac Package job verifies each helper again after electron-builder signs
both app bundles with Couch's release identity. Keep the single dual-arch
invocation and combined Mac update feed.

Linux and Windows skip this native helper and retain browser input capture.
No PortAudio or native playback dependency is needed on those package runners.
Development on Mac: `bun scripts/build-live-audio.ts`; logs remain under
`.artifacts/portaudio`. Run `bun test tests/package-hooks.test.ts` for the Node
hook loader, non-Mac no-op and combined update-feed checks. Capture lifecycle
and authorization use `tests/native-live-authority.test.ts`,
`tests/capture.test.ts` and Node `tests/native-capture.integration.ts`.
Sendspin source checks are listed in [Live audio](live-audio.md).

For the C queue test, use the verified extracted PortAudio source's `include`
and `src/common` directories, compile `native/live-audio/capture-queue.test.c`
with `src/common/pa_ringbuffer.c` using `cc -std=c11 -O2 -Wall -Wextra -Werror`
and `-lm`, then execute it. Neither it nor discovery tests microphone consent
attribution, device audio, physical timing or Intel Ventura execution. Those
remain separate packaged-app checks; on Linux the hook is a no-op.

## Bundled AirPlay receiver

On Linux, the same `afterPack` hook builds the pinned UxPlay with CMake
(`scripts/build-airplay.ts`) with Couch's patch
(`native/airplay/uxplay-sender-address.patch`), and puts it, its license,
`NOTICE.txt`, the unmodified pinned source and the patch in `Resources/airplay`. Package installs its build packages on the Linux
runner; a local Linux package needs `cmake pkg-config libssl-dev libplist-dev
libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev` and git, and fetches the
pinned commit once into `.artifacts/uxplay`. macOS and Windows packages have no
receiver. Build it for a development Core and run its tests as
[Receive AirPlay](airplay.md#develop-and-test) describes. A Package run on the
branch, dispatched when the owner asks, proves changes to it.

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
`codesign --verify --deep --strict` and each bundled QuickJS and capture executable with
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

Only the owner starts a release, from `main`; Release refuses any other branch.
Agents never dispatch it, create tags, bump the version or publish, even when a
PR is ready. Write pull request titles as plain sentences: GitHub's generated
release notes list them.

Couch ships on two channels, both published in
[this repository's releases](https://github.com/avoid-quest/couch/releases):

- **Preview**, `vX.Y.Z-preview.N`: `main` when Release runs with
  `channel=preview`, skipped when that commit already has a preview. It installs
  as Couch Preview, with its own icon.
- **Production**, `vX.Y.Z`: Release with `channel=production` promotes the latest
  preview's commit and drops the suffix, so try that preview first.

For now Couch publishes previews only. `package.json`'s base is 0.4.0, so Release
publishes `v0.4.0-preview.N` until the owner promotes one to production; no
production release exists yet.

`package.json` holds the base version, X.Y.Z. A preview counts N up from the
highest preview of that base; once `vX.Y.Z` ships, previews continue at
X.Y.(Z+1)-preview.1 without a commit. The owner bumps the minor or major version
by editing `package.json`. CI sets the resolved version only in the build's tree
([scripts/release.ts](../scripts/release.ts)).

Release runs four jobs:

1. **preflight** checks out shallowly, fetches only `v*` tags (one commit deep,
   no file history) and resolves the version, tag and commit, within ten minutes.
2. **draft** opens a draft release whose notes start with the macOS first-launch
   command, followed by GitHub's generated notes since the previous release on
   the same channel.
3. **package** calls Package with that version and commit; each OS uploads its
   installers and update files straight into the draft.
4. **publish** publishes the draft, marking production as latest; its tag points
   to the built commit.

The updater never sees a draft, so a failed run publishes nothing; rerun its
failed jobs to finish it (a rerun keeps its draft). Nothing passes through
artifact storage. Release and Package use GitHub's automatic `GITHUB_TOKEN` with
`contents: write`; no personal access token or separate release repository is
needed. The repository must stay public so the website and installed apps can
read its releases without authentication.

Couch and Couch Preview share an appId and a data directory, so only one of them
runs at a time. electron-updater keeps each on its channel: a preview follows
only previews (`preview-*.yml`), production only the latest production release
(`latest-*.yml`). **Settings > Updates** switches channel; leaving Preview for
Stable installs the older stable release. The app checks at start and every 4
hours and installs the update when Couch quits or restarts to update
([app/update.ts](../app/update.ts)). The TV installs through a root unit
([native TV](native-tv.md)).

## Platforms and signing

Package builds AppImage and deb on Linux (x64), dmg and zip on macOS, and nsis on
Windows (x64). The single Mac invocation builds **arm64 and x64 DMGs and ZIPs**
with the architecture in every filename; ZIPs are the updater payloads.
electron-builder merges both architectures into one `preview-mac.yml` or
`latest-mac.yml`, and electron-updater picks the matching ZIP. Keep both
architectures in this one invocation: separate jobs uploading the same feed with
`--clobber` would lose one. `bun test tests/package-hooks.test.ts` exercises the
installed builder's merge and the updater's selection on both channels.

Mac support is **Apple Silicon on macOS 14+** and **Intel on macOS 13+**, declared
by `LSMinimumSystemVersionByArchitecture`; system audio needs 14.2. Intel's
optional native TV codec fallback downloads an official mpv build only on 15+;
Intel 13–14 can use a compatible mpv 0.35+ on PATH or in the helper cache,
otherwise only the channel needing it reports the requirement. Core reads
`/usr/bin/sw_vers -productVersion` before that download.
`tests/intel-mpv.integration.ts` (run on Node as above) covers this with
simulated Mac selection on Linux. The Intel FFmpeg supplier stops new Intel
releases in January 2027; migrate that source before promising continued Intel
support. A hosted ARM Package run proves cross-build, targets and signatures,
not execution on an Intel Mac: validate helpers, playback, capture, pairing and
signed install/update on Intel hardware before claiming them.

The Mac app is signed with Couch's own self-signed certificate,
[`Couch Releases`](../packaging/couch-releases.pem), without an Apple account or
notarization. macOS keeps an app's permissions, and Squirrel.Mac installs an
update, only when the new build satisfies the running one's
[designated requirement](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements):
its identifier and this certificate. Users' Macs need not trust it; the runner
trusts it for code signing so that codesign accepts it. The repository secrets
`CSC_LINK` (the base64 .p12) and `CSC_KEY_PASSWORD` hold the private key, which
the owner also keeps backed up. Keep that certificate: a new one makes every Mac
user grant permissions and download Couch again. After packaging, the Mac job
verifies both app bundles with `codesign --verify --deep --strict` and the
bundled QuickJS and capture executables with `codesign --verify --strict`.
Windows and Linux builds are unsigned.

The website's fallback catalog lists only installers actually published here:
add no Intel entry to `apps/web/src/releases.json` until one has shipped.
