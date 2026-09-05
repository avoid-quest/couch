# Integrated playback and transcoding

Checked 2026-09-05 against primary documentation and source. The [implementation](../../README.md) passes embedded playback and two-controller tests on Ubuntu 24.04 under Xvfb, including paused seek and fullscreen pixel checks. The lab explicitly enables `COUCH_BASIC_RENDERING=1`, which selects mpv's basic GPU path. Default rendering also failed in standalone mpv in this Docker environment. The tests therefore do not qualify the advanced renderer, physical GPU, HDMI audio, HDR or Wayland behavior. The target is one integrated TV application with shared LAN controls. Future synchronized speakers do not determine v1's engine.

A polished UI does not require video transcoding. Every player decodes compressed video into frames. Our application can render those frames inside its own window and draw controls above them. Transcoding additionally encodes a new compressed video stream. The second operation is unnecessary merely to draw a seekbar, animated menu, subtitle, library overlay or program guide.

There is an established implementation to study. Jellyfin Desktop uses Qt WebEngine and libmpv. At the inspected commit, its QML places a native `MpvVideoItem` below a transparent web view in the same window. The native video item selects libmpv output. This proves the integrated rendering pattern; it does not certify our future Rust implementation or its HDR behavior. [Jellyfin Desktop](https://github.com/jellyfin/jellyfin-desktop/blob/2cb4a4456fd29b5b62d825ef0e5df93ed6913328/README.md), [same-window composition](https://github.com/jellyfin/jellyfin-desktop/blob/2cb4a4456fd29b5b62d825ef0e5df93ed6913328/src/ui/webview.qml#L206-L236)

## Playback engine

My preferred engine for this scope is libmpv. It supplies mature demuxing, decoding, track/subtitle handling, seeking, chapters, filtering, audio output and player observations. The application still owns its library, providers, queue, TV interface and shared state. GStreamer is the serious alternative if a custom media graph, recording pipeline or particular Linux display path provides a demonstrated advantage. These are engineering judgments, not measured speed rankings.

| Engine | Advantage for this product | Work or limitation |
| --- | --- | --- |
| libmpv | Broad native playback and ready-made player behavior | Native rendering bridge; no automatic Kodi add-on/CDM support; embedded display path must be tested |
| GStreamer | Explicit routing, recording branches, buffering, clocks and Rust bindings; `playbin3` already supplies ordinary playback | More playback policy and pipeline integration; plugin/output qualification |
| libVLC | Mature embeddable engine | Its memory callback route has documented hardware/copying costs; no demonstrated simpler Linux web-UI bridge |
| Kodi core retained | Highest existing playback, PVR and add-on coverage | C++/Python host and Kodi's existing application contracts |
| New engine over FFmpeg alone | Full control over demuxing/decoding | We would rebuild clocks, track switching, seeking, subtitle/output behavior and much of a player |

GStreamer's `playbin3` supports automatic decoder selection, stream selection, subtitles, network buffering and gapless transitions. libVLC's upstream header warns that its video-memory callbacks can disable hardware acceleration or incur copies. Kodi's player depends on application, GUI, settings and rendering code, so extracting a small standalone library is substantial work. [GStreamer playbin3](https://gstreamer.freedesktop.org/documentation/playback/playbin3.html), [libVLC callback contract](https://github.com/videolan/vlc/blob/master/include/vlc/libvlc_media_player.h), [Kodi VideoPlayer](https://github.com/xbmc/xbmc/blob/master/xbmc/cores/VideoPlayer/VideoPlayer.cpp)

## Owning the rendering integration

libmpv's render interface accepts an application-owned OpenGL context and framebuffer. A native render callback schedules work on the appropriate graphics thread; the host renders when a frame is ready and composites the UI. TypeScript receives commands and observations, not full video frames. Correct native display resources matter for hardware interoperability. A GPU render pass or GPU-to-GPU copy is not video transcoding, but avoid claiming zero-copy behavior without measurement. [Render and threading contract](https://github.com/mpv-player/mpv/blob/f5bcfb195412e0ca733eac2e850879cd3b1ded18/include/mpv/render.h#L24-L79), [OpenGL hardware interoperation](https://github.com/mpv-player/mpv/blob/f5bcfb195412e0ca733eac2e850879cd3b1ded18/include/mpv/render_gl.h#L69-L100)

| Shell/rendering route | Concrete mechanism | Decision |
| --- | --- | --- |
| Rust + Tauri + TypeScript UI | Native GTK video widget under a transparent WebKitGTK layer, inside one application window | Chosen shell direction; qualify and reuse native integration before writing a bridge |
| Qt Quick/WebEngine + libmpv | Framebuffer-backed native video below web content in a Qt scene | Established comparison implementation; brings Qt/C++ and its packaging |
| Rust + Slint + libmpv | Borrow an OpenGL texture and draw native controls over it | Viable native UI, with less shared TV/web-remote UI code; does not by itself solve HDR |
| Rust + GTK4 + GStreamer | Render a native paintable using GL or DMA-BUF in GTK UI | Serious Linux display alternative; replaces the web TV UI and increases player integration |
| Rust + CEF + native mpv output | Application-managed platform surfaces with browser UI above native video | Potentially preserves a different mpv display path; substantial platform integration |
| Electron + native GPU bridge | Import native shared GPU textures into the renderer | Current experimental APIs make this possible; still custom graphics integration and a Chromium/Node distribution |

The implementation reuses the community `get-air/tauri-video-plugin`, which supplies the GTK overlay and libmpv render integration. Its default engine is GStreamer; our build selects mpv explicitly. Small [documented native patches](../../src-tauri/vendor/README.md) expose Rust control, add necessary playback observations and fix the released runtime's GTK ancestry assumption. The upstream controller supplies ordinary transport, tracks, request headers and observations, but not playback-rate changes or frame-accurate seeking. Engine capability and adapter exposure are separate. [Linux implementation](https://github.com/get-air/tauri-video-plugin/blob/6baf19ff74bfe5278838f05d9eaa4af55ecc4d05/docs/linux.md), [controller support](https://github.com/get-air/tauri-video-plugin/blob/6baf19ff74bfe5278838f05d9eaa4af55ecc4d05/README.md)

The release state matters. The inspected published plugin is **0.3.0**, while main's examples advertise unpublished **0.4.0**. The plugin depends on `libmpv2 ^5.0.3`; the bindings' separate latest major is 6.0.0. Use a coherent released package set or an explicitly pinned source build for qualification, rather than combining independently latest packages. The GTK ancestry fix in Tauri PR 15701 had not reached the latest published `tauri-runtime-wry` 2.11.4 at inspection. Verify the actual runtime contains it; the top-level Tauri version is insufficient. [Published plugin](https://crates.io/crates/tauri-plugin-video/0.3.0), [released manifest](https://github.com/get-air/tauri-video-plugin/blob/6e9bb47934eb82a420d85ebfe9258996d1b4507e/Cargo.toml), [libmpv2](https://crates.io/crates/libmpv2/6.0.0), [Tauri fix](https://github.com/tauri-apps/tauri/pull/15701)

There is one concrete API gap for our ownership model: the plugin's native open/control methods are crate-private and its intended driver is JavaScript in the webview. Independent coordinator-to-Rust control therefore needs a small public API extension or our own narrow adapter. This keeps native playback recoverable when the TV webview reloads. Reuse the plugin where practical; fall back to direct `libmpv2` bindings if adaptation becomes larger than the required bridge. Other similarly named nini22P mpv plugins explicitly report broken Linux embedding. [Released commands](https://github.com/get-air/tauri-video-plugin/blob/6e9bb47934eb82a420d85ebfe9258996d1b4507e/src/commands.rs), [libmpv2](https://github.com/kohsine/libmpv2-rs), [other plugin platform limits](https://github.com/nini22P/tauri-plugin-libmpv#platform-support)

These findings qualify a reuse path, not working HDR, DRM or Linux device support in our app. Slint's borrowed OpenGL textures and Electron's experimental shared textures remain alternative mechanisms if a measured requirement defeats the preferred route. [Slint texture interface](https://docs.slint.dev/latest/docs/rust/slint/struct.BorrowedOpenGLTextureBuilder), [Electron shared textures](https://www.electronjs.org/docs/latest/api/shared-texture)

HDR is the main display qualification. Upstream libmpv's render interface provides OpenGL/software output, and mpv's automatic target-colorspace negotiation requires its `gpu-next` path. A basic embedded framebuffer therefore cannot inherit every standalone mpv output feature. A native UI framework alone does not fix this. GStreamer's GTK4 sink supports DMA-BUF imports with suitable GTK/build versions, and recent GStreamer releases include HDR/color improvements worth testing. [mpv output controls](https://mpv.io/manual/stable/#options-target-colorspace-hint), [GTK4 sink](https://gstreamer.freedesktop.org/documentation/gtk4/index.html), [GStreamer 1.28](https://gstreamer.freedesktop.org/releases/1.28/)

Jellium shows another route, a Rust/CEF client that integrates mpv's native Linux output through a Wayland protocol proxy. Its code also depends on an mpv fork. That makes it a useful reference for the cost of native surface integration, not evidence that preserving native output is a one-line shell option. [Wayland implementation](https://github.com/andrewrabert/jellium-desktop/blob/28f2cf16a1f1b819884dd6a72919ca55bdf9bd73/src/wayland/src/mpv_proxy/mod.rs), [native dependency](https://github.com/andrewrabert/jellium-desktop/blob/28f2cf16a1f1b819884dd6a72919ca55bdf9bd73/.gitmodules)

## What avoiding video transcoding buys and costs

| Operation | What changes | Typical reason |
| --- | --- | --- |
| Direct play | Original compressed media | The receiver accepts the source |
| Remux | Container/packaging, with compressed streams copied | Supported codecs in an unsupported container |
| Audio conversion | Audio format, channels or rate; video can remain unchanged | Audio compatibility or processing |
| Video transcoding | Decode frames and encode a new compressed video | Unsupported video, constrained bandwidth, or required server-side pixel processing |

FFmpeg streamcopy performs no decode/encode and introduces no encoding generation loss. Remuxing still requires a container that can carry the streams. Jellyfin documents these playback modes separately. [FFmpeg streamcopy](https://ffmpeg.org/ffmpeg.html#Streamcopy), [Jellyfin modes](https://jellyfin.org/docs/general/post-install/transcoding/)

Avoiding video transcoding preserves the original encoded picture, removes an encoder workload and its intermediate storage/buffering, and can preserve HDR information that a conversion might discard. It is particularly sensible when the mini PC can already play the original file. It does not guarantee the final display is correct; color conversion, tone mapping and output settings still matter.

The cost is requiring a capable decoder and enough bandwidth at the receiving player. A permanent ban would make future weak playback clients, unsupported formats and constrained connections fail. Phones used only as remotes do not need video compatibility and create no reason to transcode. A later phone playback mode would be a different receiver capability.

Use direct play by default and select the least expensive operation that addresses a diagnosed incompatibility. Prefer a suitable existing source rendition before generating one. Remux for a container issue, convert only audio for an audio issue, and encode video only when video conversion is needed. Authentication expiry and DRM errors must return to the provider module, not trigger an encoder. Let Jellyfin handle its own negotiated conversion rather than transcoding its output again.

Hardware acceleration can make fallback practical, but decoding, filtering and encoding have separate requirements. Record the actual pipeline and limit concurrent jobs. Cancelling playback must cancel its conversion job and clean temporary output. No throughput or power claim is justified until the GPU, drivers, media and filters are tested. [Hardware acceleration pipeline](https://jellyfin.org/docs/general/post-install/transcoding/hardware-acceleration/)

## UI and playback features that preserve original video

The app loads external SRT/ASS/SSA/WebVTT through libmpv's `sub-add` command.
The native `on_preloaded` hook adds Jellyfin sidecars before track selection,
alongside the existing DASH selection hook. Each load clears external tracks and
resets language policy, speed, audio delay and the per-item subtitle offset.
Implicit filesystem subtitle discovery is disabled; files come from the explicit
TV/remote chooser or the host's Jellyfin session.

A Linux probe measured synchronous `sub-add` blocking for 1,015 ms when an HTTP
subtitle response was delayed 1,000 ms. Bun therefore downloads provider subtitles
before loading native playback. Downloads are cancellable, limited to four at a
time, twenty files, 2 MiB each and eight seconds total. Native subtitle failures
are separate from media playback errors. Profile/device ownership and the upload
lifetime are documented in [README](../../README.md).

Local subtitle composition, deinterlacing and HDR-to-SDR tone mapping operate on frames already decoded for display. They do not require creating another compressed video. If an incapable client needs subtitles burned into a server-produced video, then that output does require re-encoding. ASS and image subtitles should render natively for Kodi parity. [mpv manual](https://mpv.io/manual/stable/), [subtitle compatibility](https://jellyfin.org/docs/general/clients/codec-support/#subtitle-compatibility)

Preview thumbnails are separate image-generation jobs. Decode selected frames, scale and cache small images while the main movie direct-plays. Accurate seeking can seek to an earlier keyframe and decode forward. Live rewind depends on an available recording or segment window. [FFmpeg thumbnail filter](https://ffmpeg.org/ffmpeg-filters.html#thumbnail), [mpv precise seeking](https://mpv.io/manual/stable/#options-hr-seek)

Transcoding is not automatically a latency improvement. Source keyframes, indexes and buffers affect startup and seeking. Re-encoding can control keyframe intervals, but adds processing. HLS delivery itself does not imply video re-encoding; a compatible input can be segmented through streamcopy, subject to keyframe constraints. [FFmpeg HLS muxer](https://ffmpeg.org/ffmpeg-formats.html#hls-2)

A whole webpage or screen-share feed is different. Capturing rendered pixels and transporting them normally needs a capture/encode path. That does not apply to drawing our own UI around a media player. Shared remote app state uses messages and requires no media conversion.

## Radio reliability evidence

The isolated 2026-09-05 Linux build passed 60 recorded native/remote checks for
radio, plus direct request-count and UI assertions. Paced MP3 fixtures supplied
changing ICY titles and an actual ID3 artist tag. Two WebSocket controllers and
the 390px HTTP browser observed the same track while the station name stayed
stable. Untagged radio and ordinary video cleared previous track metadata.

HTTP 503 recovery made exactly two requests. Repeated failure made exactly four,
with 1, 2 and 4-second reconnect delays, then stopped until the phone selected
Try again. Clean EOF, connection loss and an eight-second stalled-read timeout
entered the same bounded policy without advancing the queue. Phone Stop,
replacement and desktop shutdown prevented requests after the canceled deadline.
Restart retained the radio queue entry without playback or a pending retry.
A separate 12-check public run covered Radio Paradise and the required avoid
feed, including Sygma playback and all ten station records across restart.

The first run exposed mpv's built-in ytdl fallback making an extra HTTP request
after a 503. Native initialization now sets `ytdl=no`; Bun's bounded worker owns
webpage extraction. Radio loads also disable FFmpeg reconnect options and use
`network-timeout=8`; ordinary sources restore the initial network options.
[mpv ytdl option](https://mpv.io/manual/stable/#options-ytdl),
[network options](https://mpv.io/manual/stable/#options-network-timeout).

Artifacts are under `.artifacts/radio-isolated/`, including failures before the
fix, dated request logs, observations, screenshots and immutable binaries.
The app SHA-256 is
`d38605635c14be47313b69facb2598c7ae66669c6667695106d89c1b170eefcb`;
the Bun sidecar SHA-256 is
`ebc6b06f553d247bed31e18372ffd8d7b3e24c5a72fddd691e8b9dff22265b7e`.
These builds precede the TV/remote redesign and do not qualify its appearance.
The tests use software rendering and silent PulseAudio output; physical sound,
network interruptions and long station outages need hardware evidence.

## Hardware and UX acceptance

The first experiment must already render video and our controls in one window. Test the following in the embedded application, not only in standalone mpv:

- H.264/MP4, HEVC/MKV and AV1 samples supported by the intended hardware; high bitrate and long-running playback.
- ASS with fonts, SRT, PGS/VobSub, forced subtitles, alternate audio, chapters and remembered track preferences.
- Actual hardware decoding, frame drops, CPU readback, correct SDR colors and HDR output or explicit tone mapping.
- HDMI audio output, multichannel PCM, passthrough where supported, A/V alignment, output switching and TV wake/reconnect.
- Accurate seek, interlaced live TV, gapless music boundaries, ReplayGain and clean audio transitions.
- A library/EPG overlay while video plays, directional focus, resizing, fullscreen, stop, failure recovery and two LAN remotes.

Display refresh switching is platform work and can briefly blank the TV. Encoded audio passthrough limits mixing and software volume; Kodi also disables passthrough when its display-sync mode needs to alter audio timing. Preserve these distinctions in capabilities. [Kodi video settings](https://kodi.wiki/view/Settings/Player/Videos), [Kodi audio settings](https://kodi.wiki/view/Settings/System/Audio)

libmpv already provides gapless-audio modes and ReplayGain settings. Keep a single application queue authority, but prepare the next item and let the engine perform consecutive playback without tearing down its audio output. The manual warns that slow next-file opening can still exhaust its buffer. Test continuous local/NAS/Jellyfin albums and authenticated source transitions. Crossfade is a separate capability; neither gapless mode nor two adjacent URLs proves crossfade support. [Gapless behavior](https://mpv.io/manual/stable/#options-gapless-audio), [ReplayGain](https://mpv.io/manual/stable/#options-replaygain)

The 2026-09-05 18:36 UTC native queue capture does **not** qualify gapless playback. Two
adjacent FLAC files decode exactly to a continuous 44.1 kHz PCM reference.
PulseAudio output contained 12,036 silent samples at the join (272.9 ms).
Aligned content on either side showed 1,743 net inserted samples (39.5 ms),
with 10,293 reference edge samples unmatched. Conservative whole-recording
loss/repetition bounds were 0–12,085 and 0–1,792 samples; they include initial
output startup and correlation-window uncertainty. Four anchors matched exactly
with no within-track offset drift. The app still stops and loads the next item
after observed EOF; preloading and output continuity remain implementation work.
Artifacts: `.artifacts/linux/music-audio-transition.json`,
`music-native-transition.wav`, `music-reference.wav`, fixture hashes and waveform.
This is software PulseAudio output, not physical HDMI/audio evidence.

Qualify Tauri's integrated renderer first. A failed HDR path calls for a renderer decision; it does not automatically justify transcoding every video. [Provider/CDM choices](providers.md) are a separate gate. Linux packaging must include and test the selected media dependencies against a defined base distribution, WebKitGTK and GPU stack. Tauri's bundling features do not certify an arbitrary libmpv dependency tree. [AppImage guidance](https://v2.tauri.app/distribute/appimage/)

## Future speaker-only groups

Keep output identity separate from controller identity. A later music output module can decode audio once and distribute timestamped PCM or a supported compressed audio format through an integrated synchronization engine. Snapcast and Sendspin are candidates to evaluate then; their timing, buffering and device-delay behavior must be tested. This requires no video conversion and does not require replacing the TV movie player. No multi-screen video synchronization is proposed. [Snapcast](https://github.com/snapcast/snapcast), [Sendspin](https://github.com/Sendspin/spec)
