# Mac Client-only package

On an Apple Silicon Mac, use Bun 1.4.2 and the locked Rust toolchain. Supply the
same enrolled Tauri updater key pair used by Couch's existing release process as
`TAURI_SIGNING_PRIVATE_KEY` and `COUCH_UPDATER_PUBLIC_KEY`, then run:

```sh
bun install --frozen-lockfile
bun run package:mac
```

The command requires a clean commit. It stages the Apple Silicon build inputs,
Bun and production dependency notices, then uses Tauri to build and ad-hoc sign
the `.app` and DMG. Tauri also signs `Couch.app.tar.gz` independently for its
updater. The verifier mounts the DMG, checks the installed payload hashes,
architecture, system-library closure, notices and app signature, then verifies
the updater archive and its Tauri signature. Its receipt is
`.artifacts/mac-inventory.json`. Keep the DMG and updater archive private until
the installed acceptance and publication work is authorized.

The client connects to another Couch through that host's served UI. Its bundled
coordinator provides private maintenance and recovery; this package carries no
libmpv, `ffprobe`, `yt-dlp` or Deno and has no local playback claim. The updater
feed target is `darwin-aarch64`, matching the desktop update adapter in
[#473](https://github.com/avoid-quest/couch/issues/473). Installed upgrade and
recovery qualification belongs to the [Mac acceptance ticket](https://github.com/avoid-quest/couch/issues/490).

Ad-hoc signing does not notarize the app. A downloaded copy may need individual
approval in macOS Privacy & Security, and network access can prompt separately.
Record the actual prompts for each qualified artifact. Keep the installed app in
Applications and data in the unchanged `quest.avoid.couch` app data directory.
