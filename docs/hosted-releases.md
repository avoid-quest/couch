# Hosted releases

This implements [Deliver hosted Stable/Preview releases and Tauri updates](https://github.com/avoid-quest/couch/issues/276).
The [accepted policy](https://github.com/avoid-quest/couch/issues/266#issuecomment-5669079411)
owns release and update behavior. Actions is disabled. This configuration does not
authorize enabling it, publishing to CrabNebula, deploying the website or changing
any T480 installation.

## Build and delivery

The manual Package workflow uses the accepted Blacksmith 4 vCPU Ubuntu 24.04
runner to host the pinned Debian 13 builder from `packaging/Dockerfile.mac`.
Ubuntu does not build the package directly. Both hosted and temporary Mac builds
use `scripts/hosted-build.sh`, Tauri CLI 2.11.4 and the existing Debian packaging
and explicit distribution-material allowlists. Swatinem/rust-cache retains Cargo
dependencies and the Bun download cache even after qualification failure.

CrabNebula's supported action is pinned to
`1a8803698ba41de6b23e42abc5dcc3721308233c`. It downloads the current supported Cloud
CLI, so its `version` step records the actual version in each run. The retained
channel probe used cn 0.13.4. Check a changed CLI against the recorded draft,
show, list, upload and publish commands before authorizing a release run.
The action exposes no CLI-version input.

Tauri 2.11.5 and updater 2.11.0 use their standard greater-than comparison,
`check()`, verified `download()`, and `install(bytes)`. Couch reverifies the
retained bytes before installation. There is no POC metadata signature, expiry
renewal, build-number comparator or redirect override. Host/data requirements
live inside the signed AppImage at `usr/lib/Couch/release.json`; they are extracted
only after signature verification. The app checks Debian 13 amd64/X11, declared
host packages, FUSE access and compatible data before interruption.

The jobs run in order: draft, build/sign, qualify, explicit upload, protected
publication, public readiness. Publication defaults off. The source must be a
committed main revision. Fresh candidates start in Preview. Every signed asset,
size, SHA-256, source revision, public key and inventory hash is recorded in
`manifest.json`; hosted builds also record the original run and attempt.
Private GitHub artifacts expire after seven days. Retain qualified artifacts
outside Actions before expiry if a later retry or promotion will need them.

`qualified.json` requires signatures, typecheck, the Bun suite, native tests,
signed manifest extraction and the fresh disposable installer fixture. It does
not claim the pristine desktop/TV and signed A-to-B acceptance owned by
[the acceptance ticket](https://github.com/avoid-quest/couch/issues/277).

Only these files enter CrabNebula:

- `Couch_<V>_amd64.AppImage` and `.sig`
- `couch-setup-<V>.tar.gz` and `.sig`
- `couch-distribution-material-<V>.tar.gz` and `.sig`

The AppImage has public platform `appimage-x86_64` and update platform
`linux-x86_64-appimage`. Each archive also has its detached signature explicitly
uploaded as a public file. Source bundles, manifests, inventory, diagnostics,
qualification receipts, databases and signing material stay private. The workflow
uses explicit `cn release upload --file` calls because automatic Tauri directory
scanning cannot enforce the approved six-file set across these setup archives.
No asset is announced until all six downloads, the installer selector, Tauri
metadata and metadata-selected AppImage match the qualified identities.

Stable is the unnamed channel, with no `--channel` flag. Preview is `preview`.
The feeds are:

```text
https://cdn.crabnebula.app/update/avoid-quest/couch/linux-x86_64-appimage/<current-version>
https://cdn.crabnebula.app/update/avoid-quest/couch/linux-x86_64-appimage/<current-version>?channel=preview
```

Public files use
`https://cdn.crabnebula.app/download/avoid-quest/couch/latest/<filename>`, with
`?channel=preview` for Preview. The installer selector replaces `<filename>` with
`platform/appimage-x86_64`. Normal HTTPS redirects are supported. The Astro
`/download` page links directly to CrabNebula; it does not proxy app bytes.

## Owner setup before an authorized hosted run

The repository currently has no release secrets, release variables or configured
release environments. Prepare these in GitHub only when separately authorized:

1. Create `couch-release`, restricted to main, and `couch-publication`, restricted
   to main with required owner approval and prevention of self-review. Put
   `CN_API_KEY` in both environments. Put `TAURI_SIGNING_PRIVATE_KEY` and
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` only in `couch-release`. Keep the key and
   password in an owner-held offline backup. Both channels use the same key.
2. Set repository variable `COUCH_UPDATER_PUBLIC_KEY` to the Tauri public-key file
   contents, including its outer base64 wrapper. The builder embeds it in the app.
   Never put a private key in a variable, PR check, cache or artifact.
3. Review the pinned workflow and Cloud CLI output. Separately authorize enabling
   Actions and setting `COUCH_RELEASES_ENABLED=true`. A manual main dispatch is
   still required. No PR event receives release secrets.
4. Keep `publish=false` for a build/qualification/upload trial. Publication needs
   both an explicit request and protected-environment approval. The current task
   authorizes neither publication nor website deployment.

The initial version is `0.1.0-preview.1`. Bump `package.json`, the Tauri config,
Cargo package version and Cargo lock's Couch entry together in a reviewed commit.
`scripts/build.ts` embeds the same version/revision in native code, backend and
both frontend bundles. No CI build metadata is appended.

## Retry and promote the tested bytes

These are future owner-run dispatch examples, after the setup and authorization
above. `RUN` and `ATTEMPT` identify the original retained artifact. The workflow
checks both the artifact-producing run and its recorded original build against
main Package dispatches. It never relabels bytes with the new run's revision.

```sh
# Build, qualify and upload a Preview draft, without publishing.
gh workflow run package.yml --repo avoid-quest/couch --ref main \
  -f channel=preview -f publish=false -f notes='Describe this release'

# Retry qualification/upload, or request protected publication of the same draft.
gh workflow run package.yml --repo avoid-quest/couch --ref main \
  -f channel=preview -f build-run=RUN -f build-attempt=ATTEMPT \
  -f artifact-kind=hosted-release -f release-id=DRAFT_ID \
  -f publish=true -f notes='Describe this release'

# CDN delay after publication: verification only, with the same bytes.
gh workflow run package.yml --repo avoid-quest/couch --ref main \
  -f channel=preview -f build-run=RUN -f build-attempt=ATTEMPT \
  -f artifact-kind=hosted-release -f readiness-only=true \
  -f notes='Recheck the existing publication'
```

A candidate with a successful qualification receipt skips compilation and tests
on retry. Without that receipt the workflow checks out its original source,
restores caches and reruns qualification beside the retained AppImage. It does
not rebuild or resign the AppImage. A failed build without complete signed assets
needs a fresh build; incomplete bytes cannot be qualified.

To release Stable, first build and qualify the final `X.Y.Z` version in Preview.
Publish that Preview and pass readiness. Dispatch `channel=stable`,
`build-run=RUN`, `build-attempt=ATTEMPT`, `artifact-kind=hosted-ready`, using the
run that retained `readiness-preview.json`. Stable drafting rejects prereleases
and requires identical files/signatures/source to that receipt. A fresh Stable
build is refused. Changed bytes require a new version. Publication rejects a
version equal to or lower than an already published version in its channel.
Tauri independently rejects equal/lower offers and supports skipping releases.
Switching a newer Preview installation to Stable waits without downgrading.

After readiness passes, download `hosted-ready-RUN.ATTEMPT` and separately retain
`hosted-upload-*` and `hosted-publish-*` Cloud receipts. Prepare the site locally:

```sh
bun scripts/hosted-site.ts /absolute/hosted-ready-directory preview
bun run web:build
```

The command reverifies local signatures and current public endpoints, then writes
the enrolled `apps/web/public/couch-updater.pub` and the channel's version in
`apps/web/src/releases.json`. It refuses a silent key replacement. Review and
commit those files. Deployment to the authenticated `couch.avoid.quest` site is a
separate owner action. Until then the default page says no verified download is
available; no dummy production key or test release is advertised.

## Acceptance handoff

Use [Install Couch](install-couch.md) for the signed bootstrap, profiles, manual
and idle updates, and retained recovery. For each new acceptance run record the
source revision, manifest hash, all six asset hashes/signatures, Cloud release
and asset IDs, installer/updater URLs and final redirect URLs, installed paths,
public-key hash, running build identity and durable update request ID.

Before any VM diagnostics read the [retained UTM instructions](https://github.com/avoid-quest/couch/blob/7bcc7f7090948e0d355b6a4e02ee3b2d408de9a7/docs/evidence/fresh-install-debian-2026-09-14/utm/README.md).
Preserve the stopped baselines and existing installations. The acceptance owner
must run pristine minimal and Xfce Debian setup, freeze failures before repairs,
then qualify signed A-to-B updates with the Mac offline. Include both saved local
and remote modes, an unreachable remote, native desktop relaunch, TV supervision,
manual/Administrator/Controller permissions, idle deferral, failed startup and
retained compatible recovery after newer writes. No repaired run passes a
pristine gate. Existing POC evidence is historical; no POC migration or LAN TLS
work is required.

## References and deliberate adaptations

- [CrabNebula Tauri workflow](https://docs.crabnebula.dev/cloud/ci/tauri-v2-workflow/)
  supplies the draft/upload/publish sequence and supported action/CLI.
- [Tauri updater](https://v2.tauri.app/plugin/updater/) supplies signatures,
  standard ordering and update APIs. The pinned Rust source confirms
  `download()` verifies signatures while `install(bytes)` needs caller rechecking.
- Tauri 2.11.5's `request_restart()` cannot be delayed by `prevent_exit()`.
  Desktop Couch therefore drains its backend before requesting native restart.
  TV Couch retains its existing supervisor and clean-exit restart policy.
- Remote mode reuses the compiled backend's existing update handlers on a private,
  authenticated loopback listener. It starts no local catalog, recording scheduler,
  playback or sharing. Its startup trial checks the app's own frontend/native
  identity, database integrity and bundled tools without contacting the remote.
- The app reuses shadcn Dialog and Button for its own remote-mode update control.
  The Astro download page uses existing theme tokens and native document links;
  it needs no interactive component or new UI library.
