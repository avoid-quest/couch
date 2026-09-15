# Hosted releases

The manual [Package workflow](../.github/workflows/package.yml) builds in the
pinned Debian 13 container on Blacksmith, qualifies the package, and uploads
directly to CrabNebula in one job. GitHub retains small signed receipts, never
another application payload. The [artifact cleanup and initial workflow checks](evidence/native-debian/2026-09-15/actions-preparation/README.md)
record removal of 107 obsolete unexpired artifacts. Repository Actions and the
`COUCH_RELEASES_ENABLED` variable are enabled; a fresh hosted run still needs to
establish current capacity.

## Package and channel selection

`format=deb` is the workflow default. It publishes one file,
`Couch_<V>_amd64.deb`. Its detached signature remains in the private build output
and signed manifest. The upload passes that signature through CrabNebula's
supported `--signature` metadata, using public platform `deb-x86_64` and update
platform `linux-x86_64-deb`. Dependency material is inside the package. Users do
not download a setup archive or signature file.

Native Preview uses a final SemVer version such as `0.1.1` in channel `preview`.
Tauri's Debian bundler writes the version unchanged, and Debian orders
`0.1.1-preview.1` after `0.1.1`. Native publication therefore rejects prerelease
suffixes. Stable promotion copies the tested final-version Preview bytes and
signatures unchanged. Stable is CrabNebula's unnamed channel, with no `--channel`
argument. Each channel rejects a version equal to or below one already published.

`format=appimage` retains the existing six-file AppImage/setup/dependency-material
contract and `linux-x86_64-appimage` updater platform. Ordinary
`bun run package:build` and `bash scripts/hosted-build.sh` still default to
AppImage for the existing Mac path. Select `deb` explicitly for a native local
build. A native-only publication must separately check the existing AppImage
feed and retained download URLs before announcing a migration; mocked Cloud
responses do not establish provider behavior across formats.

Both public feeds use normal HTTPS redirects:

```text
https://cdn.crabnebula.app/update/avoid-quest/couch/linux-x86_64-deb/<current-version>
https://cdn.crabnebula.app/update/avoid-quest/couch/linux-x86_64-deb/<current-version>?channel=preview
```

Downloads and installed updates come from CrabNebula. The Mac can be offline.
The T480 only installs and runs packages.

## Gates and signing

The single release job requires committed `main`, `COUCH_RELEASES_ENABLED=true`,
and the existing main-only `couch-release` environment. Its `publish` input
defaults to false. One job avoids an artifact-storage handoff before publication;
there is no separate `couch-publication` job. The existing owner approval uses
the explicit dispatch input and main restriction, not a separate environment
reviewer.

`CN_API_KEY`, `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` remain environment secrets. The repository
variable `COUCH_UPDATER_PUBLIC_KEY` contains only the Tauri public-key wrapper.
The key and password remain in owner-held private configuration; the owner has
deferred the offline backup. No release secrets are passed to tests, fixture
containers, PR checks or dependency caches. The native package, `manifest.json`
and successful `qualified.json` are signed. The manifest identifies source,
original run/attempt, inventory hash, package size/hash and signature.

Qualification includes signature checks, typecheck, the isolated-clock Bun
suite, locked native tests and extraction of the signed internal release
metadata. Native builds then install the exact package in a fresh disposable
Debian container, launch through Tauri WebDriver, scan/play generated media,
relaunch its desktop entry, and check reinstall/removal data preservation.
[scripts/hosted-desktop.sh](../scripts/hosted-desktop.sh) runs that fixture on the
Docker host and stops it afterward. Software rendering, a null audio sink and
container instrumentation limit this proof; it is not hardware or installed
native-update acceptance. The integrated TV/update package must pass this
fixture again after those changes merge. AppImage builds retain the existing
installer fixture.

The Debian builder layers, Cargo dependencies and Bun downloads remain caches.
Cache misses build normally. No cache hit or hosted duration is claimed by local
act checks. The workflow has a 60-minute cap; observe the actual cold run before
changing that budget.

## Build and retry

A fresh build defaults to a Preview draft. Publication is explicit:

```sh
# Build, sign, qualify and upload a native Preview draft.
gh workflow run package.yml --repo avoid-quest/couch --ref main \
  -f format=deb -f channel=preview -f publish=false -f notes='Describe this release'

# Publish that completed draft using its signed receipts, without rebuilding.
gh workflow run package.yml --repo avoid-quest/couch --ref main \
  -f format=deb -f channel=preview -f build-run=RUN -f build-attempt=ATTEMPT \
  -f publish=true -f notes='Describe this release'

# Retry public verification after publication, without publishing again.
gh workflow run package.yml --repo avoid-quest/couch --ref main \
  -f format=deb -f channel=preview -f build-run=RUN -f build-attempt=ATTEMPT \
  -f readiness-only=true -f notes='Recheck publication'

# Promote a final-version Preview whose readiness receipt passed.
gh workflow run package.yml --repo avoid-quest/couch --ref main \
  -f format=deb -f channel=stable -f build-run=RUN -f build-attempt=ATTEMPT \
  -f publish=true -f notes='Promote the tested Preview'
```

Here `RUN` and `ATTEMPT` select `release-receipts-RUN.ATTEMPT`. The workflow
verifies both receipt signatures against the enrolled public key, checks the
complete qualification identity, and checks the original main Package dispatch
and source revision. A retry can use a receipt from a failed overall run if its
qualified upload completed. It never recompiles or resigns the candidate.

When artifact storage rejects even the small receipt, publication remains
independent of that failure. A bounded `COUCH_RELEASE_RECEIPTS=` JSON record in
the run log retains only the allowlisted manifests, signatures and provider
receipts. A retry first tries the artifact, then restores those same files using
`gh run view --attempt --log`; signatures and run provenance are verified before
use. No private key, provider token, inventory, source or app payload enters that
export. Retain the small receipts outside GitHub before their 90-day artifact or
run-log retention expires. These are verification records, not another binary
store.

A completed unpublished draft can be published using its signed qualification
and Cloud metadata, without downloading private draft bytes. Public Preview
promotion downloads the exact provider-issued `/asset/<ID>` URLs already
recorded by readiness, verifies every byte and signature, and uploads unchanged
files to Stable. It does not use a moving `latest` URL for restored bytes or
invent a version-specific CDN route.

Upload retries run at most three times while the signed bytes remain on the
same runner. If that runner disappears before a complete upload, its missing
private draft bytes cannot be recovered by the supported Cloud CLI. A retry
without the completed upload receipt stops. Use a retained local candidate or
build a new candidate under a new version. Never replace uploaded bytes under an
existing version; a fresh build refuses a nonempty draft. A completed publication
with delayed CDN readiness needs only another readiness run.

## Mac fallback

If Actions cannot build because capacity remains unavailable, use the existing
[isolated Mac Debian builder](packaging.md#isolated-mac-build) with the exact
committed source and same build inputs. Do not build on the T480. With the
owner's signing variables available only to signing commands, the core sequence
is:

```sh
# Inside the committed-source Debian builder.
bash scripts/hosted-build.sh deb
# In a fresh exec without private signing/provider variables.
COUCH_PACKAGE_FORMAT=deb bash scripts/hosted-qualify.sh

# On the Docker host, with the fixture run from that same source checkout.
mkdir -p .artifacts/native-qualification
bash scripts/hosted-desktop.sh BUILDER_CONTAINER .artifacts/native-qualification

# Inside the builder, only after both qualification steps pass.
bun scripts/hosted-release.ts qualify .artifacts/hosted-release
# Separate signing exec with the private signing variables available.
bun x --no-install tauri signer sign .artifacts/hosted-release/qualified.json
```

Retain that directory privately, then use the existing `draft`, `upload`,
`publish` and `readiness` operations in `scripts/hosted-release.ts`, with the
qualified directory, channel and recorded release ID. These commands work
without a GitHub build run. They upload only the selected public allowlist.
Keep the same version identity only when using the same retained bytes; a
fresh fallback build after a partial upload needs a new candidate identity.

## Download page

After public readiness, prepare the site from the retained full candidate or
signed receipt directory:

```sh
bun scripts/hosted-site.ts /absolute/qualified-receipts preview
bun run web:build
```

The command independently rechecks downloads and metadata before recording
`version`, `format`, `checkedAt`, the actual package URL and its size in
`apps/web/src/releases.json`. It refuses silent signing-key replacement.
The website can use that verified asset URL even after another release becomes
latest. Site deployment remains a separate action after the intended package
and install path are ready.

## Official references

- [CrabNebula Tauri workflow](https://docs.crabnebula.dev/cloud/ci/tauri-v2-workflow/)
  builds and uploads together; GitHub binary artifacts are not required.
- [Cloud upload](https://docs.crabnebula.dev/cloud/cli/upload-assets/) supplies
  file/signature/platform metadata. [Release metadata and downloads](https://docs.crabnebula.dev/cloud/cli/fetch-latest-release/)
  describe `release show` and public CDN endpoints. The checked CLI is 0.13.4,
  with no download, copy or promote command.
- [Tauri updater](https://v2.tauri.app/plugin/updater/) requires signatures.
  Native install elevation and migration belong to the native-update work,
  not to this publication script.
- [act limitations](https://nektosact.com/not_supported.html) include ignored
  concurrency, environments, permissions and timeouts. The local workflow
  fixtures prove control flow with inert actions, not hosted release execution.
