# Ubuntu package

Couch's production package supports Ubuntu 24.04 x86_64. Download the `.deb`
from an authenticated successful Package workflow artifact, verify its SHA-256
against the artifact's `SHA256SUMS`, then install it within an existing graphical
desktop:

```sh
sudo apt install ./Couch_0.1.0_amd64.deb
couch
```

Use the actual filename in the artifact. APT installs Couch's declared native
runtime dependencies, including libmpv, ffmpeg for ffprobe, and the VA-API driver
set. The drivers are required even with `--no-install-recommends`; installing
libmpv alone can leave Intel video decoding unavailable. Driver installation
does not prove that a particular codec or playback session uses hardware decoding.
The destination
does not need Bun, Node, npm, Rust, compilers, development headers or a source
checkout. The package does not configure login, autostart or audio services.
[Boot a fresh Ubuntu machine directly into Couch TV](https://github.com/avoid-quest/couch/issues/3)
owns that provisioning.

`/usr/bin/couch` owns the native window/player and starts one `/usr/bin/couch-server`
child. Keep supervision on `couch`; starting another server competes for the same
port and data. A failed coordinator causes the native owner to exit nonzero.
Normal shutdown first closes the coordinator and its database. The compiled
coordinator contains the real browser assets and serves the LAN remote on port
4100. Packaged yt-dlp and Deno live in Tauri's resource directory under
`/usr/lib/Couch/tools`. The host passes their absolute paths to its child.

The data default remains `$XDG_DATA_HOME/quest.avoid.couch`, or
`$HOME/.local/share/quest.avoid.couch` when XDG_DATA_HOME is unset. The native host
also honors `COUCH_DATA_DIR`. When adopting an existing installation, retain its
account, data directory and permissions. Set an absolute `COUCH_DATA_DIR` for a
previous custom directory, including a source-run `.data` directory. The package
has no maintainer script that moves, replaces or removes user data. Reinstall and
removal leave profiles, pairings, sources and media in that directory. An account
change requires an explicit data handoff by the appliance installer.

`couch --version` and `couch-server --version` emit the same JSON without starting
the GUI/server or writing data. Paired callers can GET `/api/build` with their
existing Bearer token. The result records application version, source revision,
dirty-source status, target, embedded Bun version and packaged helper versions
and hashes. The package also installs the identity and redistribution notices
under `/usr/share/doc/couch`. The build input inventory records lockfile hashes,
Rust/Bun versions, helper checksums and the resolved Ubuntu build packages.

## Build and qualify

The [Package workflow](../.github/workflows/package.yml) uses the pinned project
Tauri CLI through the official Tauri action. It builds Debian and AppImage on Ubuntu
24.04 x86_64. JavaScript and Rust dependencies stay locked; language tools,
helper archives, notice downloads, action revisions, the Ubuntu snapshot and
clean runtime image have explicit pins. Ubuntu's GitHub runner image metadata
and resolved build package inventory remain part of each run's evidence.

After ordinary checks, run Package manually on the intended revision. Before
the workflow lands on main, add the `qualify-package` label to the reviewed draft
PR. The workflow checks out that event's exact PR head. It never publishes a
release or uses signing credentials. Each artifact name includes that head.
After a new commit, remove and reapply the label to request fresh qualification.
A prior success does not qualify a changed head. Review `result.json`, the package
hash and embedded source revision before consuming the artifact.

The source archive shipped beside the package includes the modified native
dependencies and rebuild instructions. Keep it accessible to the package's
recipients with its notices. The private CI artifact is separate from the signed
LAN publication owned by
[Publish signed Couch releases on the home network](https://github.com/avoid-quest/couch/issues/5).

On a configured Ubuntu build machine, `bun run package:build` prepares the
verified helpers/notices and invokes the same locked Tauri build. Start with a
clean committed source tree. `tests/package/qualify.ts` accepts the emitted Debian
file and uses Docker plus the official tauri-driver 2.0.6 on the build machine.
The Bun test runner stays outside the destination container. Linux Docker host
networking connects that runner to tauri-driver's loopback-only listener. The
native proxy, native WebDriver and HTTP-browser WebDriver use separate ports.
Docker's init reaps exited children after WebDriver closes the native window;
the restart check still requires exactly one coordinator process.

The clean container first installs only the package's production closure through
APT, records it and checks for forbidden development commands/libraries. It then
adds Xvfb, Openbox, a silent PulseAudio sink and WebDriver as qualification
fixtures. It receives only the package, driver, generated media/data and test
launcher files. No application source or developer runtime is mounted.

Ubuntu's systemd dependency includes `systemd-dev`, which contains shared D-Bus
XML and pkg-config directory metadata. The fixture records and verifies that
its paths stay under `/usr/share`; this data-only package is the sole exception
to the `-dev` package-name check. `libsystemd-dev`, `libudev-dev` and other
development libraries remain forbidden.

An older Debian version of the same binary is the upgrade fixture because no
previous production release exists. The test adopts an existing profile,
authorized remote, library source and extra data file, upgrades to the exact
artifact, reinstalls it, and verifies hashes before launch. It then opens the
installed native UI, scans metadata with ffprobe, plays local and extracted
webpage media, executes Deno, pairs a real HTTP browser, and checks persistence
after restart. This tests package/data ownership across APT operations; it does
not claim compatibility with an unbuilt historical Couch release.

`result.json`, package/source hashes, production and test dependency inventories,
native linkage, build identities, screenshots and logs accompany the artifact.
Each local qualification attempt writes a new evidence directory, preserving
earlier logs without reusing readiness, failure or result markers.
The display smoke uses software rendering and silent audio. Physical video,
sound and boot-session results must be recorded separately on their owning
issues.

## AppImage qualification

The Package workflow also builds an AppImage from the same committed source and pinned helpers. Its separate `couch-appimage-RUN.ATTEMPT` artifact is uploaded only after the exact AppImage passes clean Ubuntu 24.04 qualification. It contains the AppImage, matching source/build identity, SHA-256 hashes and runtime evidence. Redistribution notices are inside `/usr/share/doc/couch` in the bundle.

Run `bun tests/package/qualify.ts path/to/Couch.AppImage` on an Ubuntu 24.04 x86_64 Docker host with Bun, ffmpeg and tauri-driver 2.0.6 installed. The runtime container has no development tools. The test uses AppImage's extract-and-run mode because Docker does not provide a FUSE mount. It checks the native host/sidecar identity, pinned helper discovery, existing library scan, native video/audio and subtitle pixels, real browser pairing and retained authorization/data after restart without autoplay.

The supported Ubuntu runtime supplies `libwebkit2gtk-4.1-0`, `libfuse2t64`, ffmpeg/ffprobe, GL and VA-API drivers, CA certificates and fonts. The qualification installs and records these explicit prerequisites before adding the browser driver, so its WebKit dependencies are not hidden test prerequisites. Normal `./Couch.AppImage` launch requires working FUSE; Docker qualification uses the documented `APPIMAGE_EXTRACT_AND_RUN=1` mode. Normal mounted launch remains an installed-system check. Xvfb, the browser driver and PulseAudio's null sink are test fixtures. Software rendering verifies bundle behavior, not T480 hardware decoding, audible output or physical subtitle geometry. Those remain installed-device acceptance requirements. Tauri's [AppImage guidance](https://v2.tauri.app/distribute/appimage/) describes the build-host compatibility boundary; this artifact targets Ubuntu 24.04.

This qualification increment does not enroll an update key or migrate an installed appliance. Keep the current Debian session and updater until signed AppImage updates, installed migration and operator SSH recovery qualify. Keep user data outside the bundle at the existing absolute `COUCH_DATA_DIR` with its current account and permissions.
