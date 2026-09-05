# Native dependency patches

These directories contain released crates copied from Cargo's registry. Their
License notices remain alongside their sources. Keep changes small and
remove each patch when a compatible release provides its replacement.

| Crate | Published version | Archive SHA-256 | Upstream source commit |
| --- | --- | --- | --- |
| [tauri-plugin-video](https://crates.io/crates/tauri-plugin-video/0.3.0) | 0.3.0 | `581fe7f4e0e125f7a39ea7edbc7e27c5399a06f33d9ef7ac00494c984bb2e954` | `6e9bb47934eb82a420d85ebfe9258996d1b4507e` |
| [tauri-runtime-wry](https://crates.io/crates/tauri-runtime-wry/2.11.4) | 2.11.4 | `4e6fac707727b7a2f48e4ded90976324267371073edbb415ffb73bb0458d203f` | `ca90b46b2e2cbbc981dae1b809f4af4343fe0558` |
| [libmpv2](https://crates.io/crates/libmpv2/5.0.3) | 5.0.3 | `88dc8432d3de09ed6e343488d6b208467db6801fb41971a1f726fa2248302fe5` | `50216c684c02292b87ba151b1ec37c66dcb8c4dc` |

Cargo cache markers, the nested lockfiles and original unnormalized manifests
are omitted. Cargo.toml and the upstream source/platform files are retained.

## Video plugin

Only the `mpv-runtime` feature is selected, and only for Linux. The application
does not ship the plugin's JavaScript adapter or expose its playback commands
to the webview. A native worker calls the existing GTK dispatcher directly.

Local changes:

- `src/lib.rs`: make the existing `Video::desktop()` accessor public. Its
  `open_native`, `control_native`, `layout_native`, `stats_native` and
  `close_native` methods are already public.
- `src/models.rs`, `src/desktop.rs`, `src/desktop/windows.rs`: add optional mpv
  observations for volume, seekability, end of file, loading, chapters, speed
  and audio/subtitle delay. Other engines
  leave this extension empty. End of file comes from libmpv's `eof-reached`
  property; the plugin already uses `keep-open=yes`.
- `src/desktop.rs`: after stopping an old source, drain its queued events and
  wait for the replacement's `StartFile` and `FileLoaded` before publishing
  its position, duration, seekability or EOF. This prevents the prior source's
  properties being labelled with the replacement playback ID. Readiness is
  tracked in the native engine, independently of webview reloads.
- `src/desktop.rs`: extend mpv controls with `speed`, `audioDelay`,
  `subtitleDelay` and `subtitlesOff`. The existing track selection remains in
  use; its public index maps to the mpv track ID. All published values come
  from mpv properties. Chapter metadata uses `chapter-list`, speed uses `speed`,
  delays use `audio-delay` and `sub-delay`, and subtitle-off sets `sid=no`.
  Tracks and chapters are omitted until the new source has loaded.
  These are documented in the [official mpv manual](https://mpv.io/manual/stable/).
- `src/desktop.rs`: make the GtkGLArea context current before render-context
  update and destruction, as required by libmpv's
  [render API threading contract](https://github.com/mpv-player/mpv/blob/master/include/mpv/render.h).

Authenticated sources use the plugin's existing request header map. The native
bridge keeps headers in the private load command only. `configure_network`
clears `http-header-fields` before each load and appends each header with mpv's
`change-list` command. This replaces the upstream `%length%` string encoder;
`append` preserves authentication values containing commas and quotes.

The request has an optional `audioUri` for a separately resolved audio stream.
Before `loadfile`, mpv's `change-list` clears `audio-files` and appends that URI
if present. `append` passes one unescaped item, preserving punctuation in URLs.
Ordinary loads always clear external audio. See the official
[audio-files](https://mpv.io/manual/master/#options-audio-files) and
[change-list](https://mpv.io/manual/master/#command-interface-change-list)
documentation.

For a capped DASH load, the private request carries `maxVideoHeight`.
`mpv_tracks.rs` selects the largest main-video `demux-h` within that limit
in mpv's `on_preloaded` hook, before decoder creation. No fitting track is
an explicit playback error. Every new load resets `vid=auto`, so Best and
ordinary media retain mpv's default selection. We do not map yt-dlp's
`manifest_stream_number` to an mpv track ID: an audio-first MPD proved that
yt-dlp's XML order differs from FFmpeg's video-first stream order.
See mpv's [preload hook](https://mpv.io/manual/master/#hooks) and
[track properties](https://mpv.io/manual/master/#property-list-track-list).
The Linux regression generates a local 360p/720p DASH fixture and verifies
480p/720p caps, a missing fitting track, reset and pending-hook replacement.
Run it with `cargo test --locked --manifest-path src-tauri/Cargo.toml -p tauri-plugin-video dash_selection`.

Resume loads carry optional private `startPosition` seconds through the Rust
bridge and `NativeOpenRequest`. Before each `loadfile`, the plugin sets mpv's
`start` option. Missing or zero positions explicitly set `start=none`, so a
previous resume point cannot affect an ordinary file or live stream. The native
regression loads at two saved offsets and verifies both reset forms without
changing the DASH preload hook. Run it with
`cargo test --locked --manifest-path src-tauri/Cargo.toml -p tauri-plugin-video resume_start`.
See the official [mpv start option](https://mpv.io/manual/stable/#options-start).

External subtitle requests remain on the private coordinator-to-native pipe.
`mpv_subtitles.rs` uses `sub-add` with explicit titles and languages. Provider
tracks are added with `auto` during the existing `on_preloaded` hook, before
mpv chooses tracks. A user attachment uses `select` and publishes mpv's observed
selection. A failed attachment publishes a separate, generic `subtitleError`
while playback continues. External track labels never fall back to a source
path or URL. See [sub-add](https://mpv.io/manual/stable/#command-interface-sub-add).

The synchronous binding blocks while `sub-add` fetches a network source. The
Linux probe delayed an HTTP subtitle response by 1,000 ms and measured a 1,015 ms
native call. Provider subtitle downloads therefore belong in the coordinator's
abortable, bounded fetch path before passing local files to GTK. This preserves
Stop and source-replacement responsiveness and keeps provider credentials in
the host. The fixture includes that HTTP probe as evidence for this boundary.

Each load resets `aid`, `sid`, `alang`, `slang`, speed and audio delay from the
coordinator's saved preferences. Missing preferences restore empty language
lists, automatic subtitle policy, speed 1 and audio delay 0. Subtitle delay is
source-specific and always resets to 0. The plugin clears `sub-files`, retires
pending attachments when replacing a source, and sets `sub-auto=no` so mpv does
not discover adjacent host files outside the coordinator's approved selection.
The existing stop/drain and exactly-once hook acknowledgement remain in use.
See [track selection](https://mpv.io/manual/stable/#options-slang),
[external files](https://mpv.io/manual/stable/#options-sub-files) and
[automatic discovery](https://mpv.io/manual/stable/#options-sub-auto).

The Linux `external_subtitles` regression generates SRT and styled ASS files,
checks preferred-language selection against two real audio tracks, exercises
manual selection and a missing subtitle, then verifies Off and default resets
and cleanup on a following source. Run it with
`cargo test --locked --manifest-path src-tauri/Cargo.toml -p tauri-plugin-video external_subtitles`.

Native initialization sets `ytdl=no`. Bun already owns webpage extraction through
its bounded worker. The first actual radio HTTP 503 test exposed mpv's built-in
ytdl fallback making an extra request before the coordinator's scheduled retry.
Disabling that fallback restored the exact request budget and keeps extraction
cancellation in one owner. See the [ytdl option](https://mpv.io/manual/stable/#options-ytdl).

Radio loads carry a private `radio` flag. `mpv_radio.rs` sets
`network-timeout=8` and disables FFmpeg's implicit reconnect options, so the
coordinator owns the attempt limit and cancellation. Ordinary loads restore the
native engine's original timeout and `stream-lavf-o` values. mpv 0.37.0 enables
`reconnect=1` before applying those overrides. See the [network options](https://mpv.io/manual/stable/#options-network-timeout),
[mpv stream implementation](https://github.com/mpv-player/mpv/blob/v0.37.0/stream/stream_lavf.c#L288-L291)
and [FFmpeg HTTP options](https://ffmpeg.org/ffmpeg-protocols.html#http).

The existing 250 ms observation loop reads `metadata/by-key/icy-title`, then
the actual `title` tag, with an optional actual `artist` tag. It never reads
`media-title`, whose fallback can expose a private source, or publishes the
metadata map and ICY headers. Text is limited to 300 characters per field,
whitespace is collapsed, control and bidi marks are removed, and URL/absolute
path values are omitted. ICY titles are preserved as supplied, without guessing
an artist/title split. Observations are empty before loading, after Stop or EOF,
on errors and for ordinary sources. Missing or malformed tags are nonfatal.
See the [metadata properties](https://mpv.io/manual/stable/#property-list-metadata).

The `radio_metadata` Linux regression serves real paced MP3 audio with changing
ICY titles, verifies one HTTP connection, reads real ID3 title/artist tags and
checks the network-option reset. Run it with
`cargo test --locked --manifest-path src-tauri/Cargo.toml -p tauri-plugin-video radio_metadata -- --nocapture`.
Application reconnect and multiple-controller acceptance remain separate gates.

## Software display fallback

On software displays or VMs with broken intermediate framebuffer rendering,
`COUCH_BASIC_RENDERING=1` enables mpv's `gpu-dumb-mode=yes` and logs that
choice. This opt-in disables advanced scalers and custom shaders; it does not
force CPU decoding or choose a GL driver. Without the environment variable,
mpv's renderer defaults apply. See the official
[mpv renderer option](https://mpv.io/manual/master/#options-gpu-dumb-mode).

## libmpv2 render binding

`src/mpv/events.rs` adds the existing libmpv `mpv_hook_add` and
`mpv_hook_continue` calls and decodes `MPV_EVENT_HOOK`. Hook continuation is
unsafe because libmpv requires exactly one acknowledgement on the owning
handle. The plugin acknowledges hooks even when a source is stopped or
selection fails. See the official
[hook API contract](https://github.com/mpv-player/mpv/blob/master/include/mpv/client.h).

The LGPL-2.1 license is retained in `libmpv2/LICENSE`. Upstream media test
fixtures are omitted. The public `FBO` convenience struct has three integers
and Rust layout. Upstream cast its address directly to libmpv, whose
`mpv_opengl_fbo` requires C layout and four integers. The patch converts into
the existing generated `libmpv2_sys::mpv_opengl_fbo`, sets `internal_format=0`,
and uses the matching allocation deleter in both render paths. The root Linux
test in `tests/render_abi.rs` checks the C size, field offsets and converted
values during routine `cargo test`. This is an ABI fix,
independent of any GTK rendering diagnosis. See the official
[render_gl.h contract](https://github.com/mpv-player/mpv/blob/master/include/mpv/render_gl.h).

The same render path now keeps parameter arrays in their owning `Vec` during
synchronous FFI calls. Upstream converted a boxed slice to a thin pointer and
freed it as a single element. Callback replacement and destruction unregister
the callback before freeing its Rust storage. mpv holds its update lock while
unregistering and invoking callbacks, making this the required synchronization
point. See [render parameter lifetime](https://github.com/mpv-player/mpv/blob/master/include/mpv/render.h)
and [callback implementation](https://github.com/mpv-player/mpv/blob/master/video/out/vo_libmpv.c).

Boolean property reads and writes use C `int` storage. Upstream's generic
getter allocated a one-byte Rust `bool` for `MPV_FORMAT_FLAG`, so mpv's four-byte
write overflowed the buffer. The setter used an `i64`, which also mismatched the
documented format. Flag event reads use the same C integer conversion. The root
Linux test exercises both property directions using the
same C integer reads and writes. See the official
[property format contract](https://github.com/mpv-player/mpv/blob/master/include/mpv/client.h).

String property reads free mpv's allocated buffer even when UTF-8 conversion
fails. The API permits legacy metadata encodings; returning early before
`mpv_free` leaked those buffers on every metadata poll.

Player creation also destroys the allocated handle when the option initializer
fails, using the same cleanup as an `mpv_initialize` failure.

## Tauri runtime

`src/undecorated_resizing.rs` has two local changes: click and touch handlers
find the GTK toplevel and safely downcast it. The released code assumes exactly
two parents and unwraps the downcast. The video plugin's GTK overlay violates
that assumption, including for otherwise decorated windows.

[Upstream PR 15701](https://github.com/tauri-apps/tauri/pull/15701) removes this
fixed ancestry assumption as part of a larger resizing change. This local
patch keeps the published runtime and changes only the unsafe lookup. It does
not import the rest of the unreleased Tauri workspace.
