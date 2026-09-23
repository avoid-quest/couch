# Linux AppImage media qualification

This covers [#495](https://github.com/avoid-quest/couch/issues/495). [PR #519](https://github.com/avoid-quest/couch/pull/519) merged the signed AppImage build and Client-only fixture. [#477](https://github.com/avoid-quest/couch/issues/477) remains open for installed and physical acceptance. Its completed package code is the base for the Full playback check here.

## Existing pieces and gap

- `src-tauri/tauri.package.conf.json` maps `libmpv.so.2`, selected NSS, ALSA and other libraries into the AppImage. Tauri's `bundleMediaFramework` also enables GStreamer resources for WebKit media. The package verifier now checks the player, decoder, subtitle and audio libraries, their portable ELF loader paths, and matching Debian notices.
- `scripts/package-prepare.ts` pins yt-dlp and Deno, copies Debian's `ffprobe`, records hashes and build package versions, and gathers notices. `src-tauri/src/lib.rs` passes Tauri resource paths to the Bun sidecar. The fresh runtime fixture executes each helper, checks `ffprobe` on generated local media and resolves the app and helper linkages before installing its browser driver.
- The AppImage desktop fixture first checks the trusted Client-only path, then switches the same package to This computer. It opens a generated local file through the native chooser, sends Play through the Bun session, captures X11 pixels and records PCM from the selected PulseAudio null sink. The fresh runtime fixture records loader resolution for packaged media libraries.

Tauri [documents](https://v2.tauri.app/distribute/appimage/) `bundleMediaFramework` as GStreamer packaging and says that flag is fully supported only on Ubuntu build systems. Couch builds on pinned Debian 13 and uses libmpv for native playback. Inspect the generated AppDir rather than treating that flag or a successful link as libmpv proof. AppImage's [linuxdeploy guide](https://docs.appimage.org/packaging-guide/from-source/linuxdeploy-user-guide.html) calls out libraries loaded with `dlopen()` as dependencies that automatic ELF scanning can miss. Its [best practices](https://docs.appimage.org/reference/best-practices.html) also require testing on intended base systems; the Debian 13 build may set a newer glibc floor than some broad-Linux targets.

## Evidence boundary

| Check | Evidence required for #495 |
| --- | --- |
| Artifact | The exact signed x86_64 AppImage needs its SHA-256, updater identity, release metadata, AppDir inventory, helper hashes, ELF dependencies and matching notices checked. Static linking alone does not prove playback. |
| Full playback | The disposable Debian 13 X11 fixture uses software rendering and a PulseAudio null sink. A recorded nonzero sink monitor proves audio reached that server, not a physical speaker. The X11 capture must show the generated red video, not merely a successful Play response. |
| Client-only | The same app must still pair to the selected host under its granted role; local media commands remain denied while in Client-only mode. |
| Host coverage | X11 needs a working X server, GTK/WebKit and GL/EGL driver; playback also needs a PulseAudio-compatible or ALSA output. Wayland needs a working compositor and the corresponding GTK/WebKit, EGL and audio paths. Wayland, physical graphics/audio and other distributions need separate installed runs before being claimed. |
| Regression | Debian native playback and Linux TV remain separate checks. Packaging changes require the prescribed `act` run on `catthehacker/ubuntu:full-latest` before hosted dispatch. |

The upstream [AppImage FUSE guide](https://docs.appimage.org/user-guide/troubleshooting/fuse.html) describes the FUSE 2 host requirement. Docker has no FUSE mount, so native x86_64 qualification launches the AppImage with extract-and-run. The Mac arm64 emulator cannot execute its x86_64 static PIE launcher; there the fixture extracts the verified SquashFS as its unprivileged user and runs the packaged `AppRun`. Neither route proves a normal mounted launch. The pinned Debian 13 builder sets this artifact's glibc floor. Older Linux systems need their own ABI and runtime result.
