# Mac desktop package

The production Full DMG builds on GitHub's Apple Silicon `macos-26` runner in
[Package desktop Preview](../.github/workflows/package-desktop.yml). Its
updater key stays in the `couch-release` environment.

On an Apple Silicon Mac, use Bun 1.4.2 and the locked Rust toolchain. Supply a
disposable Tauri updater key pair as
`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` and
`COUCH_UPDATER_PUBLIC_KEY`, then run:

```sh
bun install --frozen-lockfile
bun run package:mac
```

The command requires a clean commit and Homebrew `mpv` and `ffmpeg`. It discovers
the installed libmpv, mpv executable and ffprobe library closure, then stages
those libraries, standalone yt-dlp and Deno, mpv, ffprobe, the Bun coordinator
and their notices. The
packaged `mac-native.json` records the installed formula versions, source and
bottle checksums, original binary hashes and signed bundle hashes. Downloaded
yt-dlp and Deno are pinned in `packaging/inputs.json`. Tauri copies the native
libraries into `Contents/Frameworks`, builds and ad-hoc signs the `.app`
and DMG, then signs `Couch.app.tar.gz` separately for the updater. The verifier
mounts the DMG, checks payload hashes, loader paths, architecture, helper
execution without Homebrew in `PATH`, notices and signatures, then compares
every app byte with the updater archive. Its receipt is
`.artifacts/mac-inventory.json`.

The default `desktop-playback` Cargo feature stays enabled. The same app can
host local playback or switch to Client-only mode. The bundled coordinator
retains Couch's `quest.avoid.couch` identity and app data location.

For local headless qualification, use a disposable Tauri updater key pair. The
enrolled private updater key remains in GitHub's `couch-release` environment;
the hosted Apple Silicon `macos-26` job builds the production package. The
updater feed target is `darwin-aarch64`, matching the desktop update adapter in
[#473](https://github.com/avoid-quest/couch/issues/473). Installed playback,
upgrade and recovery are manual checks after Preview under
[#489](https://github.com/avoid-quest/couch/issues/489) and
[#490](https://github.com/avoid-quest/couch/issues/490).

Ad-hoc signing does not notarize the app. A downloaded copy may need individual
approval in macOS Privacy & Security, and network access can prompt separately.
Record the actual prompts for each qualified artifact. Keep the installed app in
Applications and data in the unchanged `quest.avoid.couch` app data directory.
