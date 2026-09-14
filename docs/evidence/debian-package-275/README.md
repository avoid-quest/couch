# Debian package and installer checks

This records the isolated implementation checks for [#275](https://github.com/avoid-quest/couch/issues/275).
The candidate was built and signed locally. Nothing was published or deployed.
GitHub Actions remained disabled. Hosted releases belong to #276; the final
pristine Debian and Mac-offline update pass belongs to #277.
The implementation starts from `2218ff1bff640cf69180a4790fc10b026e82aefb`, which
contains the merged first-use PRs #272 and #273 and their fixes. No new sharing,
pairing or operating-mode UI was introduced.

## Candidate and build

[candidate.json](candidate.json) records the complete artifact sizes, SHA-256
hashes, detached signatures, disposable test-key identity and source revisions.
The AppImage is 289,053,176 bytes. Its SHA-256 is
`af82902680fb6e25e945f8ca05ac5a3b67877a1717945f29038dfc66999ed47a`.
Version `0.1.0` is an isolated packaging candidate, not a release in the new line.
The release ticket starts that line at `0.1.0-preview.1` and owns enrolled keys.

The app was built from clean commit
[`c02dc7f612914250bd967816f8d4c2fd0c163590`](https://github.com/avoid-quest/couch/commit/c02dc7f612914250bd967816f8d4c2fd0c163590).
Setup was built from
[`9836e302bc5b638d12fdf7e3f468c5d0725754c3`](https://github.com/avoid-quest/couch/commit/9836e302bc5b638d12fdf7e3f468c5d0725754c3).
Only `packaging/setup/files.json` and the setup README version substitution differ
between those trees. Application, backend, native, package-build and inventory
code are identical. The separate source identity preserves the exact qualified
app revision across the installer-layer rebase.

The build used the pinned Debian 13 amd64 container on the Mac, snapshot
`20260914T000000Z`, Bun 1.4.2 and Rust 1.98.1. Tauri is 2.11.5, its updater is
2.11.0, and CLI is 2.11.4. [build-packages.tsv](build-packages.tsv) records all 723
installed build packages, including development tools that are absent from the
target. The first container lacked `file`; it was installed from the pinned
snapshot and added to the Dockerfile before the successful build.

The build needed two supported-tool adaptations documented in
[packaging.md](../../packaging.md): run the verified output plugin's extracted
executable under Mac container emulation, and keep AppDir on a Linux filesystem.
No application runtime was replaced with a custom wrapper.

`bun run package:build` passed twice at the same app revision and
`SOURCE_DATE_EPOCH=1789415983`. The second run rebuilt the frontend, compiled Bun
sidecar and native app, then ran Tauri bundling and inventory checks. `cmp` found
the AppImages byte-identical. Dependency/compiler caches were retained; this
does not claim two builds from empty caches on different machines. Repacking the
same AppDir also produced identical bytes. Two runs of
`bun scripts/package-setup.ts 0.1.0 <output>` produced identical setup and material
archives. Real Minisign verified the three final detached Tauri signatures.

## Dependency ownership and versions

The compressed [AppImage inventory](appimage-inventory.json.gz) contains 2,004
file or link records and 499 ELF linkage checks. It records each file's final
hash, the selected inputs, dynamically loaded component families, and whether
each resolved library comes from Couch or Debian. No unexpected host-library
fallback passed the audit. This is a static closure check, not proof that every
GUI, codec or hardware path has executed.

| Bundled component | Actual version |
| --- | --- |
| yt-dlp with embedded Python/EJS | 2026.08.19 |
| Deno | 2.9.6 |
| ffprobe / FFmpeg | 7.1.5-0+deb13u1 / Debian package 7:7.1.5-0+deb13u1 |
| libmpv | 0.40.0-3+deb13u1 |
| GTK | 3.24.49-3 |
| WebKitGTK | 2.52.6-1~deb13u1 |
| GStreamer base/good | 1.26.2-1+deb13u2 |
| GStreamer libav | 1.26.2-1+deb13u1 |
| NSS | 2:3.110-1+deb13u4 |
| ALSA plugins | 1.2.12-2+b1 |

Couch owns the native app, both UIs, compiled backend, helpers and application
libraries inside the image. The closure includes WebKit subprocesses, GTK and
GdkPixbuf modules, GStreamer plugins/scanner, NSS softoken and ALSA plugins.
Debian owns glibc, kernel/device drivers, GL/EGL device support and the commands,
services and resources in [the setup manifest](../../../packaging/setup/files.json).
The build glibc baseline was `2.41-12+deb13u4`.

The installed AppImage reports type2-runtime commit `75849dc`, with a 944,632-byte
runtime prefix. The complete runtime input hash is in `candidate.json`. It
mounted through FUSE as the unprivileged runtime user with Debian `fuse3`
3.17.2-3, `libfuse2t64` 2.9.9-9 and an accessible `/dev/fuse`. These checks do not
claim those two packages are the runtime's only possible requirements; they
verify the agreed provisioned host configuration.

## Checks

| Check | Result |
| --- | --- |
| TypeScript typecheck | Passed |
| Full Bun suite | 1,224 passed, 9 skipped, 0 failed; 10,143 assertions across 129 files |
| Native protocol tests, release/locked build | 11 passed, 0 failed |
| Package build, bundled helper hashes and ELF closure | Passed |
| Complete package repeat and archive repeats | Byte-identical |
| Detached signature verification | AppImage, setup and distribution material passed |
| Installer/recovery fixture | Passed signature failure, unsupported OS/architecture, missing package/FUSE, ordinary login/audio preservation, TV conflict/setup/repeat, data preservation and incompatible retained-app rejection |
| LAN checks | Address selection, custom DNS validation, subnet admission and real loopback/LAN listener transitions passed |
| Archive allowlists | Setup has 34 entries; dependency material has 2,474. No absolute/traversal paths or archive links |

The installer fixture runs only in a disposable Debian Docker container. It uses
real Minisign, accounts and filesystem operations, with doubles for APT,
systemctl and successful FUSE access. Docker's device restriction means that
fixture cannot establish real FUSE mounting. The VM check below covers that part.

The public archive roots are explicit. Setup contains its installer, recovery
command, README, icon, host manifest and 11 selected TV files. Distribution
material contains the chosen dependency notices and approved extractor source.
Neither archive recursively exports the repository, evidence, private docs,
credentials, user data, backups or diagnostics. This preserves the owner's
simplified scope and adds no runtime companion or relinking pipeline.

## Debian diagnostic clone

The [retained UTM instructions](https://github.com/avoid-quest/couch/blob/7bcc7f7090948e0d355b6a4e02ee3b2d408de9a7/docs/evidence/fresh-install-debian-2026-09-14/utm/README.md)
were read before VM work. Only a new clone of the minimal pristine baseline was
started. Both pristine baselines and both original probes remained stopped.
This is an installer diagnostic, not a pristine-machine acceptance run.

The clone ran Debian 13.7 amd64 and kernel `6.12.107+deb13-amd64`. After the
documented distro-authenticated `minisign jq` bootstrap, the signed setup archive
was verified and extracted. Its unchanged installer installed the signed AppImage
with `--tv`. APT added 251 packages and changed no previously installed versions
after that bootstrap. [guest-added-packages.tsv](guest-added-packages.tsv) records
the exact additions. No target compiler, Bun, Rust, ffmpeg package or manually
prepared Couch library was needed.

The installed app SHA-256 matched the candidate. Its FUSE-mounted `--version`
reported the expected clean source identity. All three helper hashes matched.
From the mounted image, Deno evaluated `6 * 7` as `42`, yt-dlp returned
`2026.08.19`, and ffprobe read a generated one-second mono PCM WAV as 8,000 Hz,
one channel and `pcm_s16le`. None of `bun`, `cargo`, `rustc`, `gcc`, `g++`, `make`,
`ffprobe`, `ffmpeg`, `yt-dlp` or `deno` was available on the guest's PATH.

Repeat setup preserved a deliberate administrator edit to the session environment,
the installed app hash, a user-data sentinel, disabled LightDM and a
`multi-user.target` default. A final command-provider check identified `logger`
as belonging to `bsdutils`; the final manifest declares it explicitly. The
original and final setup identities are recorded separately in `candidate.json`.
The final archive passed signature verification and repeat setup in the same
clone, with all preservation checks still passing.

The diagnostic clone and build container are stopped and retained for inspection.
GUI launch, TV boot, native
playback, browser/remote behavior, loaded-library traces, physical hardware
requirements and signed A-to-B updates with the Mac offline remain #277 work.
No result here changes the failed fresh-install release-acceptance status.
