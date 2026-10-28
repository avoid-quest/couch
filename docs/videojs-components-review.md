# Video.js 10.2.0 components for Couch

Research snapshot: 28 October 2026. Couch baseline: `595d588c2de353a02d62af29d341d529e5d1c4aa` (`videojs/player-ux`). This is a research note, not an implementation specification or a claim that proposed interactions have passed browser testing.

## Integration status

The current stack implements actual `Slider.Root/Track/Fill/Thumb/Preview/Value`
and standalone `Thumbnail.Root/Image`, styled by Couch. Release-only shared
seeking, cancellation, duration changes, keyboard/TV navigation and preview
recovery are verified; see [built player behavior](design/player.md) and
[measurements](preview-performance.md). The recommendations below for Menu,
RadioGroup and a small media projection remain follow-up work, with their own
acceptance checks. Existing shadcn menus, volume controls and Select remain.
The final disposable Sendspin combination was verified at `bf6c2279`; the
research snapshots below identify the earlier source inspected for this audit.

## Recommendation

Adopt actual Video.js primitives in Couch's existing presentation. Keep the standalone Thumbnail and generic Slider now implemented. The next substantial opportunity is **Menu, including its generic RadioGroup**, followed by selected Tooltip/Popover parts. These can work without a Player, decoder or media element, so Couch can retain its options, permissions, commands and observations. They offer more useful reuse than importing a whole skin or merely imitating Video.js's appearance. Preserve the transport/tool positions, flat surfaces, lucide icons and complete settings menu. [v-thumbnail] [v-slider] [v-menu] [v-tooltip] [v-popover] [c-player] [c-settings]

Do not rule out media-aware components solely because a controller has no local media. A bounded probe successfully connected actual PlayButton and Time.Value to an EventTarget projection through public store attachment, with zero audio/video elements. That route is possible, but has significant lifecycle and optimistic-state limits; investigate it for a **small, explicit set of controls**, after standalone composition. It is not yet a proven general replacement for Couch's player state. [a-create-player] [a-media-capabilities] [s-store] [s-player-context] [s-time-feature] See the probe and adapter analysis below.

**Base UI is not required.** The official registry installed into a scratch project using Couch's `radix-mira` configuration. Its generated Video.js components use Video.js primitives, not Base UI or Radix. Keep the current shadcn foundation for this work; consider a separately scoped Base UI migration only for a concrete benefit established by a comparison. Official shadcn guidance explicitly keeps Radix supported and does not require migration. [v-installation] [shadcn-base] [c-components]

## Scope, evidence and preserved contracts

The audit covers every one of the **79 component reference pages** shipped in `@videojs/react@10.2.0`, their parts, relevant guides, API references, package exports and implementation. Documentation URLs below are the official public pages; implementation links are pinned to the release tag's commit, **`1042afd430d4d661606a71abf98a3ca87c2fb6be`**. The installed package documentation and pinned source settle version-specific questions where a broad API table is misleading. [release-tag] [s-react-exports]

Read Couch's [player design](design/player.md), [shell design](design/shell.md), [remote design](design/remote.md), renderer, picture follower, playback clock, session/control code, transport, settings and fullscreen implementation. Also read the task handoff at `/home/avoid/.t3/worktrees/couch/t3-0316ea76/docs/videojs-agent-handoff.md`; its requested direction is context, not a source for Video.js API claims. [c-player] [c-shell] [c-remote] [c-renderer] [c-picture] [c-clock] [c-session] [c-control] [c-remote-session] [c-transport] [c-settings] [c-fullscreen]

Open Sendspin work was inspected with `git show`, without merging:

| Open work | Inspected head | Use in this note |
| --- | --- | --- |
| [#918, Sendspin core](https://github.com/avoid-quest/couch/pull/918) | `4cf99e52eca8a04c55c2200021ee7727adc8c5fd` | Shared playback/receiver architecture. |
| [#919, Live audio](https://github.com/avoid-quest/couch/pull/919) | `16d9cf0ca36901c972dbac80ad962eccfe42ad1f` | Actor-specific controls, delivery and Live participation contracts. |
| [#920, Native capture](https://github.com/avoid-quest/couch/pull/920) | `3df745fab7351c8bc2d057266edeb4e3bd3fa735` | Native capture branch context; no capture/decoder redesign proposed. |

These are snapshots of open work, not assertions that it has landed. The Live-audio policy and ADR are the operative references for proposed future UI permissions. [ss-policy] [ss-protocol] [ss-adr] [ss-live] [ss-cases]

### Ownership and permission matrix

Video.js availability describes what its media interface/browser can do. It is **not authorization** to control a Couch programme, queue or another output. Rendering and action dispatch must both respect the applicable Couch policy. A `disabled` prop is presentation, not the enforcement boundary. [a-features] [a-media-capabilities] [ss-policy]

| Surface/mode | State and commands to preserve | Appropriate Video.js use |
| --- | --- | --- |
| Baseline/main, local playback | Session/source/connection determine capability; existing renderer owns native/HLS, split YouTube audio, MPEG-TS and WebRTC. Playback identity scopes the clock. | Standalone UI now; a projection may read existing observations and send existing commands. Do not mount a second media player. [c-renderer] [c-session] [c-clock] [c-control] |
| Baseline/main, remote controller | Remote session supplies selected playback and commands. The controller can have no local media or receiver buffer. | Standalone Slider/Thumbnail/Menu work directly. A projection is possible, but must not invent local ranges or treat its own browser capability as the remote target's. [c-remote-session] [c-transport] [a-media-capabilities] |
| Sendspin shared programme | Core owns programme/queue and delivery decisions. SDK receivers own audio clocks, buffering, decoding and recovery; the existing relaxed picture follower remains a follower. | UI reads supplied programme/clock observations. No Video.js clock becomes a scheduler or Sendspin authority. [ss-adr] [ss-cases] [c-picture] |
| Sendspin Direct | A controller need not be receiving. `controls.programme`, `queue`, `seek`, `speed`, delays and `leave` are actor-specific. | Gate each operation with published controls; do not derive rights from a local media element, attachment or route name. [ss-policy] [ss-protocol] |
| Sendspin Live listener | Join/leave participation and own volume/mute; no programme/queue/seek/Next control. Explicit device volume is separately authorized. | Hide timeline, rate and programme controls according to policy. Generic sliders can control an authorized device. Video.js LiveButton is **not** a join/leave button. [ss-policy] [ss-live] [v-live-button] |
| Local presentation | Fullscreen and any future PiP concern this window and its actual picture, even when programme control is remote. | Keep presentation commands distinct from programme commands; no remote PiP capability inferred from the controller browser. [c-fullscreen] [a-feature-pip] [a-feature-fullscreen] |

In the open policy, `programme = authorized && intent !== "live"`; queue follows programme, seek additionally needs seekability, speed excludes capture, and delay controls have their own restrictions. Explicit-device volume/mute and local participation are separate. Use that contract rather than reproducing a simplified branch-local approximation in a Video.js adapter. The Live 200 ms default and 5 ms encoder chunks are unchanged; this note introduces no timing or receiver-admission policy. [ss-policy] [ss-live]

## Complete public component inventory

The linked entries below cover all 79 reference pages. Compound components include their documented public parts. Most UI parts accept native element props/ref, `render`, and state-based `className`/`style`; the important additional props and behavioral constraints are listed rather than duplicating every HTML attribute. `render` changes composition/styling, not the state/action owner. Availability-sensitive buttons can disappear; an available explicitly disabled button can remain focusable with `aria-disabled`. Account for Couch's reserved slots and TV focus rules. [g-ui] [a-features] [c-player]

### Sliders, chapters and images

| Component/family | Public surface; state/action owner and media needs | Couch fit and verified limit |
| --- | --- | --- |
| [Slider][v-slider] | `Root`, `Track`, `Fill`, `Buffer`, `Thumb`, `Preview`, `Value`, `Thumbnail.Root/Image`. Scalar controlled `value`, `min`, `max`, `step`, `largeStep`, orientation, label, disabled, thumb alignment; React root also exposes `onValueChange`, `onValueCommit`, drag callbacks. Preview positioning and value formatting are UI concerns. No Player/media required. | **Adopt now**, with Couch draft/commit/cancellation and permissions. Use Preview/Value when they remove existing work. The docs' root prop table omits some React callbacks; the public root interface includes them. Buffer is presentational, not evidence of remote buffering. [s-slider-root] [s-slider-buffer] [c-range] |
| [Thumbnail][v-thumbnail] | `Root` selects supplied `thumbnails` by `time`; `Image` handles image display, sprite cropping, loading/error and resize. Supplied URL/coordinates, CORS/loading/fetch-priority options; no decoder or preview generation. | **Keep existing adoption**. Couch retains authenticated metadata/image access, cue selection, bounded caches and stale-source cancellation. A cue gap stays timestamp-only. [g-thumbnails] [c-player] |
| [TimeSlider][v-time-slider] | Root plus slider parts, `Chapters` and `ChapterTitle`. Reads time/playback features; buffer feature optional. Defaults include step 1 s, large step 10 s, `changeThrottle=100`, `pauseOnDrag=false`; drag callbacks are notifications. It calls `seek()` during dragging and on commit as needed. | **Do not replace the release-only Couch timeline with it.** Increasing throttle is not a commit-only mode. `min/max/value` appearing in inherited documentation do not provide a controlled external timeline: root binds media time itself. [s-time-slider] [c-range] |
| TimeSlider chapters and buffer | Chapters use store text tracks and slider context, normalize chapter intervals/gaps and expose segment/title rendering; no public supplied-`cues` prop. TimeSlider buffer comes from the media buffer feature. Generic Slider's Buffer can be styled from an independently known percentage. | Preserve Couch's chapter list/ticks and local-only buffer. Chapters may merit a later projection experiment, but they are **not** a standalone array-of-chapters primitive. Never manufacture `[0, end]` ranges on a remote controller. [s-chapters] [a-feature-buffer] [c-transport] |
| [VolumeSlider][v-volume-slider] | Volume feature owns `volume`, mute and availability; UI uses 0–100 while media uses 0–1. Step/large step/wheel step, orientation, label, disabled and drag callbacks; value changes and commits both call `setVolume`. Muted display is zero. | Use generic Slider now for Couch's volume interaction. The stock root does not expose an application-owned commit callback. Browser-local availability and auto-unmute policy also need reconciliation before a remote projection could use it. [s-volume-slider] [s-volume-feature] [c-range] |

### Player boundary, activity and readouts

| Component/family | Public surface; state/action owner and media needs | Couch fit and verified limit |
| --- | --- | --- |
| [Player][v-player] | Created/preset provider; no layout element. Public configuration comes from selected features, including metadata `title`/`poster`. Provides store, media, container and extension lifecycle. | Useful for a deliberately scoped projection; unnecessary around independent primitives. `createPlayer({features: []})` can supply an empty context, but creates no programme semantics. [a-create-player] [s-create-player] |
| [Container][v-player-container] | Layout element with native props/render/ref, accessible name/role/focus boundary; registers container, popup grouping and input/fullscreen coordination. Requires Player, not necessarily a DOM media element. Public `useContainerAttach` permits a custom container. | Potential later benefit, but one container boundary cannot silently replace Couch's app-wide fullscreen, focus and panel scope. Standalone menus/popovers do not need it. [a-use-container-attach] [c-fullscreen] [c-player] |
| [Controls][v-controls] | `Root`, `Content`, `Group`, `Backdrop`; `visibility="auto" | "always"`, feature state for visibility, inactivity, pointer type and controls locks. `requestControlsLock()` returns a release callback. | **Keep Couch's activity owner now.** Stock feature's idle delay is 2,000 ms with no public delay input, versus Couch's 4 s and keyboard/panel/recovery/sharing locks. Even `always` uses feature state. Hidden/inert/focus-return policy must still be preserved. [a-feature-controls] [s-controls] [c-player] |
| [Time][v-time] | `Group`, `Value`, `Separator`; type current/duration/remaining, label, negative sign and optional toggle. Reads time; renders semantic time values without announcing every tick. | Current/duration are candidates after projection. **Remaining is not drop-in:** Couch shows `(duration − position) / speed` and an end time; Video.js remaining is media time. Keep those semantics explicitly. [c-transport] [a-feature-time] |
| [Title][v-title] | Metadata title from Player; state/render styling, text owned by the component. Metadata can work without attached media. | Low-value substitution for Couch's rich title, collection/source trail, creator links and Details navigation. Keep those; do not flatten them merely to increase component count. [a-feature-metadata] [c-player] |
| [Poster][v-poster] | `Root`/`Image`, source/srcset, render/style and image load state; playback `started` controls visibility. Disappears once playback starts/seeks, not restored merely by pausing. | Not Couch's persistent audio/remote artwork. Consider only for a specific pre-play local-video poster if needed. [c-player] [c-remote] |

### Status, loading, errors and feedback

| Component/family | Public surface; state/action owner and media needs | Couch fit and verified limit |
| --- | --- | --- |
| [BufferingIndicator][v-buffering-indicator] | Store playback `waiting && !paused`, delayed by `delay` (default 500 ms), with visible state for styling. | Useful small projection candidate. Map only real waiting state; Couch reconnecting, offline, capture failure, blocked autoplay and device-unavailable are not all buffering. [a-feature-playback] [c-player] |
| [StatusAnnouncer][v-status-announcer] | Reads store snapshots; labels, close delay and `shouldAnnounce` for debounced actions. Announces play/pause, captions, fullscreen/PiP/rate immediately; seek/volume debounced 200 ms, cleared after 800 ms by default. Skips initial snapshot and normal clock ticks. | **High-value accessibility candidate after projection**, provided it replaces overlapping announcements and has intentional scope for remote/background changes. `shouldAnnounce` is not a universal filter for every immediate announcement. [s-announcer] [c-player] |
| [StatusIndicator][v-status-indicator] | Root/Value, labels, close delay, `deriveCustomStatus`; receives input action events from the player container, can map custom actions. | Does not automatically react to Couch/TanStack hotkeys, button clicks, arbitrary store calls or state changes. It predicts action feedback before completion; do not show a rejected remote operation as successful. [g-keyboard] [a-use-hotkey] |
| [SeekIndicator][v-seek-indicator] | Root/Value, direction/seconds and accumulated seek-action feedback; configurable labels/delay. Same input-event requirement. | Attractive feedback primitive only after an intentional input bridge/replacement; not a passive observer of remote seeks. [a-use-hotkey] [c-player] |
| [VolumeIndicator][v-volume-indicator] | Root/Fill/Value, volume level/mute/direction feedback; same action-event path. | Same restriction; correct device volume and confirmed/rejected actions matter. It is not a substitute for the device mixer. [a-use-hotkey] [ss-policy] |
| [ErrorDialog][v-error-dialog] | Store `error` and `dismissError`; alert-dialog parts, labels/content customization, focus and modal behavior. Container-scoped when inside a player container, page-modal outside it. | Keep Couch recovery. Dismissing a Video.js media error does not retry Core playback, reconnect, select another device or invoke mpv fallback. Generic dialog use is separately possible. [a-feature-error] [c-player] |

### Buttons, gestures and shortcuts

Buttons generally expose `disabled`, label customization and state-based rendering. Their action owner is the configured feature; styling with a shadcn button does not redirect that action to Couch. [g-ui] [a-features]

| Component/family | Additional public controls and state/action needs | Couch fit and verified limit |
| --- | --- | --- |
| [PlayButton][v-play-button] | Playback feature; play/pause/replay state and action. | Best first actionable projection candidate. Couch's button also means Retry/Replay through entry commands; keep those branches explicit, plus Stop/Next which have no equivalent stock buttons. [c-transport] [a-feature-playback] |
| [SeekButton][v-seek-button] | `seconds` (default +30, negative for back), time/seek action, clamping and labels. | Could serve deliberate ±10 s controls after projection, if wanted; do not add buttons to fill space or bypass `controls.seek`. [a-feature-time] [ss-policy] [c-player] |
| [MuteButton][v-mute-button] | Volume/mute states and availability; toggles feature mute, supplies volume-level styling. | Candidate only after target-specific volume policy. Unsupported/unavailable hiding may not match Couch slot behavior. Browser iOS volume restrictions must not disable a remote target's capability. [a-feature-volume] [c-player] |
| [CaptionsButton][v-captions-button] | Toggles text tracks, hides without usable tracks; supports menu-trigger composition. | Keep captions in Couch's gear and C shortcut; a new standalone CC slot is not needed. Stock action needs a text-track projection, not just labels. [a-feature-text-tracks] [c-player] |
| [PlaybackRateButton][v-playback-rate-button] | Rate feature, label formatting/menu-trigger behavior; otherwise cycles feature rates. | Not a drop-in replacement for Couch's speed choices/preferences. Stock rates are `[0.2, 0.5, 0.7, 1, 1.2, 1.5, 1.7, 2]`; formatting does not change that list. [s-rate-feature] [c-settings] |
| [LiveButton][v-live-button] | Live-edge/time/buffer state; seeks to live edge. | Appropriate only to a supported seekable live-stream window. **Never relabel it Join or Leave**: Couch Live participation has different actions and disallows programme seeking. [a-feature-live] [ss-policy] |
| [FullscreenButton][v-fullscreen-button] | Fullscreen feature, availability and request/exit action. | Defer. Stock behavior targets container/media; Couch deliberately requests fullscreen on `document.documentElement` so portalled sheets stay visible. A public custom-container hook does not by itself prove equivalent lifecycle and focus. [g-fullscreen] [c-fullscreen] |
| [PiPButton][v-pip-button] | PiP feature, actual local media capability/metadata; exits fullscreen when needed. | Optional future local-picture feature, not remote programme control. No extra decoder or hidden media element to obtain PiP. [g-pip] [a-feature-pip] [c-renderer] |
| [AirPlayButton][v-airplay-button] | Remote playback feature/platform support, device chooser and connection state. Safari output route. | Separate product/route work. This is not Couch's Linux AirPlay input or its remote controller; receiver access to the source and permissions must be designed. [g-casting] [ss-live] |
| [CastButton][v-cast-button] | Remote playback state and route prompt; GoogleCast extension supplies configurable receiver/source route. | Same separation. Connected Cast proxies playback to the receiver and suspends local playback. It must not silently compete with Sendspin/Couch delivery. [v-google-cast] [g-casting] [ss-adr] |
| [Hotkey / MediaHotkey][v-hotkey] | Keys, action, numeric value, player/document scope, disabled/repeat behavior. Built-in media actions use feature store. Public `useHotkey` accepts a custom `onActivate`, optional action name and value. | Potential later consolidation with Couch commands is real. Replace one registration path; never layer it on existing TanStack/TV shortcuts. Confirm first-TV-key, editable controls, nested overlays, repeat/toggle behavior and cancellation. [a-use-hotkey] [g-keyboard] [c-player] [c-shell] |
| [Gesture / MediaGesture][v-gesture] | Tap/double-tap, pointer/region filtering and action/value bindings; interactive targets excluded. Tap arbitration uses a 250 ms window. | Keep Couch's video-click/pause, double-click/fullscreen and phone tap visibility behavior until a deliberate migration passes those cases. Public tap/double-tap hooks exist for custom callbacks. [a-use-tap-gesture] [a-use-double-tap-gesture] [c-player] |

### Menus, selection and overlays

| Component/family | Public surface; state/action owner and media needs | Couch fit and verified limit |
| --- | --- | --- |
| [Menu][v-menu] | `Root`, `Trigger`, `Popup`, `Content`, `Item`, `RadioGroup`, `RadioItem`, `CheckboxItem`, `ItemIndicator`, `Group`, `GroupLabel`, `Separator`. Controlled/uncontrolled open with change/reason and completion callbacks; side/align/boundary positioning; popup keep-mounted. Generic radio value/change callbacks and item selection/disabled props. No media or Player required. | **Next adoption priority.** Nested content replaces the same popup, matching the gear's in-place views. Couch supplies tracks/rates/quality/chapters, commands and pending state. Preserve Add subtitles, save defaults, delays, Details and Back/focus recovery. Selection closes immediately in the probe, so asynchronous failure/pending policy needs explicit treatment. [c-settings] [c-player] |
| [CaptionsRadioGroup][v-captions-radio-group] | Root/Options/Value; label/disabled, formatting and `renderItem`; text-track feature supplies options, selected value and action, including Off. | Useful only with faithful text-track projection. Cannot simply supply Couch's options/value/onChange to replace feature ownership. Generic Menu.RadioGroup is the smaller immediate adoption. [a-use-captions-options] [c-settings] |
| [AudioTrackRadioGroup][v-audio-track-radio-group] | Same parts; audio-track feature supplies labels, options and action, availability when meaningful (>1 track). | Projection requires eventful lists and enabled setters. Feature selection writes every track's `enabled`; naïve forwarding can issue several Couch commands. Prefer generic group now. [s-audio-feature] [a-use-audio-track-options] |
| [QualityRadioGroup][v-quality-radio-group] | Same parts; quality feature, rendition options/Auto, label formatter and `renderItem`. | ABR rendition selection is not automatically Couch's provider quality/re-resolution policy. Preserve Couch labels, available source choices and async failure behavior through a generic group. [a-feature-quality] [a-use-quality-options] [c-settings] |
| [PlaybackRateRadioGroup][v-playback-rate-radio-group] | Same parts; feature-owned rates/value/action, `formatRate`, label/disabled and `renderItem`. | Formatter changes labels, not available speeds. Keep Couch's 0.5–2 choices and save-default action in generic Menu.RadioGroup. [s-rate-feature] [a-use-playback-rate-options] [c-settings] |
| [Popover][v-popover] | Root/Trigger/Popup/Arrow; open/defaultOpen/change/completion, hover/delays, side/align/boundary and modal setting. Standalone; top-layer Popover API/anchor positioning with fallback. | Candidate for a simple player tool popup after Menu. Do not assume parity with Radix anchor/portal/focus hooks. The documented `'trap-focus'` mode is **reserved for future use**, not a usable focus trap in 10.2.0. [radix-popover] [c-player] |
| [VolumePopover][v-volume-popover] | Popover composition aware of volume availability, Root/Trigger/Popup and state-based styling; commonly pairs MuteButton and VolumeSlider. | Not the multi-device Where it plays mixer. Generic Popover plus Couch-owned content is a better immediate fit; stock volume children inherit the projection limits above. [a-feature-volume] [c-player] |
| [Tooltip][v-tooltip] | Provider/Root/Trigger/Popup/Label/Shortcut/Arrow, shared opening/closing delays, side/align and shortcut display. Standalone. | **Useful optional polish** for actual Video.js controls and keyboard hints. It is visual-only (`role="presentation"`, no automatic `aria-describedby`); keep a real accessible name and avoid duplicating native `title` tooltips. Preserve touch/TV behavior. [c-player] |
| [Dialog][v-dialog], [AlertDialog][v-alert-dialog] | Root/Trigger/Backdrop/Popup/Title/Description/Close, controlled open and lifecycle/focus behavior; trap focus, inert surroundings, restore focus and handle Escape. No media required; application owns playback effects. | Sound standalone primitives, but current shadcn dialogs already solve this. Adopt only if a particular player-scoped dialog becomes simpler; do not pause programme playback merely because a local dialog opens. [c-player] [ss-policy] |
| [Icons][v-icons] | Optional SVG components and theme-specific variants; native SVG props. | Keep Couch's lucide vocabulary/targets unless a specific icon clearly improves comprehension. Icons are not a requirement for using Video.js components. [c-components] [c-player] |

### Media components and extensions

These components normalize actual media/engine/provider interfaces. Importing standalone UI does not require any of them. An adapter that reads Couch state is different from mounting a provider media component: the latter takes over a playback route. Optional peer dependencies and engine/source requirements are documented on each linked component page. [g-architecture] [g-media-sources] [c-renderer]

| Component/family | Public inputs/dependencies and verified scope | Couch decision |
| --- | --- | --- |
| [Video][v-video], [Audio][v-audio] | Native media props (`src`, playback attributes, tracks, refs); attach browser media to Player. | No new decoding capability. Do not mount duplicates alongside Couch renderers. A future deliberate wrapper conversion would need renderer lifecycle equivalence, not just matching JSX. [c-renderer] |
| [HlsVideo][v-hls-video], [HlsAudio][v-hls-audio] | SPF HLS path, media/source attributes and adapter interface; lightweight engine supports fMP4/CMAF rather than all hls.js formats. | Not a blanket HLS replacement: no MPEG-TS segments, raw ADTS or whole-segment AES-128 in this path. Keep current source coverage and PTS behavior. [g-migrate-v8] [c-renderer] |
| [HlsJsVideo][v-hlsjs-video] | Optional `@videojs/hlsjs-video`; native/MSE preference, structured source/type/DRM and resolution/engine configuration. DOM ref and media adapter ref have different meanings. | Technically closer to existing hls.js, but still no reason to migrate renderer ownership for a UI task. Preserve source mappings, split audio and recovery before considering it independently. [c-renderer] [c-picture] |
| [NativeHlsVideo][v-native-hls-video] | Native HLS only; browser source/metadata/tracks interface. | Coverage limited to browsers with native HLS; cannot replace Couch's fallback paths. [g-media-sources] [c-renderer] |
| [DashVideo][v-dash-video], [ShakaVideo][v-shaka-video] | Optional respective `@videojs/dash-video` / `@videojs/shaka-video` packages and engines; documented configuration APIs are unstable. | New engines are outside this task. No decoder/format expansion is necessary to adopt UI. [c-renderer] |
| [BackgroundVideo][v-background-video], [HlsBackgroundVideo][v-hls-background-video], [MuxBackgroundVideo][v-mux-background-video] | Autoplay/muted/loop background media. HLS background uses SPF; Mux background is an alias of that implementation, not a separate Mux analytics/metadata feature. | No current need. Do not use as a hidden preview generator or second video. [g-background-video] [c-player] |
| [MuxVideo][v-mux-video], [MuxAudio][v-mux-audio] | Optional Mux adapter packages; structured playback IDs/tokens, poster/storyboard/DRM source data; `/hls-js` and `/spf` engine choices. Analytics and Cast are opt-in extensions. | Provider-specific route/metadata integration, not a generic Couch player UI. Use provider assets only if already authorized and available; no preview generation. [g-media-sources] [c-player] |
| [CloudflareVideo][v-cloudflare-video] | Optional `@videojs/cloudflare-video`; Cloudflare Stream IDs/URLs and iframe-backed provider behavior. | A source route replacement, not a shortcut to style Couch controls. No need in this migration. [c-renderer] |
| [YouTubeVideo][v-youtube-video] | Optional `@videojs/youtube-video`, iframe API, IDs/URLs/source options. No PiP; iframe fullscreen uses provider chrome; caption availability follows playback. | Do not replace Couch's resolved YouTube streams, split audio or preview access with an embed. That changes capabilities/ownership. [c-renderer] [c-player] |
| [VimeoVideo][v-vimeo-video] | Optional `@videojs/vimeo-video`, provider iframe; rate range 0.5–2, caption names but not text cues, provider fullscreen. | Same source-change concern; track labels do not imply chapter/cue access. [c-renderer] |
| [PlayerJsVideo][v-playerjs-video] | Optional `@videojs/playerjs-video`; third-party iframe implementing Player.js protocol. No text tracks or buffer reports; rates require provider extension support. | Do not confuse Player.js with a generic remote Couch media projection. [a-media-capabilities] |
| [SpotifyAudio][v-spotify-audio] | Optional `@videojs/spotify-audio`, Spotify iframe; no settable volume/mute/rate/text tracks, signed-out music previews and provider queue behavior. | Cannot preserve the capabilities of Couch's own source paths merely by wrapping the embed. [c-renderer] |
| [TikTokVideo][v-tiktok-video] | Optional `@videojs/tiktok-video`, portrait iframe (minimum 325×578); mute supported but not volume level/rate/text tracks. Changing controls/loop rebuilds embed. | Not a general playback UI or renderer substitute. [c-player] |
| [TwitchVideo][v-twitch-video] | Optional `@videojs/twitch-video`, iframe and required parent-host rules; no applied rate, provider fullscreen. | Provider route work only; no change proposed. [c-renderer] |
| [WistiaVideo][v-wistia-video] | Optional `@videojs/wistia-video`, Wistia SDK/web component; on-demand, no live/remote/PiP. Documentation notes upstream error telemetry. | Source-specific integration with its own behavior; unnecessary for existing UI adoption. [c-renderer] |
| [GoogleCast][v-google-cast] | Optional `@videojs/google-cast` extension; receiver configuration, source/content type/stream type/custom data; receiver fetches media URL. | Separate output-routing feature. Existing Couch authentication/header URLs may not be fetchable by the receiver. No automatic Sendspin mapping; keep this out of the UI migration. [g-casting] [ss-adr] |
| [MuxData][v-mux-data] | Optional `@videojs/mux-data` extension; `envKey`, metadata, domain/cookie/debug/SDK options. | Analytics, not a playback-control primitive; no present requirement. [g-mux-data] |

### Presets and all skin families

Presets export configured Players/hooks, feature bundles, media and skins. The public video/audio/live-video/live-audio/background paths are conveniences, not Couch permission models. Full skins include layout and behavior; their internal pieces are not a supported import surface. Source installation permits editing the copied source, but does not make private package imports safe. [g-presets] [g-skins] [g-customize-skins]

| Preset | All component reference pages in this family | Couch fit |
| --- | --- | --- |
| Video | [VideoSkin][v-video-skin], [VideoNeutralSkin][v-video-neutral-skin], [VideoCompatSkin][v-video-compat-skin], [VideoScaffoldSkin][v-video-scaffold-skin] | Default/Neutral are styled arrangements; Compat targets broader compatibility; Scaffold removes decoration/transitions, not feature-owned controls. None is a placement/permission-preserving drop-in. [a-preset-video] [c-player] |
| Audio | [AudioSkin][v-audio-skin], [AudioNeutralSkin][v-audio-neutral-skin], [AudioCompatSkin][v-audio-compat-skin], [AudioScaffoldSkin][v-audio-scaffold-skin] | Same four choices; audio preset lacks several video features. Couch shares transport/tools between artwork and video, so select primitives rather than install a parallel layout. [a-preset-audio] [c-player] |
| Live video | [LiveVideoSkin][v-live-video-skin], [LiveVideoNeutralSkin][v-live-video-neutral-skin], [LiveVideoCompatSkin][v-live-video-compat-skin], [LiveVideoScaffoldSkin][v-live-video-scaffold-skin] | Live presets omit timeline/rate and some groups, add go-live behavior. Their media-stream model does not establish Couch Live listener rights. [a-preset-live-video] [ss-policy] |
| Live audio | [LiveAudioSkin][v-live-audio-skin], [LiveAudioNeutralSkin][v-live-audio-neutral-skin], [LiveAudioCompatSkin][v-live-audio-compat-skin], [LiveAudioScaffoldSkin][v-live-audio-scaffold-skin] | Same authority mismatch; keep join/leave and own-device volume explicit. [a-preset-live-audio] [ss-policy] |
| Background | [BackgroundVideoSkin][v-background-video-skin] | Minimal layout/no controls and empty background feature bundle. Not a substitute for Couch artwork or player chrome. [a-preset-background] |

This accounts for **17 skins**, all media/extension pages, and every UI page above; TimeSlider chapters, Slider thumbnail/buffer parts and MediaHotkey/MediaGesture are included under their owning reference pages.

## Public extension paths: what can actually be composed

### API and feature families beyond the component pages

The documented `createPlayer({features})` overload accepts custom feature compositions. Preset bundles are arrays that can be extended or reduced. `usePlayer()` returns the store without subscribing; `usePlayer(selector)` subscribes to selected state. `useStore`, `useSelector`, `useSnapshot` and `createSelector` expose the underlying subscription/selection tools. This is a genuine public composition surface, not a requirement to adopt a full skin. [a-create-player] [a-features] [a-player-store] [a-use-player] [a-use-store] [a-use-selector] [a-use-snapshot] [a-create-selector]

| API family | Relevant public ownership and Couch implication |
| --- | --- |
| Playback, source, time, buffer | `paused`, `ended`, `waiting`, `started`, `play/pause`; `currentSrc/canPlay`; `currentTime/duration/seeking/seek`; `buffered/seekable`. A projection needs the events and readable properties each selected feature expects, not just `play()`. Preserve clock identity and distinguish a source capability from a permission. [a-feature-playback] [a-feature-source] [a-feature-time] [a-feature-buffer] [c-clock] |
| Volume, playback rate | Volume and mute have separate availability/actions; playback rate exposes its fixed allowed rates/action. Both write to the attached media interface. Device authority, Couch volume policy and rate preferences need explicit mapping. [a-feature-volume] [a-feature-playback-rate] [ss-policy] |
| Text tracks, audio tracks, quality | Eventful lists, selected tracks/renditions and actions; `useCaptionsOptions`, `useAudioTrackOptions`, `useQualityOptions`, `usePlaybackRateOptions` derive feature-owned options. They do not convert arbitrary Couch arrays into standalone option groups. [a-feature-text-tracks] [a-feature-audio-track] [a-feature-quality] [a-use-captions-options] [a-use-audio-track-options] [a-use-quality-options] [a-use-playback-rate-options] |
| Controls, metadata, error | Controls activity/locks; title/poster configured through Player; media error and dismiss action. Metadata inputs are supported configuration; arbitrary controlled `paused/currentTime/volume` Player props are not. Keep Couch recovery separate. [a-feature-controls] [a-feature-metadata] [a-feature-error] [v-player] |
| Fullscreen, PiP, remote playback, orientation lock | Local presentation/browser/device-route actions and availability. Orientation lock is opt-in, associated with fullscreen; it does not establish desktop shell/window policy. [a-feature-fullscreen] [a-feature-pip] [a-feature-remote-playback] [a-feature-orientation-lock] |
| Live and stream type | Live edge/window metadata and stream-type state. Opt-in stream-type feature can drive UI; neither grants programme rights or joins/leaves a Couch session. [a-feature-live] [a-feature-stream-type] [ss-policy] |
| Container/media access | `useMedia`, `useContainer`, optional player/container hooks and `useContainerAttach`; media capability guards and exported interface types. Guard success means member support, not current readiness or authorization. [a-use-media] [a-use-container] [a-use-optional-player] [a-use-optional-container] [a-use-container-attach] [a-media-capabilities] |
| Custom UI/input | `useButton`, `useSlider`, `useHotkey`, `useHotkeyShortcut`, tap/double-tap hooks, `renderElement`, `mergeProps`, `useComposedRefs`, lifecycle/latest-ref helpers. Useful if a genuine primitive gap remains; prefer actual components over rebuilding equivalent DOM merely to use a hook. [g-build-component] [a-use-button] [a-use-slider] [a-use-hotkey] [a-use-hotkey-shortcut] [a-use-tap-gesture] [a-use-double-tap-gesture] [a-render-element] [a-merge-props] [a-use-composed-refs] [a-use-destroy] [a-use-latest-ref] |
| Source resolution and errors | `resolveAdapterType` and `resolveMimeType` are pure URL/type resolution, not source extraction or renderer/capability probes; media error codes describe Video.js media failures. Keep Couch provider resolution and recovery. [a-resolve-adapter-type] [a-resolve-mime-type] [a-error-codes] [c-renderer] |
| Localization | I18n provider/factory, translator/locale hooks, phrase catalog, register/load/resolve/find/query helpers and text translation/type guards. Use public labels/locale inputs when adopting components; do not duplicate a second application locale authority or import internal phrase implementation. [g-internationalization] [a-i18n-provider] [a-create-i18n] [a-use-translator] [a-use-locale] [a-translation-phrases] |
| v8 legacy layer | Compatibility options, initialization/player lookup, component and plugin wrappers are migration aids for existing v8 integrations. Couch is adopting v10 primitives, so this would add an unnecessary second abstraction. [a-vjs8-legacy-init] [a-vjs8-legacy-options] [a-vjs8-legacy-get-player] [a-vjs8-legacy-component] [a-vjs8-legacy-plugin] |

Video.js explicitly leaves preference storage and per-profile settings to the application. Its guide demonstrates subscriptions and restoration through actions after attachment; it does not provide a competing preference service. Keep Couch's save-default actions and target/profile semantics. Do not copy the guide's local-storage example into a remote controller where restoring a browser preference would unexpectedly command another device. [g-user-preferences] [c-settings] [ss-policy]

### Custom feature authoring has an important boundary

The generic factory and composition docs should not be read as a stable arbitrary-feature authoring toolkit. In this release, `definePlayerFeature` is explicitly `@internal`; so are `defineSlice`/slice authoring types and `createStore`. Some internal symbols are re-exported through public package entry points. Being importable is not the same as being supported. React's `usePlayerContext`, `useMediaAttach` and extension registrar also carry internal annotations. Do not author a Couch feature by casting a plain object to a slice, fabricating brands, mutating `$state`, replacing store actions or calling private context setters. [s-feature] [s-slice] [s-store] [s-player-context] [s-react-exports]

The architecture and media-capability docs describe a common Media interface with optional capabilities. The minimum is `play()` plus EventTarget-like methods; optional groups include seek/source/volume, track lists, buffer ranges, dimensions, live metadata and remote playback. That interface can describe something other than an HTML media element. However, the documentation does not supply a complete supported React remote-controller adapter recipe, nor a public equivalent of the internal media-registration hook. [g-architecture] [a-media-capabilities] [s-player-context]

### The viable public projection experiment

There is a narrower path worth acknowledging: the store returned by typed `usePlayer()` exposes **`attach({media, container})`**, returning a detach function. `BaseStore.attach` and the player target type are public, not marked internal. A structural EventTarget object can project Couch observations through media getters and translate writes/methods into existing Couch commands. No private imports or store patches are needed for that experiment. [s-store] [s-player-target] [a-create-player]

The desired direction of data would be:

```text
Couch session + PlaybackClock (existing authority)
    -> projection getters/events -> selected Video.js features -> actual components
actual component action
    -> projection method/setter -> existing authorized Couch command
    -> authoritative observation returns through the first path
```

This describes an experiment, not a second playback engine. The object must not extrapolate a competing clock, issue renderer commands directly, invent buffer/track/quality capabilities, or treat command acceptance as an authoritative observation. Choose a playback/output identity and discard pending work on identity changes. [c-clock] [c-session] [c-control] [ss-policy] [ss-adr]

There are several exact limits:

1. **Manual store attachment does not register React media context.** In the probe, `useMedia()` remains `null`. Player's extension coordinator follows its own media context, so packaged extensions will not magically activate. Lifecycle/detach, container changes, Strict Mode/effect re-setup and a destroyed store need explicit qualification; the normal provider has recovery logic gated by its media state. Do not fill this gap with internal `setMedia`. [s-player-context] [s-create-player]
2. **Stock time state is optimistic.** `seek()` writes target time and `seeking=true` before forwarding to media; normal timeupdates are suppressed until seek settlement. It awaits a later `seeked`; source `emptied` cancels superseded work. The feature also samples `media.currentTime` with requestAnimationFrame while playing. That is UI sampling rather than a scheduler, but it is extra work and can display a target instead of Couch's observed clock. Keep the existing timeline independent unless that behavior is explicitly acceptable and correctly reconciled. [s-time-feature] [c-clock] [c-range]
3. **A setter cannot carry Couch's asynchronous result contract by itself.** A denied, disconnected, superseded or late seek must not leave Video.js stuck seeking or falsely advance the observed clock. `play()` can return a promise, but pause/volume/track setters have different completion semantics. Specify how authoritative state and settlement events relate; do not emit a fake successful event solely to release a promise. [a-media-capabilities] [s-time-feature] [c-control]
4. **Stock features encode local policy.** Volume feature probes a newly created browser video for writable volume, automatically unmutes on nonzero volume, and restores 0.25 when unmuting at zero. This can be wrong for a remote target or Couch mixer. Playback observations expect pause/seek/source capabilities. Rate choices and multi-track writes have the mismatches inventoried above. A larger projection may become more code than the standalone controls it replaces. [s-volume-feature] [s-playback-feature] [s-rate-feature] [s-audio-feature]
5. **Full feature bundles would advertise the wrong surface.** Request only needed features and only real capability members. Even a technically available control must pass Couch's current actor/target permission check again at dispatch. A Live listener must not acquire `seek()` simply because an interface supplies `currentTime`. [a-features] [a-media-capabilities] [ss-policy]

### Bounded microprobes and measurements

Private scratch: `/tmp/couch-videojs-components.2SMfhz`. The adapter probe used jsdom 26.1, React 19.2.8 and Video.js 10.2.0. It rendered Player, actual PlayButton/Time.Value/Title, and three selector observers; attached an EventTarget object with recording setters/methods; and supplied media-like observations. No Couch process, browser media playback, decoder or source network request was used. Scratch files are not committed and are not durable test fixtures.

| Probe step | Observed result |
| --- | --- |
| Initial attachment | `paused=true`, time 10, volume 0.8, title supplied; PlayButton label “Play”, Time.Value “0:10”, `useMedia()=null`, zero audio/video DOM elements. |
| Click actual PlayButton | Exactly one recorded `play`; paused stayed true until an observation would change it. |
| `store.seek(60)` | Exactly one recorded seek; store time immediately 60 and seeking true, projected observation still 10. |
| Incoming timeupdate with observation 12 | Store stayed at optimistic 60. |
| Subsequent `seeked` | Store reconciled to 12, seeking false. |
| `store.setVolume(0.4)` | One volume write; displayed observation stayed 0.8. |
| 200 distinct clock updates, each flushed separately | Time selector component rendered 200 times; paused selector 0; volume selector 0. Counts exclude initial mount. |

The result confirms the public attachment path and selector isolation, and directly demonstrates optimistic seek suppression. It does **not** demonstrate latency, production frame rates, real-browser focus/layout, TV behavior, decoder savings, rejection handling or seamless provider lifecycle. The script used permissive TypeScript variables for instrumentation and was executed, not used as proof of a production adapter's static interface completeness. Primary implementation evidence: [s-store] [s-create-player] [s-time-feature] [a-use-store]. Scratch results: `adapter-probe-result.json` and `registry-probe/adapter-probe.tsx`.

A second scratch React/jsdom probe rendered Menu.RadioGroup/RadioItem, Popover and Tooltip **without Player/media**. Opening Menu exposed two radio items; selecting “fast” invoked the supplied callback and collapsed the trigger; the closing-transition DOM remained temporarily mounted. Popover opened; zero audio/video elements existed. This proves basic independent composition, not real-browser focus/anchor/fullscreen behavior. Primary API evidence: [v-menu] [v-popover] [v-tooltip]. Results: `standalone-probe-result.json` and `registry-probe/standalone-probe.tsx`.

### Honest choice between composition and projection

| Approach | Benefit | Cost/limit | Recommendation |
| --- | --- | --- | --- |
| Standalone actual components with Couch props/callbacks | Immediate Slider, Thumbnail, Menu/radio groups, Tooltip and overlays; works local/remote; preserves clock/rights with few new concepts. | Couch still owns labels, transport semantics and settings data. Does not automatically unlock stock PlayButton/TimeSlider/feature groups. | **Default now.** Highest reuse per added mechanism. [v-slider] [v-menu] [c-control] |
| Small public media projection with selected stock features | Real PlayButton, Time, BufferingIndicator, StatusAnnouncer and potentially more; typed selectors and consistent media state vocabulary. No local decoder required. | Event/lifecycle mapping, optimistic state, local assumptions, missing React media context and extension integration. | **Bounded next experiment**, with explicit success criteria. Promote only if it removes more glue than it adds and preserves observed state/rights. [s-store] [s-player-context] [s-time-feature] |
| Custom Couch feature replacing stock state/actions | Could theoretically map exact commands/observations without media emulation. | Supported composition exists, but feature/store authoring helpers are internal in 10.2.0. | **Reject for this version** under the public-only requirement; revisit if upstream publishes a stable authoring API. [s-feature] [s-slice] |
| Mount existing native element into a second full player/replace renderer | Automatic feature/media integration and extension support. | Competing commands/listeners, source lifecycle changes, native/engine mismatch; cannot serve a media-less remote controller by itself. | **Not this task.** Never introduce a hidden media element as a UI-state proxy. [g-architecture] [c-renderer] [c-remote-session] |

## Official shadcn registry and Base UI assessment

### What the CLI and generated source actually do

The pinned Video.js CLI was run in private scratch with explicit existing-project, React, video/default skin, HTML5 video, Tailwind, Bun and no-extension choices:

```sh
bunx @videojs/cli@10.2.0 agents init --method shadcn --framework react \
  --project existing --preset video --skin default --media html5-video \
  --extensions none \
  --source-url https://stream.mux.com/BV3YZtogl89mg9VcNBhhnHm02Y34zI1nlMuMQfAbl3dM/highest.mp4 \
  --package-manager bun --template vite --styling tailwind
```

This produces instructions; the sample URL was not played. The generated instructions recommend `shadcn init --base base --preset nova` **only when `components.json` is absent**. They explicitly say the registry source is current while package installation is versioned. Existing Couch already has `components.json`. No new initializer/theme rewrite was run in Couch. [v-installation] [c-components]

The registry namespace is `https://shadcn.videojs.org/r/react/{name}.json`. The actual `@videojs/video` add was then executed in a disposable project using Couch's `radix-mira` configuration and **shadcn 4.21.0**, with no Base UI migration. Results:

- Installation succeeded. Generated source: **45 files / 119,843 bytes**: 44 Video.js files plus a class-name helper, excluding package dependencies and global stylesheet changes. This is source footprint, not bundled/gzipped size or runtime cost.
- Added dependencies were `@videojs/react ^10.2.0`, `@videojs/core ^10.2.0` and `cn ^0.5.0`; React was already installed. Generated Video.js components had **no Base UI or Radix imports**. They wrap actual Video.js components and include their own button/icon/styling source.
- The fetched root `video.json` SHA-256 was `d670e31cb54d2467ceaeed85d14316e14b8c674b2bcbab38e82c60bed03159e7`. This identifies that payload only, not every transitive registry item. The registry is mutable; pinning the CLI is not a lock on future generated source.

Evidence: official [registry payload][registry-video], [installation guide][v-installation], scratch `video-registry.json`, `cli-output.md`, `shadcn-add.log` and `registry-probe/src`. These observations justify **selecting components/source deliberately**, not bulk installing the full skin over Couch. The full source brings a different layout, icons, control choices and default behavior that Couch does not need. [g-customize-skins] [c-player]

### Required versus optional migration

Official shadcn's July 2026 announcement makes Base UI the default **for new projects**, continues Radix support and says no migration is necessary. Both can coexist during a gradual migration. Video.js's own `render` composition prop resembling Base UI is not evidence that it depends on Base UI. [shadcn-base] [shadcn-button] [g-ui]

Baseline inventory found **24 Radix-importing UI wrapper files**, and **78 `asChild` occurrences across 46 TSX files**. These counts describe the current code surface, not an estimate that all usages need changing. A wholesale migration would require more than replacing imports:

| Area | Current/target differences and required qualification |
| --- | --- |
| Composition/button semantics | Radix `asChild` versus Base UI `render`; ref and event merging, preventing default, native/disabled button behavior and `nativeButton` for non-button rendering. Check wrappers before composing a Video.js Trigger with a shadcn Button; no nested buttons. [base-composition] [shadcn-button] [c-ui-button] |
| Select | Base UI value/null/generic typing, `items` labeling, `onValueChange(value, eventDetails)`, Positioner/Popup/Portal and scroll parts, alignment with selected item. Match selected labels, keyboard/typeahead, empty values, chosen-item focus and scroll behavior. [base-select] [c-ui-select] |
| Popover/focus | Current Radix open/close autofocus, Escape and outside-interaction hooks differ from Base UI `initialFocus`/`finalFocus`, reason-bearing open-change/cancellation and touch defaults. Match pointer-close-to-picture versus keyboard-close-to-trigger behavior. [radix-popover] [base-popover] [c-ui-popover] [c-player] |
| Portal/fullscreen | Base UI adds explicit Positioner/Portal structure and positioning options; inherited scale/styles and portal container matter. Couch fullscreens the document to include portalled sheets. Test nested sheets/dialogs/menus in fullscreen, not just a popup in a page. [base-popover] [base-select] [c-fullscreen] |
| Dismissal and keyboard | Escape/Back hierarchy, menu return focus, async item errors, TV first key, roving focus and app overlay detection must remain coherent across libraries. Video.js menus also introduce their own top-layer/fallback model. [v-menu] [g-browser-support] [c-player] [c-shell] [c-settings] |
| Styling and scale | Existing wrappers/CSS use `--radix-*`, `[data-state]`, `data-slot` and interface `zoom`. Base UI state attributes/positioning variables differ. Preserve flat Couch surfaces, targets, scrolling and 320 px layout. [c-ui-select] [c-ui-popover] [c-css] [c-player] |

No measured benefit in this task offsets that migration surface. Keep it optional. A future focused comparison could justify migrating one primitive for a demonstrated interaction defect, but “Video.js uses Base UI” is not a valid reason. [shadcn-base] [registry-video] [c-components]

## Performance, browser support and qualification

Keep fast-changing clock, hover/draft state and infrequently changing session/menu data separate. Couch already isolates `PlaybackClockContext` from session snapshots and the thumbnail image from pointer timestamp updates. Preserve that architecture when introducing components; do not promote every pointer sample into a global player/session object. [c-clock] [c-session] [c-player]

Use narrowly selected subscriptions for state a component displays; use the no-selector store access for actions. Video.js documents shallow equality for `useStore` selections and exposes a custom comparator; selecting the entire store state forfeits that isolation. The 200/0/0 probe is evidence of selector behavior for distinct paused-state timeupdates, not evidence that the full player has no rerenders. [a-use-player] [a-use-store] [a-use-selector]

Official React guidance supports the following implementation discipline:

- Compute labels/options from existing data during rendering. Avoid effect-driven duplicate derived state and feedback loops between Couch and Video.js. Effects are appropriate for attaching/detaching an external store or EventTarget subscription, with complete cleanup. [react-effects]
- External-store snapshots must be stable/cached when data is unchanged, and subscriptions must return cleanup; use the documented selector/store integration rather than an effect plus `setState` for every clock tick. [react-store] [a-use-store]
- `memo` is an optimization, not a correctness guarantee or a shield against context changes. Stable props matter; only memoize a measured/reasonable expensive boundary such as decoded thumbnail presentation, not every wrapper indiscriminately. [react-memo] [c-player]
- Do not call rAF sampling a clock-authority improvement. Stock time feature samples its media getter; Couch's existing clock remains the source, with no new interpolation/synchronization loop. Measure net work before adding it to a continuously playing surface. [s-time-feature] [c-clock] [c-picture]

Video.js documents Chrome/Edge 111+, Firefox 121+, Safari/iOS 16.4+ as its browser baseline. Native Smart TV browsers are not supported; Couch's Electron TV presentation is a different environment and still needs remote/focus testing. Registry **plain CSS** retains `@scope` and needs Chrome/Edge 118+, Firefox 146+, Safari/iOS 17.4+ unless flattened; registry Tailwind versions follow the lower baseline. Popover/tooltip/menu fallback inside the player can clip content on older supported browsers without the top layer. These are documented limits, not reasons to claim all Couch clients fail or to assume every popup works unchanged. [g-browser-support]

For any adoption, qualify meaningful behavior rather than snapshotting implementation details: local and remote/no-media, live permission loss, source replacement mid-interaction, failed/rejected commands, keyboard/TV/phone interactions, focus restoration, fullscreen portals, long track lists and 320 px layout. Preserve every existing renderer/source feature and run only isolated scratch instances with their own data/port if runtime work is later required. This research did not run installed Couch. [c-player] [c-remote] [c-renderer] [ss-policy]

## Prioritized adoption roadmap

1. **Completed: actual generic Slider and Thumbnail.** Add only useful Slider Preview/Value/Buffer parts. Acceptance: one authorized seek on release, local drafts/cancellation, no hover seeks, stale-identity/permission rejection, keyboard ten-second steps, local-only buffer and no generated previews. [v-slider] [v-thumbnail] [s-slider-root] [c-range] [c-player]
2. **Convert the Playback gear to actual Video.js Menu/generic RadioGroup in a focused change.** Keep its slot, width, flat surface, in-place navigation and all current actions. Use Couch-provided selected values/options and existing commands. Explicitly verify chosen-item focus, Back/Escape nesting, long scrolling lists, async selection failure, file upload and return focus. This is the largest overlooked public primitive opportunity. If the menu cannot retain upload/delay interactions cleanly, use standalone Popover for the outer surface and Menu only where its menu semantics fit. [v-menu] [v-popover] [c-settings] [c-player]
3. **Optionally add Video.js Tooltip/Shortcut and a simple Popover.** Keep accessible names, avoid duplicate `title`, preserve presentation scale/placement and test top-layer/fullscreen behavior. No Base UI migration prerequisite. Do not replace dialogs/mixer merely for library uniformity. [v-tooltip] [v-popover] [g-browser-support] [registry-video] [c-player]
4. **Run a strictly bounded public projection spike for PlayButton, BufferingIndicator and StatusAnnouncer; consider Time current/duration only.** Compare total code and behavior against standalone composition. Required demonstrations: zero additional media elements; actual components; no private imports/store writes; correct local/remote permissions; Retry/Replay preserved; observation/command separation; rejection/disconnection/source-switch cleanup; no duplicate announcements; React lifecycle qualification. Keep TimeSlider, volume/track policy, Cast and extensions out of the first spike. Reject the spike if state emulation becomes broader than the UI it replaces. [a-create-player] [s-store] [s-player-context] [s-time-feature] [v-play-button] [v-buffering-indicator] [v-status-announcer] [c-transport] [ss-policy]
5. **Only then evaluate input indicators, keyboard/gesture consolidation, chapters or local PiP against a concrete UX need.** Each has useful public parts but needs an explicit bridge/behavior decision. No duplicate hotkey registrations, fake input events, new decoder or shift in clock/programme ownership. Keep the overall button placement and update design documentation with any eventual implementation. [v-status-indicator] [a-use-hotkey] [v-gesture] [v-time-slider] [v-pip-button] [c-player] [ss-adr]

### Rejected options and exact reasons

| Option | Decision and reason |
| --- | --- |
| Treat all useful Video.js UI as requiring a local `<video>` | Rejected: standalone primitives and the no-media attachment probe disprove this. Public media interfaces are capability-based. [a-media-capabilities] [v-menu] [s-store] |
| Treat projection as already solved | Rejected: context media stays null, extensions/provider lifecycle are not integrated, stock seek suppresses observations, target volume/track semantics differ. Probe scope is explicitly limited. [s-player-context] [s-create-player] [s-time-feature] [s-volume-feature] |
| Stock TimeSlider configured to seek only on release | Not supported by this public root in 10.2.0; throttled drag seeks are built in. Use actual generic Slider. [s-time-slider] [s-slider-root] |
| Stock VolumeSlider as a callback-driven device mixer slider | No external commit-owner seam in its public root; it calls the feature on change and commit and inherits browser-local volume policy. [s-volume-slider] [s-volume-feature] |
| Private Couch feature/store/context patches | Explicitly internal authoring/registration surfaces, even where re-exported; violates the public-only requirement and creates duplicate authority risks. [s-feature] [s-slice] [s-player-context] |
| Full skin installation or broad Base UI migration first | Registry installs without Base UI; neither full layout nor a foundational migration is needed for component adoption. It adds unrelated layout/interaction work. [registry-video] [shadcn-base] [c-player] |
| SPF/embed/other-engine replacement to obtain the controls | Source capability and ownership changes, including documented HLS/embed limits; UI components are separable. [g-architecture] [g-media-sources] [g-migrate-v8] [c-renderer] |
| Live preset/LiveButton as Couch Live authority | Streaming live-edge UI is not listener participation; violates open programme/seek rights. [v-live-button] [ss-policy] |
| AirPlay/Cast as a free remote-controller integration | These establish output routes with receiver URL/network and playback ownership requirements. They do not implement Couch sessions/Sendspin. [g-casting] [v-google-cast] [ss-adr] |
| Replace rich title, persistent artwork, recovery or remaining-time semantics for component count | Loses meaningful Couch behavior; Title/Poster/ErrorDialog/Time have narrower contracts. [v-title] [v-poster] [v-error-dialog] [v-time] [c-player] [c-transport] |

The recommended integration boundary is concrete: Video.js owns selected UI mechanics; Couch keeps programme, clock, source, device rights and commands. A later adapter is justified only by verified reuse beyond what the standalone primitives already provide. [g-architecture] [c-control] [c-clock] [ss-adr]


## Sources

Official documentation links describe the public interfaces; pinned implementation and Couch links identify the audited behavior. Scratch measurements above are local experiments, not upstream performance claims.

[a-create-i18n]: https://videojs.org/docs/framework/react/reference/api/create-i18n
[a-create-player]: https://videojs.org/docs/framework/react/reference/api/create-player
[a-create-selector]: https://videojs.org/docs/framework/react/reference/api/create-selector
[a-error-codes]: https://videojs.org/docs/framework/react/reference/api/error-codes
[a-feature-audio-track]: https://videojs.org/docs/framework/react/reference/api/feature-audio-track
[a-feature-buffer]: https://videojs.org/docs/framework/react/reference/api/feature-buffer
[a-feature-controls]: https://videojs.org/docs/framework/react/reference/api/feature-controls
[a-feature-error]: https://videojs.org/docs/framework/react/reference/api/feature-error
[a-feature-fullscreen]: https://videojs.org/docs/framework/react/reference/api/feature-fullscreen
[a-feature-live]: https://videojs.org/docs/framework/react/reference/api/feature-live
[a-feature-metadata]: https://videojs.org/docs/framework/react/reference/api/feature-metadata
[a-feature-orientation-lock]: https://videojs.org/docs/framework/react/reference/api/feature-orientation-lock
[a-feature-pip]: https://videojs.org/docs/framework/react/reference/api/feature-pip
[a-feature-playback]: https://videojs.org/docs/framework/react/reference/api/feature-playback
[a-feature-playback-rate]: https://videojs.org/docs/framework/react/reference/api/feature-playback-rate
[a-feature-quality]: https://videojs.org/docs/framework/react/reference/api/feature-quality
[a-feature-remote-playback]: https://videojs.org/docs/framework/react/reference/api/feature-remote-playback
[a-feature-source]: https://videojs.org/docs/framework/react/reference/api/feature-source
[a-feature-stream-type]: https://videojs.org/docs/framework/react/reference/api/feature-stream-type
[a-feature-text-tracks]: https://videojs.org/docs/framework/react/reference/api/feature-text-tracks
[a-feature-time]: https://videojs.org/docs/framework/react/reference/api/feature-time
[a-feature-volume]: https://videojs.org/docs/framework/react/reference/api/feature-volume
[a-features]: https://videojs.org/docs/framework/react/guides/features
[a-i18n-provider]: https://videojs.org/docs/framework/react/reference/api/i18n-provider
[a-media-capabilities]: https://videojs.org/docs/framework/react/reference/api/media-capabilities
[a-merge-props]: https://videojs.org/docs/framework/react/reference/api/merge-props
[a-player-store]: https://videojs.org/docs/framework/react/reference/api/player-store
[a-preset-audio]: https://videojs.org/docs/framework/react/reference/api/preset-audio
[a-preset-background]: https://videojs.org/docs/framework/react/reference/api/preset-background
[a-preset-live-audio]: https://videojs.org/docs/framework/react/reference/api/preset-live-audio
[a-preset-live-video]: https://videojs.org/docs/framework/react/reference/api/preset-live-video
[a-preset-video]: https://videojs.org/docs/framework/react/reference/api/preset-video
[a-render-element]: https://videojs.org/docs/framework/react/reference/api/render-element
[a-resolve-adapter-type]: https://videojs.org/docs/framework/react/reference/api/resolve-adapter-type
[a-resolve-mime-type]: https://videojs.org/docs/framework/react/reference/api/resolve-mime-type
[a-translation-phrases]: https://videojs.org/docs/framework/react/reference/api/translation-phrases
[a-use-audio-track-options]: https://videojs.org/docs/framework/react/reference/api/use-audio-track-options
[a-use-button]: https://videojs.org/docs/framework/react/reference/api/use-button
[a-use-captions-options]: https://videojs.org/docs/framework/react/reference/api/use-captions-options
[a-use-composed-refs]: https://videojs.org/docs/framework/react/reference/api/use-composed-refs
[a-use-container]: https://videojs.org/docs/framework/react/reference/api/use-container
[a-use-container-attach]: https://videojs.org/docs/framework/react/reference/api/use-container-attach
[a-use-destroy]: https://videojs.org/docs/framework/react/reference/api/use-destroy
[a-use-double-tap-gesture]: https://videojs.org/docs/framework/react/reference/api/use-double-tap-gesture
[a-use-hotkey]: https://videojs.org/docs/framework/react/reference/api/use-hotkey
[a-use-hotkey-shortcut]: https://videojs.org/docs/framework/react/reference/api/use-hotkey-shortcut
[a-use-latest-ref]: https://videojs.org/docs/framework/react/reference/api/use-latest-ref
[a-use-locale]: https://videojs.org/docs/framework/react/reference/api/use-locale
[a-use-media]: https://videojs.org/docs/framework/react/reference/api/use-media
[a-use-optional-container]: https://videojs.org/docs/framework/react/reference/api/use-optional-container
[a-use-optional-player]: https://videojs.org/docs/framework/react/reference/api/use-optional-player
[a-use-playback-rate-options]: https://videojs.org/docs/framework/react/reference/api/use-playback-rate-options
[a-use-player]: https://videojs.org/docs/framework/react/reference/api/use-player
[a-use-quality-options]: https://videojs.org/docs/framework/react/reference/api/use-quality-options
[a-use-selector]: https://videojs.org/docs/framework/react/reference/api/use-selector
[a-use-slider]: https://videojs.org/docs/framework/react/reference/api/use-slider
[a-use-snapshot]: https://videojs.org/docs/framework/react/reference/api/use-snapshot
[a-use-store]: https://videojs.org/docs/framework/react/reference/api/use-store
[a-use-tap-gesture]: https://videojs.org/docs/framework/react/reference/api/use-tap-gesture
[a-use-translator]: https://videojs.org/docs/framework/react/reference/api/use-translator
[a-vjs8-legacy-component]: https://videojs.org/docs/framework/react/reference/api/vjs8-legacy-component
[a-vjs8-legacy-get-player]: https://videojs.org/docs/framework/react/reference/api/vjs8-legacy-get-player
[a-vjs8-legacy-init]: https://videojs.org/docs/framework/react/reference/api/vjs8-legacy-init
[a-vjs8-legacy-options]: https://videojs.org/docs/framework/react/reference/api/vjs8-legacy-options
[a-vjs8-legacy-plugin]: https://videojs.org/docs/framework/react/reference/api/vjs8-legacy-plugin
[base-composition]: https://base-ui.com/react/handbook/composition
[base-popover]: https://base-ui.com/react/components/popover
[base-select]: https://base-ui.com/react/components/select
[c-clock]: https://github.com/avoid-quest/couch/blob/595d588c2de353a02d62af29d341d529e5d1c4aa/src/client/session/playback-clock.ts
[c-components]: https://github.com/avoid-quest/couch/blob/595d588c2de353a02d62af29d341d529e5d1c4aa/components.json
[c-control]: https://github.com/avoid-quest/couch/blob/595d588c2de353a02d62af29d341d529e5d1c4aa/src/client/session/player-control.ts
[c-css]: https://github.com/avoid-quest/couch/blob/595d588c2de353a02d62af29d341d529e5d1c4aa/src/client/index.css
[c-fullscreen]: https://github.com/avoid-quest/couch/blob/595d588c2de353a02d62af29d341d529e5d1c4aa/src/client/sections/now/usePlayerFullscreen.ts
[c-picture]: https://github.com/avoid-quest/couch/blob/595d588c2de353a02d62af29d341d529e5d1c4aa/src/client/session/picture-clock.ts
[c-player]: https://github.com/avoid-quest/couch/blob/595d588c2de353a02d62af29d341d529e5d1c4aa/docs/design/player.md
[c-range]: https://github.com/avoid-quest/couch/blob/595d588c2de353a02d62af29d341d529e5d1c4aa/src/client/components/RangeControl.tsx
[c-remote]: https://github.com/avoid-quest/couch/blob/595d588c2de353a02d62af29d341d529e5d1c4aa/docs/design/remote.md
[c-remote-session]: https://github.com/avoid-quest/couch/blob/595d588c2de353a02d62af29d341d529e5d1c4aa/src/client/session/remote-player-session.tsx
[c-renderer]: https://github.com/avoid-quest/couch/blob/595d588c2de353a02d62af29d341d529e5d1c4aa/src/client/session/renderer.ts
[c-session]: https://github.com/avoid-quest/couch/blob/595d588c2de353a02d62af29d341d529e5d1c4aa/src/client/session/session.ts
[c-settings]: https://github.com/avoid-quest/couch/blob/595d588c2de353a02d62af29d341d529e5d1c4aa/src/client/components/PlaybackSettings.tsx
[c-shell]: https://github.com/avoid-quest/couch/blob/595d588c2de353a02d62af29d341d529e5d1c4aa/docs/design/shell.md
[c-transport]: https://github.com/avoid-quest/couch/blob/595d588c2de353a02d62af29d341d529e5d1c4aa/src/client/components/PlaybackTransport.tsx
[c-ui-button]: https://github.com/avoid-quest/couch/blob/595d588c2de353a02d62af29d341d529e5d1c4aa/src/client/components/ui/button.tsx
[c-ui-popover]: https://github.com/avoid-quest/couch/blob/595d588c2de353a02d62af29d341d529e5d1c4aa/src/client/components/ui/popover.tsx
[c-ui-select]: https://github.com/avoid-quest/couch/blob/595d588c2de353a02d62af29d341d529e5d1c4aa/src/client/components/ui/select.tsx
[g-architecture]: https://videojs.org/docs/framework/react/guides/architecture
[g-background-video]: https://videojs.org/docs/framework/react/guides/background-video
[g-browser-support]: https://videojs.org/docs/framework/react/guides/browser-support
[g-build-component]: https://videojs.org/docs/framework/react/guides/build-your-own-component
[g-casting]: https://videojs.org/docs/framework/react/guides/casting
[g-customize-skins]: https://videojs.org/docs/framework/react/guides/customize-skins
[g-fullscreen]: https://videojs.org/docs/framework/react/guides/fullscreen
[g-internationalization]: https://videojs.org/docs/framework/react/guides/internationalization
[g-keyboard]: https://videojs.org/docs/framework/react/guides/keyboard-shortcuts
[g-media-sources]: https://videojs.org/docs/framework/react/guides/media-sources
[g-migrate-v8]: https://videojs.org/docs/framework/react/guides/migrate-from-video-js-8
[g-mux-data]: https://videojs.org/docs/framework/react/guides/mux-data
[g-pip]: https://videojs.org/docs/framework/react/guides/picture-in-picture
[g-presets]: https://videojs.org/docs/framework/react/guides/presets
[g-skins]: https://videojs.org/docs/framework/react/guides/skins
[g-thumbnails]: https://videojs.org/docs/framework/react/guides/thumbnails
[g-ui]: https://videojs.org/docs/framework/react/guides/ui-components
[g-user-preferences]: https://videojs.org/docs/framework/react/guides/user-preferences
[radix-popover]: https://www.radix-ui.com/primitives/docs/components/popover
[react-effects]: https://react.dev/learn/you-might-not-need-an-effect
[react-memo]: https://react.dev/reference/react/memo
[react-store]: https://react.dev/reference/react/useSyncExternalStore
[registry-video]: https://shadcn.videojs.org/r/react/video.json
[release-tag]: https://api.github.com/repos/videojs/video.js/git/ref/tags/%40videojs/react%4010.2.0
[s-announcer]: https://github.com/videojs/video.js/blob/1042afd430d4d661606a71abf98a3ca87c2fb6be/packages/core/src/dom/ui/status-announcer.ts
[s-audio-feature]: https://github.com/videojs/video.js/blob/1042afd430d4d661606a71abf98a3ca87c2fb6be/packages/core/src/dom/store/features/audio-track.ts
[s-chapters]: https://github.com/videojs/video.js/blob/1042afd430d4d661606a71abf98a3ca87c2fb6be/packages/react/src/ui/time-slider/chapters.tsx
[s-controls]: https://github.com/videojs/video.js/blob/1042afd430d4d661606a71abf98a3ca87c2fb6be/packages/core/src/dom/store/features/controls.ts
[s-create-player]: https://github.com/videojs/video.js/blob/1042afd430d4d661606a71abf98a3ca87c2fb6be/packages/react/src/player/create-player.tsx
[s-feature]: https://github.com/videojs/video.js/blob/1042afd430d4d661606a71abf98a3ca87c2fb6be/packages/core/src/dom/feature.ts
[s-playback-feature]: https://github.com/videojs/video.js/blob/1042afd430d4d661606a71abf98a3ca87c2fb6be/packages/core/src/dom/store/features/playback.ts
[s-player-context]: https://github.com/videojs/video.js/blob/1042afd430d4d661606a71abf98a3ca87c2fb6be/packages/react/src/player/context.tsx
[s-player-target]: https://github.com/videojs/video.js/blob/1042afd430d4d661606a71abf98a3ca87c2fb6be/packages/core/src/dom/player.ts
[s-rate-feature]: https://github.com/videojs/video.js/blob/1042afd430d4d661606a71abf98a3ca87c2fb6be/packages/core/src/dom/store/features/playback-rate.ts
[s-react-exports]: https://github.com/videojs/video.js/blob/1042afd430d4d661606a71abf98a3ca87c2fb6be/packages/react/src/index.ts
[s-slice]: https://github.com/videojs/video.js/blob/1042afd430d4d661606a71abf98a3ca87c2fb6be/packages/store/src/core/slice.ts
[s-slider-buffer]: https://github.com/videojs/video.js/blob/1042afd430d4d661606a71abf98a3ca87c2fb6be/packages/react/src/ui/slider/buffer.tsx
[s-slider-root]: https://github.com/videojs/video.js/blob/1042afd430d4d661606a71abf98a3ca87c2fb6be/packages/react/src/ui/slider/root.tsx
[s-store]: https://github.com/videojs/video.js/blob/1042afd430d4d661606a71abf98a3ca87c2fb6be/packages/store/src/core/store.ts
[s-time-feature]: https://github.com/videojs/video.js/blob/1042afd430d4d661606a71abf98a3ca87c2fb6be/packages/core/src/dom/store/features/time.ts
[s-time-slider]: https://github.com/videojs/video.js/blob/1042afd430d4d661606a71abf98a3ca87c2fb6be/packages/react/src/ui/time-slider/root.tsx
[s-volume-feature]: https://github.com/videojs/video.js/blob/1042afd430d4d661606a71abf98a3ca87c2fb6be/packages/core/src/dom/store/features/volume.ts
[s-volume-slider]: https://github.com/videojs/video.js/blob/1042afd430d4d661606a71abf98a3ca87c2fb6be/packages/react/src/ui/volume-slider/root.tsx
[shadcn-base]: https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default
[shadcn-button]: https://ui.shadcn.com/docs/components/button
[ss-adr]: https://github.com/avoid-quest/couch/blob/16d9cf0ca36901c972dbac80ad962eccfe42ad1f/docs/adr/0002-playback-delivery-and-authority.md
[ss-cases]: https://github.com/avoid-quest/couch/blob/16d9cf0ca36901c972dbac80ad962eccfe42ad1f/docs/audio-video-use-cases.md
[ss-live]: https://github.com/avoid-quest/couch/blob/16d9cf0ca36901c972dbac80ad962eccfe42ad1f/docs/live-audio.md
[ss-policy]: https://github.com/avoid-quest/couch/blob/16d9cf0ca36901c972dbac80ad962eccfe42ad1f/src/shared/playback-policy.ts
[ss-protocol]: https://github.com/avoid-quest/couch/blob/16d9cf0ca36901c972dbac80ad962eccfe42ad1f/src/shared/protocol.ts
[v-airplay-button]: https://videojs.org/docs/framework/react/reference/components/airplay-button
[v-alert-dialog]: https://videojs.org/docs/framework/react/reference/components/alert-dialog
[v-audio]: https://videojs.org/docs/framework/react/reference/components/audio
[v-audio-compat-skin]: https://videojs.org/docs/framework/react/reference/components/audio-compat-skin
[v-audio-neutral-skin]: https://videojs.org/docs/framework/react/reference/components/audio-neutral-skin
[v-audio-scaffold-skin]: https://videojs.org/docs/framework/react/reference/components/audio-scaffold-skin
[v-audio-skin]: https://videojs.org/docs/framework/react/reference/components/audio-skin
[v-audio-track-radio-group]: https://videojs.org/docs/framework/react/reference/components/audio-track-radio-group
[v-background-video]: https://videojs.org/docs/framework/react/reference/components/background-video
[v-background-video-skin]: https://videojs.org/docs/framework/react/reference/components/background-video-skin
[v-buffering-indicator]: https://videojs.org/docs/framework/react/reference/components/buffering-indicator
[v-captions-button]: https://videojs.org/docs/framework/react/reference/components/captions-button
[v-captions-radio-group]: https://videojs.org/docs/framework/react/reference/components/captions-radio-group
[v-cast-button]: https://videojs.org/docs/framework/react/reference/components/cast-button
[v-cloudflare-video]: https://videojs.org/docs/framework/react/reference/components/cloudflare-video
[v-controls]: https://videojs.org/docs/framework/react/reference/components/controls
[v-dash-video]: https://videojs.org/docs/framework/react/reference/components/dash-video
[v-dialog]: https://videojs.org/docs/framework/react/reference/components/dialog
[v-error-dialog]: https://videojs.org/docs/framework/react/reference/components/error-dialog
[v-fullscreen-button]: https://videojs.org/docs/framework/react/reference/components/fullscreen-button
[v-gesture]: https://videojs.org/docs/framework/react/reference/components/gesture
[v-google-cast]: https://videojs.org/docs/framework/react/reference/components/google-cast
[v-hls-audio]: https://videojs.org/docs/framework/react/reference/components/hls-audio
[v-hls-background-video]: https://videojs.org/docs/framework/react/reference/components/hls-background-video
[v-hls-video]: https://videojs.org/docs/framework/react/reference/components/hls-video
[v-hlsjs-video]: https://videojs.org/docs/framework/react/reference/components/hlsjs-video
[v-hotkey]: https://videojs.org/docs/framework/react/reference/components/hotkey
[v-icons]: https://videojs.org/docs/framework/react/reference/components/icons
[v-installation]: https://videojs.org/docs/guides/installation/shadcn
[v-live-audio-compat-skin]: https://videojs.org/docs/framework/react/reference/components/live-audio-compat-skin
[v-live-audio-neutral-skin]: https://videojs.org/docs/framework/react/reference/components/live-audio-neutral-skin
[v-live-audio-scaffold-skin]: https://videojs.org/docs/framework/react/reference/components/live-audio-scaffold-skin
[v-live-audio-skin]: https://videojs.org/docs/framework/react/reference/components/live-audio-skin
[v-live-button]: https://videojs.org/docs/framework/react/reference/components/live-button
[v-live-video-compat-skin]: https://videojs.org/docs/framework/react/reference/components/live-video-compat-skin
[v-live-video-neutral-skin]: https://videojs.org/docs/framework/react/reference/components/live-video-neutral-skin
[v-live-video-scaffold-skin]: https://videojs.org/docs/framework/react/reference/components/live-video-scaffold-skin
[v-live-video-skin]: https://videojs.org/docs/framework/react/reference/components/live-video-skin
[v-menu]: https://videojs.org/docs/framework/react/reference/components/menu
[v-mute-button]: https://videojs.org/docs/framework/react/reference/components/mute-button
[v-mux-audio]: https://videojs.org/docs/framework/react/reference/components/mux-audio
[v-mux-background-video]: https://videojs.org/docs/framework/react/reference/components/mux-background-video
[v-mux-data]: https://videojs.org/docs/framework/react/reference/components/mux-data
[v-mux-video]: https://videojs.org/docs/framework/react/reference/components/mux-video
[v-native-hls-video]: https://videojs.org/docs/framework/react/reference/components/native-hls-video
[v-pip-button]: https://videojs.org/docs/framework/react/reference/components/pip-button
[v-play-button]: https://videojs.org/docs/framework/react/reference/components/play-button
[v-playback-rate-button]: https://videojs.org/docs/framework/react/reference/components/playback-rate-button
[v-playback-rate-radio-group]: https://videojs.org/docs/framework/react/reference/components/playback-rate-radio-group
[v-player]: https://videojs.org/docs/framework/react/reference/components/player
[v-player-container]: https://videojs.org/docs/framework/react/reference/components/player-container
[v-playerjs-video]: https://videojs.org/docs/framework/react/reference/components/playerjs-video
[v-popover]: https://videojs.org/docs/framework/react/reference/components/popover
[v-poster]: https://videojs.org/docs/framework/react/reference/components/poster
[v-quality-radio-group]: https://videojs.org/docs/framework/react/reference/components/quality-radio-group
[v-seek-button]: https://videojs.org/docs/framework/react/reference/components/seek-button
[v-seek-indicator]: https://videojs.org/docs/framework/react/reference/components/seek-indicator
[v-shaka-video]: https://videojs.org/docs/framework/react/reference/components/shaka-video
[v-slider]: https://videojs.org/docs/framework/react/reference/components/slider
[v-spotify-audio]: https://videojs.org/docs/framework/react/reference/components/spotify-audio
[v-status-announcer]: https://videojs.org/docs/framework/react/reference/components/status-announcer
[v-status-indicator]: https://videojs.org/docs/framework/react/reference/components/status-indicator
[v-thumbnail]: https://videojs.org/docs/framework/react/reference/components/thumbnail
[v-tiktok-video]: https://videojs.org/docs/framework/react/reference/components/tiktok-video
[v-time]: https://videojs.org/docs/framework/react/reference/components/time
[v-time-slider]: https://videojs.org/docs/framework/react/reference/components/time-slider
[v-title]: https://videojs.org/docs/framework/react/reference/components/title
[v-tooltip]: https://videojs.org/docs/framework/react/reference/components/tooltip
[v-twitch-video]: https://videojs.org/docs/framework/react/reference/components/twitch-video
[v-video]: https://videojs.org/docs/framework/react/reference/components/video
[v-video-compat-skin]: https://videojs.org/docs/framework/react/reference/components/video-compat-skin
[v-video-neutral-skin]: https://videojs.org/docs/framework/react/reference/components/video-neutral-skin
[v-video-scaffold-skin]: https://videojs.org/docs/framework/react/reference/components/video-scaffold-skin
[v-video-skin]: https://videojs.org/docs/framework/react/reference/components/video-skin
[v-vimeo-video]: https://videojs.org/docs/framework/react/reference/components/vimeo-video
[v-volume-indicator]: https://videojs.org/docs/framework/react/reference/components/volume-indicator
[v-volume-popover]: https://videojs.org/docs/framework/react/reference/components/volume-popover
[v-volume-slider]: https://videojs.org/docs/framework/react/reference/components/volume-slider
[v-wistia-video]: https://videojs.org/docs/framework/react/reference/components/wistia-video
[v-youtube-video]: https://videojs.org/docs/framework/react/reference/components/youtube-video
