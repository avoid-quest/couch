# Checks and releases

## Local checks

Use the latest stable Bun (1.4.4+, see `engines`), Node 24+ and the committed
lockfile.

```sh
bun install --frozen-lockfile
bun run typecheck
bun run test      # unit tests, each file isolated from other files' mocks and globals
bun run build
```

Run one unit file with `bun run test <path>`. Plain `bun test` shares one
process across files, so module mocks can interfere.

### Integration tests

`tests/*.integration.ts` run on Core's runtime, Node. Build Core and the audio
worker first (`bun run build`), then:

```sh
bun build tests/<name>.integration.ts --target=node --outfile=build/<name>.integration.mjs
COUCH_DATA_DIR="$(mktemp -d)" node --test build/<name>.integration.mjs
```

- FFmpeg must be on `PATH` or set as `COUCH_TEST_FFMPEG`; the Live and
  scheduled-audio integrations fail without it.
- The relay integrations need Go on `PATH` and `bun scripts/build-relay.ts` first.
- `tests/couch-setup.integration.ts` and `tests/tv-diagnose.integration.ts` run
  their root cases in an unprivileged user namespace (`unshare -r`) and skip where
  the machine forbids one; a skip isn't coverage.

### Performance harnesses

Both build their own Electron run on an ephemeral port and data directory. Run
them alone, with nothing else competing for the CPU, and on a real display
for GPU claims (Xvfb is software rendering).

```sh
COUCH_PERF_WIDTH=1512 COUCH_PERF_HEIGHT=982 bun tests/player-performance.native.ts .artifacts/player --rounds=40 --assert-budget=60
bun tests/player-performance.native.ts .artifacts/seek --seek --rounds=3   # seek bar
COUCH_PERF_MEDIA=<1080p60 mp4> bun tests/video-performance.native.ts .artifacts/video --modes=playback,live --fps=60 --rounds=3 --assert-fps=55
```

`COUCH_PERF_AUDIO=<mp3>` adds continuous audio to the player harness. On the
Linux lab machine, `~/.local/bin/couch-hdmi <command>` runs a command on the
real HDMI display (RTX 3060, 1080p60).

## Workflows

Nothing runs on push or on pull requests. Check, Package and Release start only
by hand, **and only when the owner asks**. Housekeeping is the one scheduled
workflow; leave it alone.

| Workflow | Start it with | It does |
|---|---|---|
| [Check](../.github/workflows/check.yml) | `gh workflow run check.yml --ref <branch>` | Typecheck, test and build on Linux |
| [Package](../.github/workflows/package.yml) | `gh workflow run package.yml --ref <branch>` | Tests and installers for Linux, macOS and Windows, kept 14 days as run artifacts |
| [Release](../.github/workflows/release.yml) | `gh workflow run release.yml -f channel=preview\|production` | Publishes a preview from `main`, or promotes the latest preview |
| [Housekeeping](../.github/workflows/housekeeping.yml) | Scheduled, Mondays | Deletes expired artifacts and unused caches |

Without `--ref`, a run uses the default branch, not your work. Package gets the
Mac signing secrets, so run it only on code the owner trusts. Runs use
Blacksmith runners; Mac and Windows minutes cost more than Linux.

## Releases

- **Preview** `vX.Y.Z-preview.N`: Release on `main` with `channel=preview`. It
  installs as Couch Preview with its own icon.
- **Production** `vX.Y.Z`: Release with `channel=production` promotes the latest
  preview's commit.

`package.json` holds the base version X.Y.Z; previews count N up from the highest
preview of that base, and CI sets the resolved version only in the build's tree
([scripts/release.ts](../scripts/release.ts)). Release drafts a GitHub release,
lets Package upload each OS's installers into it, then publishes it, so a failed
run publishes nothing; rerun its failed jobs to finish. The repository must stay
public so installed apps can read releases without authentication.

Couch and Couch Preview share an appId and data directory. electron-updater keeps
each on its channel (`preview-*.yml` or `latest-*.yml`), checks at start and every
4 hours, and installs on quit ([app/update.ts](../app/update.ts)). The TV installs
through a root unit ([native TV](native-tv.md)).

## Platforms and signing

- Linux: AppImage and deb (x64). Windows: nsis (x64). Both unsigned.
- macOS: one electron-builder invocation builds arm64 and x64 DMGs and ZIPs and
  merges both into one `*-mac.yml` feed. Keep it one invocation: two jobs
  uploading the same feed would lose one architecture.
- Apple Silicon needs macOS 14+, Intel 13+ (`LSMinimumSystemVersionByArchitecture`).
  Martin Riedl, Couch's Intel FFmpeg supplier, stops Intel releases in January
  2027. A hosted ARM run doesn't prove execution on Intel.
- The Mac app is signed with Couch's self-signed
  [`Couch Releases`](../packaging/couch-releases.pem) certificate, without
  notarization. macOS keeps permissions and Squirrel.Mac installs updates only
  when a build matches the running one's designated requirement, so **keep this
  certificate**: a new one makes every Mac user grant permissions and download
  Couch again. `CSC_LINK` and `CSC_KEY_PASSWORD` hold the key.
- The website's fallback catalog (`apps/web/src/releases.json`) lists only
  installers actually published.

## Bundled helpers

electron-builder's `afterPack` hook (`scripts/after-pack.ts`, loaded by Node, so
its imports name their `.ts` extension) builds these for the target platform
before signing. `bun test tests/package-hooks.test.ts` loads it the same way.

- **Live relay** (`native/live-relay`, Pion TURN): needs Go on `PATH` (the
  version in `go.mod`), built with CGO off. For a development Core:
  `bun scripts/build-relay.ts`; Go tests: `(cd native/live-relay && go test ./...)`.
  Network tests skip without a private non-loopback IPv4.
- **Mac capture input** (`native/live-audio`): pinned PortAudio, verified by
  SHA-256, built with CMake as one arm64/x86_64 helper for macOS 13. Development:
  `bun scripts/build-live-audio.ts`. Linux and Windows use browser capture.
- **AirPlay receiver** (Linux only): pinned UxPlay with Couch's patch
  (`native/airplay/`), built with CMake. A local build needs
  `cmake pkg-config libssl-dev libplist-dev libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev`.
  See [Receive AirPlay](airplay.md).
- **QuickJS-NG** (Mac only): built from a pinned commit for each architecture and
  macOS 13, because upstream's binaries need macOS 26. Development on an older
  Mac: `bun scripts/build-quickjs.ts`, then set
  `COUCH_QJS_PATH="$PWD/build/quickjs/qjs"`.

The Mac Package job verifies both app bundles with
`codesign --verify --deep --strict` and fails if either architecture is missing.
