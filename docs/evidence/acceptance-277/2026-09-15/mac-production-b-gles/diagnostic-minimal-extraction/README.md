# Corrected B metadata extraction

The older diagnostic minimal clone verified the sealed `0.1.0` AppImage from revision `61739ad7ce782da5482067f16a5727306cd65d6a`. Its full SHA-256 matches the sealed manifest, Minisign verifies the decoded Tauri signature, and standard `--appimage-extract usr/lib/Couch/release.json` exits successfully. The extracted file matches the expected resource byte for byte and declares `libgles2` in `host.packages`.

The authoritative `summary.json` has SHA-256 `50e51725a71f1fa9e3045c6ac53bff0b5560b792e46cf54a61a48c427daeea93`. Raw verification and extraction logs, package manifests and the extracted resource are retained beside it. The old installed AppImage and package manifests stayed unchanged. No AppRun, installation, package operation or build ran on the diagnostic clone.

The guest shutdown command succeeded. `vm-shutdown-pending-state.txt` records UTM before shutdown finished; `vm-final-state.txt` records its eventual stopped state. The fresh minimal clone is separate and received no candidate files during this check. This metadata check does not establish GUI, playback or fresh-install acceptance.
