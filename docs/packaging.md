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
runtime dependencies, including libmpv and ffmpeg for ffprobe. The destination
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
`/usr/lib/couch/tools`. The host passes their absolute paths to its child.

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
Tauri CLI through the official Tauri action. It builds only Debian on Ubuntu
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
The Bun test runner stays outside the destination container.

The clean container first installs only the package's production closure through
APT, records it and checks for forbidden development commands/libraries. It then
adds Xvfb, Openbox, a silent PulseAudio sink and WebDriver as qualification
fixtures. It receives only the package, driver, generated media/data and test
launcher files. No application source or developer runtime is mounted.

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
The display smoke uses software rendering and silent audio. Physical video,
sound and boot-session results must be recorded separately on their owning
issues.
