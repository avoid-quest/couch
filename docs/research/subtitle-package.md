# Packaged subtitle qualification

This is the execution companion to the [generated subtitle corpus](subtitles.md)
for [issue 33](https://github.com/avoid-quest/couch/issues/33). The optional
[controller](../../tests/package/subtitles.ts) drives the installed
`/usr/bin/couch` through the official Tauri WebDriver. Its media server and Bun
controller run outside the destination. They do not replace either packaged
executable.

## Retained package investigation, 2026-09-06

The first execution used the exact Debian artifact qualified by
[issue 2](https://github.com/avoid-quest/couch/issues/2#issuecomment-5555732529).
The three input MKVs were reused from the reviewed corpus. They were not
regenerated.

| Identity | Value |
| --- | --- |
| Application source | `24a958e9c15c0ddcc69ca2aee17528f1dbb50a13` |
| Debian SHA-256 | `603207c549cf7dbb3443f4dcd12b38e5a3719c947aeac615c02e2c16237b0104` |
| Installed native SHA-256 | `5fb70e2cd54f8f8a9a116eb238ad821274cc59c9a9f3016953def015ab57d785` |
| Installed coordinator SHA-256 | `0fc5438f891a0fecd68ae9c13be1570c11ab80fbbc9fd0a9b7eb810c1daf2cf3` |
| Runtime | Ubuntu 24.04 amd64, Docker Desktop Rosetta emulation |
| Native libraries | libmpv `0.37.0-1ubuntu4`, libass `1:0.17.1-2build1`, WebKitGTK `2.52.6-0ubuntu0.24.04.1` |
| Display | Xvfb 1600×1000, basic rendering, null audio sink |
| Input video | 640×360, displayed at 1600×900 with letterboxing |

The rendering portion passed all 18 paused-frame comparisons before its first
overall attempt failed in the controller fixture. ASS, PGS and VobSub appear at
4s and 10s, clear at 1s, 7s and 13s, and reappear after seeking backward to 4s.
Inspected ASS captures show the authored three-bar glyph, cyan text, outline and
italic styling, accented Latin, Greek, Cyrillic and joined Arabic without
missing-glyph boxes. Bitmap captures show the authored IMAGE 1 and IMAGE 2 masks
over the video background.

The corrected controller phase subsequently passed 45 checkpoints, including
actual TV/phone selection and Off, native dialog/listbox pixels, phone settings
at 320, 375, 390, 768, 1024, 1440 and 1920 CSS pixels, uploaded SRT/ASS pixels,
host-private files and snapshots, invalid/path/oversize rejection, and cleanup
on replacement. The profile phase passed 43 checkpoints, including two real
WebSocket remotes, native restart and the following observed selection policy.

| Saved choice for the text sample | Selected track |
| --- | --- |
| Automatic, no language | Default English styled ASS |
| Automatic, English | English styled ASS |
| Automatic, Italian | Italian forced ASS |
| Automatic, Russian | Russian SRT |
| Off, Italian | None, including the forced track |

A one-second delay moves the forced cue from 3s to 4s. Native samples at 3.5s
and 4.5s show its absence and presence. Loading the next item resets the delay.
Household's saved Off and the second profile's Italian Automatic preference
survive restarting the packaged native application. Existing paired controllers
reconnect, playback starts stopped, and the next load observes each profile's
own choice.

Specification review added two assertions. Automatic without a language must
select the English styled ASS by both language and label. Replacement must
restore the authored blue background, not merely remove track metadata. A
focused 19-check native replay found zero unexpected pixels after replacing
VobSub and again after the negative control. The control uploads and actually
renders `STALE SUBTITLE` over the same blue video. Its 14,568 unexpected pixels
make the same replacement assertion fail, as intended. The earlier results are
preserved; they did not contain this stronger replacement assertion.

These are exploratory results for the identified older package. They do not
qualify the later source tree. A complete run against the current-source
package remains required before issue 33 can close. No application defect has
been demonstrated in these exact samples so far.

## Replaying the focused check

Use a disposable Ubuntu 24.04 amd64 container with the exact `.deb` installed
through APT. Keep a new private data directory. Mount the checkout read-only at
`/qualification`, the generated corpus read-only at `/corpus`, and a writable
artifact directory at `/evidence`. Publish container ports 45300, 45344 and
45345 only on host loopback. The destination must resolve
`host.docker.internal` to the external controller's generated-media server.

Install these test fixtures separately from the recorded production package
closure: `xvfb xauth dbus-x11 openbox webkit2gtk-driver pulseaudio
libgl1-mesa-dri procps ffmpeg xdotool socat`. Put the official amd64
`tauri-driver` at `/evidence/tauri-driver`. The retained run uses version 2.0.6,
SHA-256 `d0cc923286cb8c662247b44aefafacad975169086c5f294d2c9156dbe6302620`.
Create the unprivileged `subtitle` user, give it the artifact directory, and
start the [display fixture](../../tests/package/subtitle-display.sh) with:

```sh
docker exec -d -u subtitle couch-wave-subtitle-package env \
  HOME=/home/subtitle COUCH_DATA_DIR=/home/subtitle/data \
  COUCH_HOST=0.0.0.0 COUCH_PORT=45300 DISPLAY=:99 GDK_BACKEND=x11 \
  LIBGL_ALWAYS_SOFTWARE=1 COUCH_BASIC_RENDERING=1 \
  WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1 \
  dbus-run-session -- bash /qualification/tests/package/subtitle-display.sh

SUBTITLE_CORPUS=/absolute/path/to/corpus \
SUBTITLE_EVIDENCE=/absolute/path/to/mounted/evidence \
  bun tests/package/subtitles.ts
```

`SUBTITLE_CONTAINER` overrides the disposable container name.
`SUBTITLE_PHASE=rendering`, `controls`, `profiles`, or `replacement` resumes a relevant subset
while keeping previous evidence; the default runs all phases. The full run
also checks the real HTTP phone's reconnection and displayed Off selection
after native restart. Each run records the actual package build identity,
installed executable hashes, library versions, input and helper hashes, screenshots and
pixel measurements. Test data and pairing credentials are private artifacts.

The runner requires a 1600×1000 display. Its native capture reads that complete
display, not a DOM screenshot. The phone uses a separate browser at fractional
GTK scale; its one CSS-pixel scroll-width tolerance matches the existing HTTP
helper. Portal assertions wait for opening animations before measuring paint.
The phone must minimize through WebDriver before native captures. Stop commands
must reach observed idle state before changing profiles.

The initial failed iterations remain in `.artifacts/subtitle-package/attempt-*`
alongside successful phase outputs. They exposed fixture startup, animation,
fractional-scale, window-minimization, upload-content-type, repeated-profile and
asynchronous Stop assumptions. No failed overall run is reported as a full
qualification pass.

## Limits

The claim covers these exact embedded ASS/font, SRT, PGS and VobSub samples.
External bitmap upload, external `.idx`/`.sub`, other font families/code points,
CJK/Indic/emoji, ASS animation/karaoke and complex positioning, multiple PGS
objects, cropping, split ODS, palette animation and disc playback remain
unqualified. The samples use a one-object bitmap and the retained font subset.
Pausing at authored cue intervals checks sampled timing, not frame-accurate
real-time subtitle latency. Software screenshots do not establish physical TV,
GPU, HDMI, sound or remote-control hardware behavior.
