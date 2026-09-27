# Browser media delivery for device-independent Couch

Research retrieved **2026-09-27**. This is an architectural proposal, not an implementation or a hardware/browser qualification. External facts below come from primary project documentation, browser documentation, and standards. Sections marked **Recommendation** are Couch design judgments based on those facts.

## Finding

Browser rendering is a new playback endpoint, not a new definition of a Couch session. It needs a capability-negotiated media-delivery boundary. A controller that operates Couch TV needs no video decoder, media URL, or transcoding allocation at all. A browser that renders needs authorized access to a compatible representation; its queue and session identity should survive changing that representation.

**Recommendation:** Most Couch sources are remote; start from existing provider, radio, IPTV and Jellyfin playback. Keep canonical media identity, source access leases, session state, endpoint/group capabilities and delivery plans separate. A handoff chooses a new plan for the destination. It must not simply forward the TV's current URL, native track numbers, HTTP headers, or encoder process. Local/NAS media remains another source adapter.

## What exists in Couch

The existing [playback research](playback.md) already separates decoding/display from transcoding and favors original-video playback. Preserve that decision.

- [Jellyfin integration](../../src/server/jellyfin.ts) currently advertises a fixed `Couch libmpv` profile, disables direct streaming and transcoding in `PlaybackInfo`, accepts only a direct-play source, returns a static stream plus an authorization header, and reports `DirectPlay`. This is explicitly native-oriented negotiation, not a browser profile. Parameterize it by destination and delivery needs; do not reuse the profile for browsers. Its single active/prepared playback bookkeeping must also become scoped to the relevant session/attempt before simultaneous endpoints are supported.
- [Web media resolution](../../src/server/web-media.ts) resolves websites to provider media, possibly separate video/audio URLs and shared request headers. It can return DASH manifests whose height cap is applied by the native demuxer. Despite its filename, it is not a browser media server. Retain provider resolution, but translate its private result through delivery planning.
- [Library scanning](../../src/server/library.ts) already invokes ffprobe, but requests format duration/title/artist/album rather than a codec/stream inventory. Reuse the tool-management and bounded-process patterns, while adding the stream-level facts needed for negotiation. `getPlayable()` supplies local file access, with segment boundaries for CUE tracks. Delivery must preserve those logical boundaries and translate their timeline; returning the same file URL to a remote browser is insufficient.
- Existing [subtitle handling](../../src/server/subtitles.ts) and [native media integration](../../src/client/session/native-media.ts) are reuse points. Their native loading/output behavior is not itself a browser implementation.

This note does not independently establish that every library API or player lifecycle has the desired ownership boundary; the broader architecture inventory must do that.

## Remote access route comes before transformation

**Recommendation:** Separate who fetches the upstream media from whether media must change. Core can resolve a provider and coordinate playback while the browser/native endpoint fetches the existing rendition directly. Use a scoped Couch relay only when required by provider credentials/egress, browser restrictions or network reachability. Repackaging or encoding is a separate decision.

yt-dlp documents that extracted media can depend on the resolver's IP, cookies, headers and transport support. Therefore direct access must be checked for the destination; successful resolution on the TV does not establish browser usability. [Official FAQ](https://github.com/yt-dlp/yt-dlp/wiki/FAQ#i-extracted-a-video-url-but-it-does-not-play-on-another-machine--in-my-web-browser)

**Recommendation:** Preserve source rendition/codec metadata, separate audio/video resources, resource-specific access requirements, expiry and refresh behavior instead of retaining only an mpv-ready URL. A relay must authorize manifests, init/media segments, alternate audio/subtitles and permitted keys; handle relative URLs/redirects and live windows; and scope credentials to each resource. Refresh access without changing content identity or counting it as a new viewing. Do not assume every provider permits simultaneous preparation of two streams during handoff.

Direct provider-to-browser delivery avoids a home-server uplink bottleneck for remote users. Relay introduces that hop but may be necessary; neither route inherently requires video encoding. Use runtime capability checks and actual access constraints to select between them.

## Negotiate the smallest required transformation

Jellyfin distinguishes original-file delivery, container remuxing, audio conversion with original video, and video transcoding. Its negotiation uses client capabilities and constraints. FFmpeg streamcopy copies compressed packets without decoding or encoding. These are useful distinctions even when product terminology differs. [Jellyfin playback modes](https://jellyfin.org/docs/general/post-install/transcoding/), [FFmpeg streamcopy](https://ffmpeg.org/ffmpeg.html#Streamcopy)

**Recommendation:** Use the following ordered candidates, subject to correctness and user quality policy:

| Condition | Candidate |
| --- | --- |
| A suitable existing provider rendition fits decoder, tracks, bandwidth and access | Select it for direct provider-to-endpoint playback |
| Rendition fits but provider access cannot be used by that endpoint | Relay encoded bytes/segments, without re-encoding |
| Container/packaging is the incompatibility | Copy compatible streams into suitable packaging |
| Audio is the incompatibility | Copy video; convert only selected audio, including required channel conversion |
| Text subtitles are the incompatibility | Extract/convert subtitle sidecar; preserve original video |
| Video codec/profile/bit depth, bandwidth, scaling, required tone mapping, or subtitle burn-in demands new pixels | Decode, process as needed, and encode video; copy compatible audio where possible |
| No permitted viable pipeline | Explain the exact limitation without destroying an existing session |

These are candidates, not an unconditional promise of zero-copy, losslessness across all remuxes, or a requirement to try every candidate over the network. Probe known incompatibilities first. Network delivery of unchanged media remains direct play even when Couch proxies the bytes. HLS describes packaging/delivery; it does not imply video transcoding.

Represent the plan as composition rather than one ambiguous `transcoding` boolean: access (`direct-provider`, `relay`, `local`), packaging (`progressive`, `hls`, `dash`, backend audio framing), video/audio processing, subtitle treatment, source/track identities, output MIME/codecs, timeline mapping, expiry, and reasons. An audio backend may need decoded/framed audio while browser/native paths keep original streams. Private plans retain account secrets; renderer plans contain only the access granted to that endpoint.

## Browser capability reports

`MediaCapabilities.decodingInfo()` evaluates a concrete configuration and returns `supported`, `smooth`, and `powerEfficient`. It distinguishes file and MediaSource use, and accepts dimensions, bitrate, frame rate, and audio configuration. The results are predictions; MDN notes optimistic initial smoothness/efficiency values before device statistics exist. MSE's `isTypeSupported()` also does not guarantee that resources will be available when a SourceBuffer is allocated. [Media Capabilities](https://developer.mozilla.org/en-US/docs/Web/API/MediaCapabilities/decodingInfo), [MSE type support](https://www.w3.org/TR/media-source-2/#dom-mediasource-istypesupported)

**Recommendation:** Send a versioned endpoint profile derived from feature detection, configuration-specific probes, and actual failures. Include transport support, precise codec/profile constraints, subtitle rendering, audio-track switching, HDR/display capabilities where discoverable, and playback-rate/seek support. Treat unknown capabilities conservatively. Do not make a static “Chrome supports HEVC” table authoritative across OS, hardware, drivers, and browser releases.

`HTMLMediaElement.audioTracks` is not supported consistently across widely used browsers. Therefore, a source may decode successfully but still not support the selected audio-track workflow through the native media-element API. [Browser audio-track API](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/audioTracks)

**Recommendation:** Preserve the requested source track identity in the session. Delivery may expose HLS alternate audio or remux the requested audio into a new representation when native track switching is unavailable. Stable track IDs and descriptors must map to renderer-local indexes after loading. A language alone does not distinguish commentary, descriptive audio, or two tracks in the same language.

## Remote HTTP, HLS/DASH, seeking, and adaptive quality

HTTP defines byte ranges, partial-content responses, content-range metadata, unsatisfied ranges, and conditional requests. These provide a standard basis for resumable and seekable original-file delivery. Byte offsets address one representation, not a media timestamp. [HTTP Semantics, sections 13–15](https://www.rfc-editor.org/rfc/rfc9110.html#section-14)

**Recommendation:** Start with existing remote progressive streams and manifests. Direct mode uses the upstream transport; a relay preserves supported range/conditional semantics (`GET`, `HEAD`, `206`, `Content-Range`, `416` and validators) rather than pretending all sources are seekable files. Stream with backpressure and bounded resources. Address opaque authorized source resources, never an arbitrary path/URL reader. Local/NAS serving can reuse the same delivery policy as secondary coverage.

HLS defines playlists, timed media segments, variant streams, alternate renditions, and discontinuities. FFmpeg supports HLS output including fragmented MP4. Its normal segment boundaries follow keyframes; requested segment duration is not a guarantee of exact boundaries. [HLS specification](https://www.rfc-editor.org/rfc/rfc8216.html), [FFmpeg HLS muxer](https://ffmpeg.org/ffmpeg-formats.html#hls-2)

HLS.js uses browser media facilities and supports HLS through MSE/MMS where available; Safari also offers native HLS. Its current documentation warns that a nonempty HLS `canPlayType()` result is not sufficient proof of reliable native playback and recommends testing `Hls.isSupported()` first unless native playback is specifically required. [HLS.js maintained compatibility guidance](https://github.com/video-dev/hls.js#compatibility)

**Recommendation:** Use maintained HLS/DASH integrations and qualified native-HLS behavior. Couch already resolves both manifest families, so test them early, including separate audio/video. Shaka Player supports both and is a first-class candidate to compare with hls.js plus a maintained DASH adapter. Preserve usable upstream manifests/renditions. Generate new HLS packaging only for an actual adaptation need; keep packaging out of the session domain model. WebRTC is unnecessary merely to control or hand off ordinary provider VOD. [Shaka Player](https://github.com/shaka-project/shaka-player)

A single HLS rendition provides segmentation, not multiple quality choices. **Recommendation:** Preserve upstream ABR and select an existing lower rendition before encoding. Expose `Original`, `Auto` and bandwidth/quality caps. Defer generating Couch's own aligned bitrate ladder until measurements justify CPU/GPU/cache work; this does not defer playing an existing adaptive stream. Account for the actual path: provider-to-client and provider-to-Couch-to-client have different bandwidth limits. Lower resolution should not be the only available quality control.

For progressive delivery, the browser uses upstream or relayed ranges where supported; HLS/DASH use their content timeline and available window. For converted VOD, seek within retained segments or prepare a new generation around the requested position. Do not claim full VOD seeking without implementing the missing-segment/restart path. Keep live/DVR windows distinct from finite VOD duration.

FFmpeg input `-ss` normally starts at an earlier seek point. Transcoding can decode and discard the interval; streamcopy preserves it. **Recommendation:** Keep session position in the original media timeline and explicitly map generated timestamps back to it. Allow keyframe preroll, then seek/discard to the requested point in the destination. Never save the beginning of a generated clip as the user's original-media resume position. [FFmpeg seeking](https://ffmpeg.org/ffmpeg.html#Main-options)

## Subtitles and presentation fidelity

The standard browser `<track>` route consumes WebVTT. Jellyfin distinguishes text, formatted-text, and image subtitle formats and documents conversion versus burn-in. The FFmpeg `subtitles` filter renders through libass and can use supplemental fonts. [Browser text tracks](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/track), [Jellyfin subtitle compatibility](https://jellyfin.org/docs/general/clients/codec-support/#subtitle-compatibility), [FFmpeg subtitle rendering](https://ffmpeg.org/ffmpeg-filters.html#subtitles-1)

**Recommendation:** Deliver WebVTT directly, and convert simple SRT text to WebVTT without changing video. ASS/SSA conversion to simple cues can lose typography, positioning, animation, and typesetting; label that as reduced fidelity. A maintained browser libass/WASM renderer is an alternative when preserving ASS is important: JASSUB provides such an integration. That is a package to qualify, not a reason to build a subtitle engine. [JASSUB](https://github.com/ThaUnknown/jassub)

PGS/VobSub image subtitles cannot simply become accurate text without a separate OCR process. Choose a qualified client image-subtitle renderer, an equivalent text track if the user accepts it, or video burn-in. OCR is not a transparent remux. Burn-in changes video pixels and requires video encoding; embedded native-player subtitles do not. Include subtitle/font resource access in the delivery authorization and cache key. Subtitle selection and timing correction travel with the session; output calibration and browser-local presentation preferences do not automatically transfer.

## Linux hardware acceleration

Jellyfin's documented Linux paths include Intel QSV, NVIDIA NVDEC/NVENC, and Intel/AMD VA-API. It distinguishes decode, filters, tone mapping, subtitle composition, and encode stages; some pipelines are only partially accelerated. FFmpeg's current releases also include Vulkan Video acceleration and separate Vulkan compute codec implementations. Vulkan support is not evidence that a particular GPU/driver can accelerate every requested codec or filter. [Jellyfin hardware pipeline](https://jellyfin.org/docs/general/post-install/transcoding/hardware-acceleration/), [FFmpeg release documentation](https://ffmpeg.org/)

**Recommendation:** Place bounded FFmpeg workers behind delivery planning, independent of the player/coordinator. Probe the deployed binary, GPU device permissions, supported codec/profile combinations, and filter graph. Pin and qualify a build; do not assume the system `ffmpeg` matches documentation for another build. Reserve capacity for the central TV's own playback, cap concurrent jobs, cancel abandoned preparation, and expire temporary segments. Measure software fallback and tell users when it cannot keep up.

Qualify at least 4K HEVC Main10 decode, selected output encoding, subtitle burn-in, HDR-to-SDR conversion, and concurrent local TV playback on real Linux hardware. The existing Docker/software-rendering results in [playback.md](playback.md) do not establish those properties. Preserve HDR directly when the destination pipeline is qualified; otherwise plan explicit tone mapping. Do not infer correct color/HDR or HDMI audio merely from successful codec decoding.

For Jellyfin-owned media, negotiate using the actual destination profile and prefer Jellyfin's negotiated output when appropriate. Avoid converting an already converted upstream rendition again. Provider authorization or DRM failure should remain a provider error, not trigger blind retries with encoders.

## Browser lifecycle and handoff consequences

`play()` returns a promise that can reject with `NotAllowedError`; script-triggered playback is subject to autoplay policy. `currentTime` sets the requested seek location but can expose reduced timer precision. Pages can be frozen or discarded, and termination callbacks are not reliable. These are constraints on renderer availability and observation precision, not reasons to reduce browsing or library-management features. [Playback promise](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/play), [Playback position](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/currentTime), [Chrome page lifecycle](https://developer.chrome.com/docs/web-platform/page-lifecycle-api)

**Recommendation:** Model preparation, ready, awaiting-user-interaction, playing, stalled, and disconnected distinctly. Browser readiness must verify loaded media, usable tracks, and seek readiness; starting audible playback may still require a click in the destination tab. Do not commit a handoff solely because an HTTP request succeeded or `canplay` fired. Obtain an actual start acknowledgement and have a rollback path after pausing the source. An incoming remote handoff cannot manufacture a user gesture.

During a normal handoff, prepare the destination while the source remains active, then pause/checkpoint the source at a known position, reconcile the destination's seek, and switch authority under a session generation. If destination start fails, resume the source at the checkpoint under a fresh authorized assignment only when it is available and the destination is known silent. A missing acknowledgement alone does not prove silence. Specify the small silence/overlap tradeoff explicitly; perfect cross-device atomic playback is not guaranteed by an ordinary network protocol. An intentional paused-session transfer remains paused.

Browser OS media controls can use the Media Session API, and visible playback can request a screen wake lock where available. Neither turns a browser tab into a guaranteed always-on renderer. [Media Session API](https://developer.mozilla.org/en-US/docs/Web/API/Media_Session_API), [Screen Wake Lock](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API)

## Delivery security and network reachability

HTML's native media resource loading exposes URL and cross-origin settings rather than an arbitrary application header map. MSE fetches and subtitle resources must satisfy applicable CORS policies. Credentialed cross-origin responses require an explicit permitted origin, and third-party cookie restrictions still apply. [HTML media loading](https://html.spec.whatwg.org/multipage/media.html#loading-the-media-resource), [CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS)

**Recommendation:** Prefer serving the browser UI, API, and media from one authenticated HTTPS origin. Use an HttpOnly session cookie with appropriate request protections, or a short-lived, narrowly scoped delivery grant where cookie delivery is unsuitable. Native-HLS manifests, child playlists, segments, subtitles, and encryption keys all need an authorized access path; protecting only the top-level manifest is insufficient. If grants appear in URLs, redact logs, limit referrers, scope cache behavior, and provide renewal without changing media identity. Do not expose upstream account tokens to general controllers.

HTTPS pages cannot assume access to insecure media/API resources: mixed-content rules can upgrade or block requests, and HTTP resources addressed by IP have additional blocking behavior. Chrome has also moved from its earlier Private Network Access proposal toward Local Network Access permissions. Browser-to-LAN reachability is therefore a deployment constraint to qualify, not a discovery/authentication design. [Mixed content](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Mixed_content), [Chrome Local Network Access](https://developer.chrome.com/blog/local-network-access)

**Recommendation:** For internet access, use the same authorized server origin over a properly configured TLS reverse proxy or private-network access solution. Do not send a remote renderer an inaccessible `192.168.*` provider URL. Decide whether a provider can be contacted directly by that endpoint or needs a bounded server relay; enforce redirect, destination, size, timeout, and credential-forwarding policy at that relay. Couch should not become an open proxy or an arbitrary FFmpeg protocol launcher. Keep direct-file access restricted to trusted colocated native endpoints and configured media roots.

## Synchronized audio is a different delivery adapter

**Recommendation:** Future Snapcast/Sendspin groups belong in the target model now. A session-owned producer can fetch remote radio, tracks or other authorized audio and feed the backend; it need not read a local file. Core owns the queue/intent; the backend handles synchronized presentation, with progress mapped from audible output rather than producer read-ahead. Use the relevant first-party SDK and ingestion interface instead of making every renderer run the same PCM pipeline. A browser can be a normal media endpoint or a synchronized audio endpoint depending on the selected session/output mode. See [the focused investigation](multiroom-snapcast-sendspin.md) for verified backend differences, pairing, timing and video limitations.

## Validation gates

No benchmark or playback experiment was run for this note. Qualification starts with remote radio, provider progressive/HLS/DASH, split audio/video, Jellyfin, live/EVENT windows, resource headers, redirects, expiring access, direct-versus-relay egress and provider concurrency limits. Transfer the same session both ways with alternate tracks, subtitles, speed and denied destination start. Add group join/leave, backend restart, seek/flush and audible progress, plus conversion fixtures only where required. Include current browsers/mobile lifecycle and secondary local-file coverage. Record access route and transformations separately so “streaming” is never an unexplained synonym for encoding.
