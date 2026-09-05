# Linux native playback tests

Run `bun run test:linux` with Docker running. The first run downloads the Ubuntu24.04 toolchain and builds Rust dependencies. Later runs reuse named Docker volumes. The source tree is mounted read-only and copied inside the disposable container, so Linux builds cannot overwrite host binaries or lockfiles.

The tests launch the actual Tauri application through official `tauri-driver` and `WebKitWebDriver`, under Xvfb and Openbox. Bun sends W3C WebDriver requests directly, so there is no production automation plugin or application test endpoint. Two paired WebSocket clients and a separate WebKit HTTP browser check the same native player state. ffmpeg generates a 20-second clip with two audio tracks, subtitles and chapters, an MP3, and DASH fragments for an HTML5 media page resolved by the real yt-dlp executable.

The HTTP browser pairs through the real form and tests a 390px phone viewport, touch targets, keyboard controls, dialogs and reconnects. Fractional GTK scaling supplies that viewport despite MiniBrowser's minimum window width. Pointer actions use actual X11 input and assert the clicked DOM target. The TV tests check directional keys, visible focus, Escape and focus restoration, retained browsing state and a continuously mounted VideoStage. Both builds must emit the generated shadcn Mira theme, Inter font and Tailwind utilities.

The native window must retain X11 fullscreen state and fill its display at
startup, while browsing, during playback, after Stop and after restart. The HTTP
app must have no video surface. `tv-remote.ts` sends Home, Back, Info, directions
and OK through the actual phone buttons, including native transport, sliders and
Radix menus, while phone browsing remains independent. The test phone shares the
virtual X11 display, so focus/pixel checks foreground the TV and restore the phone
before further input. Physical phones do not take focus from the TV window.

Local progress checks cover observed stop/resume, Play from start, rewind, source replacement, loading and paused profile guards, actual EOF, watched actions and History. Two watching profiles retain separate records across desktop restart. The Jellyfin option also tests Continue watching and native resume through its real host progress reports. It temporarily allows the generated short clip to remain resumable, then restores the server's duration policy. The native mpv resume regression verifies that the next load clears the previous start offset.

External subtitle tests use the actual TV and HTTP phone file inputs, then
observe libmpv track selection. SRT/ASS on/off X11 comparisons require visible
subtitle glyphs and unchanged upper video pixels. Invalid/oversized uploads,
private file permissions, source cleanup and profile/device preferences are
checked too. Two profiles select different audio/subtitle defaults after a real
desktop restart. Jellyfin's movie fixture has an external Italian SRT sidecar.
The native `external_subtitles` regression additionally covers preload selection,
missing files, reset and the blocking HTTP probe that requires Bun prefetch.

Music fixtures live in `/music-fixtures`, separate from the existing video folder.
Tagged MP3, FLAC and M4A files verify the maintained parser in the compiled Bun
sidecar, compilation album artists, disc/track ordering and embedded artwork
decoded in both native and HTTP views. A single without an album remains reachable
from its artist. TV/phone tests cover album queue/play, saved playlist operations,
stale revisions, shared invalidation, keyboard focus and restart without autoplay.

Two adjacent FLAC files decode byte-for-byte to an unsplit nonperiodic PCM
reference. `music-audio.ts` captures the actual native PulseAudio monitor, aligns
reference samples on both sides of the transition, measures inserted silence and
retains conservative bounds for missing/repeated samples. WAV, fixture hashes,
observed playback IDs, waveform and JSON measurements accompany the run. These
software-output measurements do not qualify physical sound or gapless playback.

Artifacts go to `.artifacts/linux/`, including native screenshots, passed checks, toolchain versions, source and binary hashes, process RSS and debug binary sizes. Each run copies its compiled app and sidecar before launching, so another build cannot replace its executables. Screenshots hide the temporary pairing code. Pixel assertions check both the WebView and native video after seeking and resizing. The container uses Xvfb software rendering, the application's explicit `COUCH_BASIC_RENDERING=1` option, and a clocked PulseAudio null sink. That option sets mpv's `gpu-dumb-mode=yes`, disabling advanced scalers and custom shaders. Default mpv rendering produced black or corrupted frames even in standalone mpv on Ubuntu 24.04 and 26.04 in this Docker environment. The suite therefore qualifies the basic rendering path. It cannot qualify advanced GPU rendering, hardware decoding, physical audio output, HDMI behavior, HDR, CEC, or real Wi-Fi reliability. Debug binary sizes and software-renderer memory use are not release-build measurements.

To include a real disposable Jellyfin server with generated credentials and media:

```sh
bun run test:linux --jellyfin
```

That option starts the official Jellyfin 10.11.11 image on an isolated Docker network, configures movie and music libraries, and tests the native app's login, catalog, authenticated playback and playback reports. Cleanup removes the temporary server, network and credential file while retaining downloaded images and generated media. `--jellyfin-config path/to/fixture.json` can reuse an already running test fixture instead.

The default suite also imports a generated M3U playlist, checks its logos and groups, saves an imported favorite, refreshes its station list, and verifies restart persistence. It adds a local webpage through the native form with an empty title and a quality cap, verifies real yt-dlp title/artwork extraction and native DASH playback, then checks queue metadata and quality after restart. A second DASH fixture puts audio before blue 360p and red 720p video representations. Native form choices for Best, 480p and 720p must select the expected video for both remotes and paint its color across at least 98% of the sampled X11 pixels. Loading an ordinary multitrack file afterward must restore its tracks and video pixels. The suite also runs the native mpv DASH selection regression explicitly.

A saved YouTube card exercises native Online favorites, shared invalidation, removal, and restart without contacting YouTube. The Bun checks use real yt-dlp against local HTML/HLS fixtures to verify quality caps and audio-only fallback, and test verified media-tool installation and failed-update recovery.

Add `--live-radio` to test a real station discovered through Radio Browser, import radio.avoid.quest's ten-station collection, and play its Sygma station. Those optional checks depend on the public directories and stations being reachable. The image includes yt-dlp 2026.08.19 and Deno 2.9.6 for provider checks. The local HTML/DASH test does not qualify YouTube or other public extractors.

Run `bun run test:linux --providers tests/linux/providers.example.json` for separate YouTube, Twitch, RaiPlay and Sygma checks. You can supply another JSON array of `{ "name": "Public stream", "url": "https://example.com/video", "kind": "webpage", "video": true }`; use `"kind": "direct"` for a media URL and `"video": false` for audio-only streams. Optional `seekPosition` and `observeSeconds` control where playback is checked. Each case uses the native Add media form, two paired remotes, actual libmpv tracks and position, and an X11 screenshot. A failed provider does not prevent the remaining cases from running. Results are preserved by URL in `.artifacts/linux/providers/native-results.json`, with the test date, toolchain and binary hashes. Public streams can disappear or become unavailable after a successful test.

Run `bun run test:linux --provider-catalogs` to exercise the native Online panel against public catalogs. It searches YouTube for Big Buck Bunny and Twitch for LofiGirl, browses RaiPlay live channels and news program episodes, searches RaiNews24, and follows the recent replay date/channel cards. Each selected card must provide artwork, save to both remotes, and start native audio/video through Play on TV with a 720p cap. Queue metadata, quality, favorites and existing remote pairing must survive a desktop restart. Results and screenshots go to `.artifacts/linux/providers/`, including `catalog-persistence.json`. These opt-in checks can fail when public search rankings, catalogs, stream availability or regional access change. Use either `--providers` or `--provider-catalogs` in one run.

The image and build caches remain for later runs. `docker run --rm` removes the disposable test container. Nothing is published and no host ports are exposed.

Official references: [Tauri Linux prerequisites](https://v2.tauri.app/start/prerequisites/), [manual WebDriver setup](https://v2.tauri.app/develop/tests/webdriver/manual-setup/), [Tauri Selenium example and capabilities](https://v2.tauri.app/develop/tests/webdriver/example/selenium/).
