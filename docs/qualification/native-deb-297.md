# Native Debian desktop qualification

This implements the desktop packaging slice in [#297](https://github.com/avoid-quest/couch/issues/297).
The application installs through APT from one native `.deb`, including its
desktop entry, backend, pinned helpers and dependency material. AppImage remains
the default build and published installation while update, TV and migration work
proceeds separately.

## Checked candidate

- Version `0.1.0`, private proof only. No public version bump or publication.
- Source `a6b34f25e0e988dd78d1b2e6b23d9026480db83c`.
- SHA-256 `25a250e13f00df906703929f209a5e6b0d507e986d23e81ee0c43e26d9ada945`.
- Built on the existing pinned Debian 13 amd64 Mac-hosted builder with Bun 1.4.2,
  Rust 1.98.1 and stock Tauri CLI 2.11.4 `--bundles deb`.
- Signed and verified using a disposable test key. No production signing
  credentials or provider credentials were used.

The [package summary](../evidence/native-deb-297/2026-09-15/package-summary.json)
records its size, inventory identity and exact builder/runtime images.

## Results

The [runtime result](../evidence/native-deb-297/2026-09-15/result.json) records ten
passed desktop checks. A fresh container from the pinned Debian 13 base installed
the actual `.deb` with `apt-get install --no-install-recommends`. It resolved all
five packaged executables' libraries before any test instrumentation was added.
The [production package list](../evidence/native-deb-297/2026-09-15/production-packages.tsv)
and [later test-tool list](../evidence/native-deb-297/2026-09-15/test-packages.tsv)
keep those two stages distinguishable.

Initial installation required no jq, Minisign, FUSE, system Bun/Node or compiler
commands. The bundled yt-dlp version check, Deno execution and ffprobe media
inspection passed. The installed main executable, sidecar and HTTP backend
reported matching build identities. The native owner supplied the real
`/usr/lib/Couch/tools` resource path.

The [first-launch screenshot](../evidence/native-deb-297/2026-09-15/first-launch.png)
shows the playback-device choice. The test chose this computer and kept sharing
private. Bundled ffprobe scanned a generated local video; native libmpv reported
both video and audio tracks with advancing playback. The
[X11 screenshot](../evidence/native-deb-297/2026-09-15/playing.png) shows actual
video output at two seconds. The installed desktop entry then relaunched Couch
through GTK's standard `gtk-launch` command.

APT reinstall retained a user-owned sentinel file. Removal deleted the packaged
executables, resources and desktop entry while retaining that file and Couch's
database. Installation created neither `couch-tv`, `/etc/couch`, nor the TV
service. There are no native maintainer hooks that change login/session policy.

Typecheck passed in the pinned builder. All 12 existing AppImage ELF-inventory
tests passed. No AppImage install, recovery, updater or TV files were changed.

## Package and privacy inspection

The [control and signature receipt](../evidence/native-deb-297/2026-09-15/package-control-and-signature.txt)
records package name, version, architecture, dependencies and verified test
signature. `Maintainer: avoid` comes from the public `quest.avoid.couch`
identifier, not Git author configuration. Tauri supplies the default extended
description; Couch supplies the short product description. No personal contact
address was invented or inferred.

All 1,443 regular payload files, 264,776,089 decoded bytes, passed the
[fresh content scan](../evidence/native-deb-297/2026-09-15/privacy.json). It found
no current Git author name/email, owner home path, private repository URL,
GitHub-token pattern, exact disposable signing-key bytes, `.env`, database,
browser-profile or source-map filenames. This is a bounded scan, not a claim
that unknown secret formats cannot exist. Dependency notices and approved
extractor source are intentional; compiled Bun application JavaScript remains
inspectable. The package contains no source checkout, compiler or build cache.

## Reproduce

Use the existing [isolated Mac builder procedure](../packaging.md#isolated-mac-build),
selecting `bun run package:build deb` and copying the `.deb` plus inventory from
the native paths. Keep the build on the container's Linux filesystem.

For the disposable desktop fixture, create separate `qualification` and
`evidence` directories. Into `qualification`, copy the built package as
`couch.deb`, `tests/package/debian-runtime.sh` as `runtime.sh`, the official
`tauri-driver` 2.0.6 binary and a generated 15-second H.264/AAC `sample.mp4`.
Build the test driver with `cargo install tauri-driver --version 2.0.6 --locked`
in the builder. It is never part of Couch's package or installation dependencies.

Start the pinned Debian runtime with `qualification` mounted read-only at
`/qualification`, `evidence` writable at `/evidence`, `COUCH_DEB_FIXTURE=1`,
and command `bash /qualification/runtime.sh`. Use a name beginning
`couch-native-deb-`, `--init`, `--platform linux/amd64`, 2 CPUs, 4 GiB memory and
1 GiB shared memory. No host networking, Docker socket or privileged mode is
needed. When `/evidence/ready` exists, run:

```sh
bun tests/package/debian-desktop.ts couch-native-deb-FIXTURE /absolute/evidence
```

The fixture removes Couch as its final check. Stop the disposable container after
retaining its evidence. Do not run this against the T480 or a user's installation.

## Limits and preserved failures

This proves a disposable X11 desktop using software rendering and a null audio
sink. The container instrumentation disables the WebKit sandbox. It does not
prove physical GPU acceleration, audible output, a booted graphical login,
native update elevation, TV operation or migration from an installed AppImage.
Those remain separate acceptance work.

The first candidate exposed two test-harness mistakes before its eventual pass:
root could not read the non-root sidecar's `/proc/.../environ`, and a retry's
`pgrep` included a defunct prior sidecar. The fixture now reads as the application
user and selects the newest sidecar. Neither repair changed application code or
the installed package. The final candidate above passed in a new runtime from
the original Debian base without fixture repairs.

Tauri writes Debian `Version` unchanged. A tested `dpkg --compare-versions`
check confirms `0.1.1-preview.1` sorts after `0.1.1`. Native releases therefore
use a final SemVer version in Preview and promote its unchanged bytes to Stable;
this slice does not introduce a custom version transform.
