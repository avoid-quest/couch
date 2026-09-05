# Integrated provider playback

Researched 2026-09-05 against current project docs and source. The [implementation](../../README.md) includes YouTube, Twitch, RaiPlay and Bandcamp browsing, shared saved items, Radio Browser search/favorites, a Jellyfin SDK adapter and yt-dlp resolution into native playback. A disposable Jellyfin 10.11.11 server passed authentication, catalog browsing, native playback, host progress reporting and Continue watching. Resume and Play from start loaded the expected positions in native libmpv. Physical GPU and audio-output qualification still belongs on the intended Linux box.

Provider modules supply catalogs, account sessions and playable media. The application owns browsing, queue, controls and status; the playback module owns decoding, output and its supported DRM paths. Normal media playback stays inside our application with our controls. Provider iframes and external-page handoff are not the product architecture.

V1 has one playback instance controlled by LAN clients. Only that instance resolves streams and reports upstream progress. See [architecture and shared state](architecture.md), [playback](playback.md), and [feature parity](feature-parity.md).

The webpage implementation stores the original page URL in the queue and runs
yt-dlp only on the host. Browsing and automatic metadata use extraction without
downloading media; playback resolves current stream addresses. One worker module
limits execution to three processes and sixteen waiting requests, including
cancellation, deadlines, output limits and process cleanup. Extraction is bounded;
signed stream URLs and HTTP headers travel through the private native pipe.
Separate video and audio use libmpv's `audio-files` option, which is cleared on
the next load. No provider iframe or video encoding is involved. The current
single-item resolver rejects DRM, account-only pages, playlists, unsupported transports and
conflicting audio/video headers with explicit errors.
[yt-dlp format selection](https://github.com/yt-dlp/yt-dlp#format-selection),
[mpv audio-files](https://mpv.io/manual/stable/#options-audio-files)

YouTube's upstream extractor also needs its EJS component and a supported
JavaScript runtime. The official yt-dlp EJS documentation currently rejects Bun
after 1.3.14, so Bun 1.4.2 remains the application runtime and Deno supplies that
optional extraction helper. `bun run setup:media` installs official standalone
yt-dlp 2026.08.19 and Deno 2.9.6 releases into the desktop data directory. It checks
official SHA-256 manifests and executable versions before replacement. Isolated
installs passed on macOS arm64 and Linux arm64; x64 release mappings are covered
by tests. Signed application distribution and coordinated updates remain work.
[yt-dlp EJS](https://github.com/yt-dlp/yt-dlp/wiki/EJS)

## Browsing and shared saved items

The **Online** view renders native app cards with artwork, titles and live or
duration metadata. **Play** sends one enqueue-and-play command. The host
reserves that play request before catalog lookup; a newer Stop, Play or Next
cancels it while preserving the queued item. Best, 1080p, 720p and 480p are per-entry choices stored with
the queue. A pasted webpage with a blank title requests metadata in the
background without delaying the queue acknowledgement.

For DASH manifests, the private playback request carries the requested height
limit to mpv. Its `on_preloaded` hook chooses the highest fitting video track
before decoding; a missing match produces an error. Best uses mpv's automatic
selection. A generated audio-first manifest verified 480p choosing 360p, 720p
choosing 720p, Best choosing 720p, and clean reset on the next file. Passing an
extractor's representation index directly was incorrect because XML and native
demuxer ordering can differ. See [mpv hooks and track properties](https://mpv.io/manual/stable/#hooks).

| Provider | Implemented browsing | Transport and limits |
| --- | --- | --- |
| YouTube | Public search, channel Videos/Playlists/Shorts/Live sections, playlist entries and pagination | yt-dlp flat extraction; no account setup. Channel roots open section cards. [Upstream tab extractor](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/youtube/_tab.py) |
| Twitch | Live directory, categories, category channels, channel lookup and search | Anonymous public web GraphQL requests. Search pagination works; the live directory does not expose a continuation because upstream rejects that request. Offline channels have an explicit status. [Public web endpoint](https://gql.twitch.tv/gql), [official authenticated API alternative](https://dev.twitch.tv/docs/api/get-started/) |
| RaiPlay | Home groups, programs, episode sets, live TV, search, genre lists and seven-day replay navigation | Public first-party JSON and current web search service. These web contracts need compatibility maintenance. [Home JSON](https://www.raiplay.it/index.json), [RaiNews catalog](https://www.raiplay.it/programmi/rainews.json), [search implementation](https://www.raiplay.it/assets/js/webcomponents/rai-search.js) |
| Bandcamp | Public track/album links, suggested albums, ordered tracks, artwork, shared saved items and album queue/play | Bounded yt-dlp extraction; no account, artist discovery, full-text search or custom domains. [Bundled extractor](https://github.com/yt-dlp/yt-dlp/blob/2026.08.19/yt_dlp/extractor/bandcamp.py) |

The authenticated provider routes cache completed pages briefly and bound
concurrent browse work. SQLite stores up to 500 shared saved media items,
channels and collections. Committed changes increment the provider catalog
version through the same WebSocket session used for controls. Each screen
reloads its own view; browsing on a phone does not change another screen's
navigation. Closing the app aborts pending requests.

Bandcamp album browsing inspects the flat track list and one full track for
artwork. The complete operation has a 30-second deadline and rejects more than
500 returned tracks or malformed entries. The enqueue command repeats that
bounded lookup, then appends once through SQLite before broadcasting. Remotes
receive public page URLs, titles and artwork; each track's stream and headers
are resolved privately when played. A newer Stop or play request wins over a
slow album play request. Shutdown aborts unfinished extraction. The upstream
extractor omits tracks without duration, so this is the returned public album
list; browsing does not prove that every later track can still play.

## Public provider checks

The final Linux `--provider-catalogs` run completed on 2026-09-05 at 19:04 UTC
with yt-dlp 2026.08.19 and Deno 2.9.6. It passed these eight public media cases
through the actual Online UI. Two paired remotes observed native tracks and
advancing playback position; the second changed the shared volume. Each case
also checked artwork and saving the item. No account, cookies or transcoding
were used. The run used the explicit basic GPU rendering option described in
[Linux tests](../../tests/linux/README.md); actual X11 screenshots showed video
frames or the TV's audio artwork.

| Sample | Browse path | Native result |
| --- | --- | --- |
| [YouTube, original Big Buck Bunny](https://www.youtube.com/watch?v=YE7VzlLtp-4) | Search | Selected audio/video, advancing playback and visible frame |
| [Twitch, LofiGirl](https://www.twitch.tv/lofigirl) | Live search | Selected audio/video, advancing playback and visible frame |
| [RaiNews24 live](https://www.raiplay.it/dirette/rainews24) | Live TV | Selected audio/video, advancing playback and visible frame |
| [RaiNews24 episode](https://www.raiplay.it/video/2026/09/RaiNews24-b7db7659-d7db-42ef-89f9-e7bdd2a04b86.html) | Program drilldown | Selected audio/video, advancing playback and visible frame |
| [RaiNews24 replay](https://www.raiplay.it/video/2026/08/RaiNews24-1cf7cb45-accc-472d-ae73-fc345cbe17ec.html) | Search | Selected audio/video, advancing playback and visible frame |
| [Rassegna stampa replay](https://www.raiplay.it/video/2026/09/RASSEGNA-STAMPA-e440a51a-b290-4de7-9208-f75b46a312d7.html) | Recent replay | Selected audio/video, advancing playback and visible frame |
| [Mastodon, Hail to Fire](https://relapsealumni.bandcamp.com/track/hail-to-fire) | Public track link | Selected audio, unselected embedded cover track, advancing playback and visible TV artwork |
| [Blazo, Intro](https://blazo.bandcamp.com/track/intro) | Public track link | Selected audio, advancing playback and visible TV artwork |

The same run opened Blazo's [Jazz Format Mixtape vol.1](https://blazo.bandcamp.com/album/jazz-format-mixtape-vol-1)
from its suggested card and queued all 22 returned public track pages in their
displayed order. TV **Play album** started Intro; **Next** played
[Kero One - Keep It Alive (Blazo remix)](https://blazo.bandcamp.com/track/kero-one-keep-it-alive-blazo-remix).
A second controller replaced it with Hail to Fire, reconnected to the current
session, and observed Stop. X11 pixel checks confirmed visible artwork for both
standalone tracks and after replacement back to Hail to Fire.

The real paired 390px HTTP browser opened the same album link, decoded artwork,
appended all 22 tracks without autoplay, used **Play album** to start Intro, and
stopped the TV. After a real desktop restart, the complete 74-entry test queue,
eight saved items, metadata, artwork and video quality choices remained intact.
Both WebSocket controllers and the HTTP phone reconnected without autoplay.

The deliberately missing [couch-unavailable-test](https://blazo.bandcamp.com/track/couch-unavailable-test)
page produced "The provider could not complete this request. Try again shortly."
with a retry control in 2.1 seconds. The queue and stopped playback were unchanged.
An earlier direct upstream diagnostic for that URL recorded HTTP 404. The initial
native run also exposed a black screen when an embedded audio cover was selected
as video. The final build disables mpv cover display and passed the actual
artwork pixel checks; [playback notes](playback.md) describe the correction.

These checks played only Intro and Kero One from the 22-track album. The other
20 tracks have no native playback result. A separate adapter probe returned
29 tracks and artwork for the suggested [FTL album](https://benprunty.bandcamp.com/album/ftl),
but did not play it through the application. Account libraries, artist
discographies, full-text search and custom domains remain unsupported. Upstream
album extraction omits entries without duration, and availability can change
between browsing and playback.

Final evidence is in `.artifacts/bandcamp-provider-gate/qualification.json` and
`source/.artifacts/linux/providers/` beneath that directory, including results,
screenshots, source hashes and binary hashes. Its source manifest and both
executables match the final `.artifacts/linux/` Jellyfin/live-radio run, which
passed 408 native/remote checks. Earlier provider failures remain in
`.artifacts/bandcamp-provider-gate/initial-linux/`; they do not qualify the final
UI. These are Docker software-rendering and silent-audio results, not physical
GPU or HDMI qualification.

## Radio station feeds

The app imports the actual [avoid radio Kodi playlist](https://radio.avoid.quest/playlist.m3u).
Its [station JSON](https://radio.avoid.quest/api/stations.json) exposes the same
10 entries. The live M3U matched the source application's export byte for byte
on 2026-09-05. All 10 stream probes passed on Linux: eight MP3 streams,
Internet Public Radio using Ogg/Vorbis, and HKCR using HLS/AAC. The slowest probe
took 5.09 seconds. No account or special request headers were needed.

Saved radio playlists use the existing TypeScript
[@iptv/playlist parser](https://github.com/ektotv/playlist), pinned at 1.2.1.
SQLite stores the feed and station catalog. Refresh preserves station identity
and updates metadata, URLs and matching favorites. Queued playlist stations
store their IDs and resolve the current stream URL when playback starts.
Failed refreshes retain the
last good catalog. Bun publishes a radio catalog invalidation to every paired
remote; each reloads its own current view. Browsing does not open another player.

Radio playback reads current ICY titles and actual audio title/artist tags through
libmpv. It preserves station identity and displays the track separately. Missing
tags leave no previous track behind. Bun retries a station after 1, 2 and 4
seconds, re-resolving its current catalog URL each time. Three failed retries
leave an explicit error with a manual retry action. Thirty seconds of observed,
advancing playback earns a new retry budget. Stop, source replacement, newer
catalog play requests and shutdown cancel timers and unfinished resolution.
Radio EOF retries the station instead of advancing the queue.

On 2026-09-05 an isolated build of the actual Linux app imported the required
avoid feed, played Sygma with the observed title `radio - Rotation`, and retained
all ten station records and their order across restart without autoplay. Radio
Paradise also played through the real Radio Browser catalog. Its stream supplied
no current-track tag during that observation. These are dated stream results;
public availability and supplied metadata can change. Synthetic ICY/network
qualification and exact binary hashes are recorded in [playback](playback.md).

This implements the M3U station-import part of Kodi's PVR workflow. An XMLTV
guide, recording scheduler and timeshift backend remain separate work. The
avoid radio app needs no change for its current feed to work here.

## What Kodi actually does

A Kodi video add-on can produce a `ListItem` containing the media manifest and choose `inputstream.adaptive`, then call `setResolvedUrl`. The add-on supplies different headers for manifests, media segments and license requests. This is a useful model for a TypeScript provider API. It is substantially richer than `play(url)`. [InputStream integration](https://github.com/xbmc/inputstream.adaptive/wiki/Integration)

InputStream Adaptive handles HLS, DASH and Smooth Streaming and has DRM support. Widevine on non-Android systems requires a separately installed CDM library. Its current configuration can include license URL, request headers, certificates and response handling. Availability depends on the operating system and DRM. It is a Kodi binary add-on, not an independent npm player or a component already present in libmpv. [InputStream Adaptive](https://github.com/xbmc/inputstream.adaptive), [DRM integration](https://github.com/xbmc/inputstream.adaptive/wiki/Integration-DRM)

This is not hypothetical for the requested providers. Kodi's YouTube add-on declares InputStream Adaptive as a dependency. Kodi's Rai Play add-on exposes radio, live television, replay and archive browsing. Its source resolves a Rai stream and, when appropriate, passes the DASH manifest and Widevine license endpoint to InputStream Adaptive. This establishes a native integration precedent, not a guarantee that every current Rai title works. [YouTube add-on dependency](https://github.com/anxdpanic/plugin.video.youtube/blob/master/addon.xml), [Rai Play catalog](https://kodi.tv/addons/omega/plugin.video.raitv/), [Rai playback source](https://github.com/maxbambi/plugin.video.raitv/blob/master/default.py), [Rai resolver source](https://github.com/maxbambi/plugin.video.raitv/blob/master/resources/lib/relinker.py)

## Coverage and constraints

The table describes the broader target, including work beyond the current adapters. "Strong" means an upstream API or native playback route exists; "conditional" means compatibility depends on provider behavior, account or additional integration. A requested source is still a support gate even when its worker is installed only when enabled.

| Source | Credible integrated route | Evidence strength | Concrete limitation |
| --- | --- | --- | --- |
| Internet radio | Saved M3U feeds, Radio Browser, shared favorites, observed current-track metadata and bounded native reconnects | Implemented; all 10 avoid streams probed, Sygma and Radio Paradise played in the app | Metadata depends on the stream; live rewind requires a buffer; physical network/audio qualification remains |
| Jellyfin | Official TypeScript SDK, native catalog, playback negotiation and upstream progress reporting | Strong | Device capability profile must describe the real decoder and outputs; live streams need session lifecycle handling |
| Bandcamp purchased files | Import files into the music library, play through the common engine | Strong | Does not provide Bandcamp's online account/catalog features |
| Bandcamp online tracks/albums | Implemented public links, artwork, ordered album queue/play and private yt-dlp resolution | Public native track, TV/HTTP album and restart checks passed; unofficial | No consumer playback API or account integration; returned album tracks can be omitted upstream or fail when played; search/discography/custom domains remain unsupported |
| YouTube | Implemented public catalog and yt-dlp resolver; YouTube.js + GoogleVideo remain alternatives for a future TS transport | Public browse-to-play checks passed; unofficial | Some playback uses SABR sessions rather than simple reusable URLs; signatures, account requirements and attestation evolve |
| Twitch | Implemented anonymous catalog and yt-dlp live resolver; Streamlink only if a demonstrated gap needs it | Public browse-to-live-play check passed; unofficial | Tokens and live windows expire; offline channels cannot play; no universal VOD/live seek contract |
| RaiPlay unprotected content | Implemented public catalogs/search/replays and yt-dlp resolver | Public browse-to-live/replay checks passed; unofficial | Stream expiry and title-specific requirements; yt-dlp reports protected titles as DRM |
| RaiPlay protected content | Provider integration plus an authorized compatible Widevine/CDM playback path | Blocked for a plain libmpv architecture | A manifest and login are insufficient; require actual license success on chosen runtime, content and Linux hardware |
| Arbitrary website media | Direct URL probe, then maintained site extractor, then an explicit unsupported result | Best effort | `blob:`/MSE media, access control, proprietary protocols, browser-only workflows and DRM defeat a universal URL contract |
| Full webpage sharing | A separate in-app web document mode with remote navigation | Separate capability | A webpage cannot be rendered by a media decoder; this does not need to become the default media playback path |

Radio Browser provides a documented directory API and stable station UUIDs. Use its server discovery/failover procedure instead of hardcoding one directory server. [Radio Browser API](https://api.radio-browser.info/)

Jellyfin's `PlaybackInfoResponse` includes media sources and a play-session ID. Its `MediaSourceInfo` carries stream descriptors, required HTTP headers, direct-play/direct-stream/transcode support and opening/closing requirements. That is a real integration contract. [Jellyfin TypeScript SDK](https://github.com/jellyfin/jellyfin-sdk-typescript), [PlaybackInfoResponse](https://typescript-sdk.jellyfin.org/interfaces/generated-client.PlaybackInfoResponse.html), [MediaSourceInfo](https://typescript-sdk.jellyfin.org/interfaces/generated-client.MediaSourceInfo.html)

Text sidecars use Jellyfin's supported
`/Videos/{item}/{mediaSource}/Subtitles/{index}/Stream.{format}` endpoint with
`copyTimestamps=true`. The host reconstructs the route and supplies its existing
Authorization header, keeping URL tokens and server file paths out of snapshots.
Bun fetches those files before native loading, rejects redirects and off-server
delivery, and passes private cached files to libmpv. External image sidecars show
an unsupported-format warning while video remains playable.
[Subtitle request contract](https://typescript-sdk.jellyfin.org/interfaces/generated-client.SubtitleApiGetSubtitleRequest.html),
[Jellyfin subtitle controller](https://github.com/jellyfin/jellyfin/blob/master/Jellyfin.Api/Controllers/SubtitleController.cs)

Bandcamp's published developer API covers label/fulfillment account operations, not general consumer streaming. yt-dlp does have track and album extraction, but its current base extractor retries client-challenge responses with browser impersonation. Treat this as ongoing compatibility work. [Bandcamp API](https://bandcamp.com/developer), [yt-dlp Bandcamp implementation](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/bandcamp.py)

Streamlink is both a Python library and CLI for delivering stream data to a player. Its Twitch plugin may invoke a Chromium browser to calculate a client-integrity token and caches that token while valid. An internal worker could own this, while the user stays in our app. Using a browser to satisfy session acquisition is different from rendering the provider player in an iframe. [Streamlink](https://streamlink.github.io/), [Twitch plugin](https://github.com/streamlink/streamlink/blob/master/docs/cli/plugins/twitch.rst)

Streamlink lists RaiPlay live/VOD, Italy region and account arguments. yt-dlp's Rai implementation reads page JSON and relinker responses and explicitly reports DRM. Therefore its existence supports some native playback, not protected-content coverage. [Streamlink RaiPlay](https://streamlink.github.io/latest/plugins.html#raiplay), [yt-dlp Rai implementation](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/rai.py)

## TypeScript YouTube integration

YouTube.js accesses InnerTube and exposes streaming formats, session cookies, visitor data and PO-token configuration. Its current guide requires the application to supply a JavaScript interpreter for streaming URL deciphering. Put that interpreter in a restricted worker rather than evaluating remote code inside the credential-bearing hub. Bun compatibility should be tested explicitly; the project lists Node, Deno and browser requirements rather than certifying our complete Bun configuration. [YouTube.js](https://github.com/LuanRT/YouTube.js), [getting started](https://ytjs.dev/guide/getting-started), [streaming-data API](https://www.ytjs.dev/api/classes/Innertube)

GoogleVideo provides TS modules for YouTube's UMP/SABR protocol and adapters for media players. The same author maintains Kira, an actual Vue/TypeScript example with its own watch UI, search, sessions and playback through Shaka. This is direct evidence that custom UI plus integrated YouTube streaming is possible without an iframe. It is unofficial, and the README's speed claims are not our measurements. [GoogleVideo](https://github.com/LuanRT/googlevideo), [Kira](https://github.com/LuanRT/kira)

SABR is the important complication. It exchanges player position and buffered-range metadata with the server and delivers media in UMP responses. Kira generates a DASH representation and intercepts Shaka requests to translate them into SABR operations. A static URL resolver passed to mpv does not reproduce that behavior. A session-aware transport adapter can unpack/repackage supported unencrypted segments without video re-encoding. The GoogleVideo example also merges extracted tracks with FFmpeg stream copy, which is remuxing, not transcoding. [Kira implementation explanation](https://github.com/LuanRT/kira#how-it-works), [FFmpeg stream-copy example](https://github.com/LuanRT/googlevideo/blob/main/examples/downloader/ffmpeg-example.ts)

The alternative yt-dlp path is broader but adds a Python executable and JS runtime requirements. Current EJS docs recommend Deno and deprecate Bun support beyond 1.3.14. Current PO-token docs describe per-video/session binding and moving enforcement. Pinning one extractor version forever is not a realistic release policy. [yt-dlp EJS](https://github.com/yt-dlp/yt-dlp/wiki/ejs), [PO-token guide](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide)

Technical feasibility does not make YouTube.js or extractors official provider integrations. YouTube's published API policies disallow undocumented API use without permission and impose restrictions on player modification, background playback and media handling. This is a product distribution decision to record explicitly, not a reason to pretend iframe playback is the only technical path. [YouTube developer policies](https://developers.google.com/youtube/terms/developer-policies)

## Playback sessions, not saved stream URLs

Proposed contract, an engineering design derived from these providers:

- Persist a stable content reference such as provider, provider item ID and account reference in the queue. Do not persist the short-lived resolved media URL as the item's identity.
- Resolve shortly before playback using the receiver's codec/output capabilities. Return metadata, transport type, audio/video/text tracks, request context, optional DRM requirements, expiry if known and content-specific controls.
- Keep credentials in the provider session on the host. Remotes receive catalog/queue/state data. HTTP headers and cookies need domain scoping; manifest, segments and license requests can require different rules.
- Treat proprietary transport as an open session. It may need heartbeats, quality changes, refresh, seeking and an explicit close operation. A URL-only adapter is appropriate only for simple sources.
- On expiry or a recoverable 401/403, re-resolve with bounded retry. Preserve current position for VOD and the requested live-edge offset for live content. Report account-required, unavailable, unsupported-DRM and temporary-provider-failure distinctly.
- Report actual player events into the shared session. An ended event can advance the queue; a resolver failure must not silently start the next item forever.

Only the session owning playback should send upstream progress. Ten remotes observing a Jellyfin movie should still represent one playback session, not ten streams or progress reporters. This is an application ownership choice; the remotes never need the protected stream URLs simply to pause the TV.

## DRM and a unified UI

A custom player interface does not require transcoding. Shaka itself supports customizable UI and EME playback. For authorized protected media, an integrated Shaka view in a CDM-capable runtime could retain the same app navigation and controls. This is an internal playback backend, not the provider's iframe. Its license server, required robustness, HDCP and runtime support must all succeed. Stock desktop shells cannot be assumed to ship a usable Widevine configuration. [Widevine overview](https://developers.google.com/widevine/drm/overview), [Shaka DRM configuration](https://shaka-project.github.io/shaka-player/docs/api/tutorial-drm-config.html)

Qt WebEngine supplies a concrete alternative host to evaluate. Its official documentation supports HTML5 DRM with an installed Widevine CDM, explicitly says the CDM is not shipped, and identifies codec build requirements. An app-owned Shaka player in that runtime could share the product's queue and controls with native libmpv playback. It adds a second internal playback backend and Qt/Chromium packaging; it still requires a successful Rai license/playback test. Tauri's Linux webview plus libmpv does not establish this capability by itself. [Qt WebEngine DRM and codecs](https://doc.qt.io/qt-6/qtwebengine-features.html#html5-drm)

Transcoding cannot supply a missing CDM or license authorization. Widevine licenses are individualized to the requesting device and enforce provider rules. Decoding protected video in a CDM also does not imply permission or ability to export clear frames into a transcoder. The credible alternatives are Kodi's supported inputstream/CDM path, a tested EME/CDM backend integrated into our UI, or provider-supported native playback licensing. The choice should be tested early against protected Rai content if that is required parity.

## Product references worth comparing

Grayjay Desktop already implements a multi-source application with one UI and cross-compatible Android/Desktop source plugins. Its repository contains a client/server application and desktop browser host. It is a useful source-integration reference and possible existing-product evaluation, although Kodi's local library/PVR/appliance scope differs. Its custom license needs separate review before assuming code reuse. [Grayjay Desktop](https://github.com/futo-org/Grayjay.Desktop), [plugin catalog](https://plugins.grayjay.app/)

## Reuse order and acceptance

Implement direct URLs, radio and official Jellyfin APIs in TypeScript first. Add one maintained broad extractor worker for eligible Bandcamp, YouTube, Rai and website URLs. Add Streamlink for live-stream gaps demonstrated by Twitch tests, and a YouTube.js/GoogleVideo integration when required catalog or session behavior warrants it. Do not implement four overlapping resolvers simply to count more providers. A fallback chain should distinguish unsupported content from an expired login or DRM failure; only the first is a reason to try another compatible resolver.

Compatibility workers are app-managed dependencies with coordinated installation, updates, cancellation and errors. The user should not need a Python environment or manually configured browser session to assemble the product. yt-dlp's current EJS requirements mean the main Bun runtime alone cannot be assumed to cover its YouTube challenge execution; qualify and package the worker's supported runtime. A provider update must preserve its queue item identities and account references. [Supported extractors](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md), [EJS requirements](https://github.com/yt-dlp/yt-dlp/wiki/EJS)

For each named provider, record the tested title/live channel, date, worker/runtime version, account/region requirements, supported controls and failure result. Exercise open, pause where applicable, seek/live edge, quality/track changes where offered, expiry recovery, queue advancement and cancellation. Include representative unprotected and protected RaiPlay titles early. A maintained extractor's supported-sites list is not that test result.

Sharing a website URL first invokes the same source resolver and queue workflow. Opening a full webpage is a separate document mode in an isolated app-owned view, with its own navigation and site session. It must not receive the trusted app's Tauri commands or host credentials. Sharing rendered pixels from another device is a third feature, with capture/encoding requirements described in [playback](playback.md). Neither webpage mode nor capture is a fallback that can promise every protected service works.

Tauri remains the shell direction. Protected RaiPlay has no qualified plain Tauri/libmpv path yet; its early test may require an additional authorized native or EME backend. Keep that gap visible rather than removing the source from the feature matrix or calling webpage display equivalent to integrated media support.
