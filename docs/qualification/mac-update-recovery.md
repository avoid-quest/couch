# Mac update recovery, 26 September 2026

The installed `0.2.0-preview.13` at revision
`b71116ce0074e5b065198016569adb86b5a036a3` was a local build enrolled with updater
key `1ECDBDFFF8A69D37`. The published preview.13 installer at revision
`703010ca0a6c4523233bf8b55f374dbb5152ead4` embeds production key
`276CD26B404AC064`. They are different applications despite the same version.

The preview.15 Mac archive fetched from the live CrabNebula feed failed
`minisign -Vm` with the installed key and passed with the repository's
`apps/web/public/couch-updater.pub`. This reproduces the UI's native error:
“The signature was created with a different key than the one provided”.
Verification correctly prevented replacement. Repeated Download clicks cannot
repair an installation enrolled with another key.

After backing up the installed app and data, reinstalling the published
preview.13 app preserved the data and allowed the UI to download, verify and
install published preview.15 (`822f8f4fee252240739d89c38af720c36b7eecbd`). No
release, signing-key change, or hosted workflow was performed.

That installed journey exposed two further failures:

- The local-player trial always reported `operator-required` on Mac because
  `Player::readiness` only supported Linux. Windows shared that unsupported
  branch. The fix probes libmpv on the existing desktop worker within the
  request deadline, without loading media or opening output devices. Linux
  retains its existing renderer check. This probe is not a hardware playback
  or GPU qualification.
- Both update restart and ordinary Settings → General → Restart could leave
  a blank native window despite a connected frontend. window-vibrancy 0.8
  places the WebView in an arbitrary glass subview. Explicitly assigning
  AppKit's `contentView` keeps it above the effect. This small adaptation is
  required by a demonstrated gap in the existing library; it preserves Couch's
  glass and native playback view hierarchy.

An isolated local app with its own bundle ID, WebView storage and copied data
replayed the failed startup trial. With the changes it reached `succeeded`,
rendered Home and retained the copied data after the UI Restart action. This
was an ad-hoc local debug build using the production public key, not a signed
new release or a Windows installed-update qualification. The test did not
publish an update feed or bypass signature verification.

The Updates page reuses Couch's existing shadcn Alert above release notes and
explains reinstall recovery on the correct device. A key mismatch disables the
futile Download retry; Check for updates remains available to discover a
repaired feed. Component regressions cover this state, remote-host guidance,
ordinary download retry and installation of a verified download.

References: [Tauri updater signature requirements](https://v2.tauri.app/plugin/updater/),
[AppKit's contentView contract](https://developer.apple.com/documentation/appkit/nsglasseffectview/contentview),
[shadcn Alert](https://ui.shadcn.com/docs/components/alert).
