# Playback architecture precedents for Couch

Researched: 2026-09-27. Sources below are first-party documentation, specifications, or maintained upstream source code. This note compares architectural mechanisms; it does not establish that every current product client implements every documented feature. Recommendations marked **Couch inference** are proposed design choices, not claims about those products. Upstream `master` links are observations at the research date, not release guarantees.

## Findings that matter most

The useful precedent is a set of independent roles: a controller selects content and issues commands; a renderer executes playback and reports what actually happened; a service supplies content and persists user/session information. These roles can inhabit the same process or physical machine. Moving the controller does not inherently move playback, and moving playback does not inherently require moving the original media bytes between the two clients. UPnP AV explicitly describes this decomposition and permits combining the roles in one device. [UPnP AV Architecture:2, sections 4–5](https://upnp.org/specs/av/UPnP-av-AVArchitecture-v2.pdf)

**Couch inference:** choose a Couch-owned logical playback session that can outlive a UI connection and change its renderer. Keep the original media identity and timeline stable while replacing delivery URLs and decoder configuration for each target. Model handoff as an acknowledged operation; an ordinary progress bookmark is not a complete session transfer.

## Google Cast: sender, receiver, and explicit stream transfer

Cast distinguishes a sender application, which selects and controls playback, from a receiver application on the playback device. Its SDK offers different receiver choices; a custom receiver is not mandatory for a basic integration. [Cast overview](https://developers.google.com/cast/docs/overview)

The receiver protocol uses `mediaSessionId` to identify the active media instance and `requestId` to correlate commands with results. Receivers broadcast status changes to senders, including spontaneous changes caused on the receiver. The protocol separately describes receiver/device volume and media-stream volume. Stopping invalidates the media session; a failed load and a superseded load have distinct errors. [Media playback messages](https://developers.google.com/cast/docs/media/messages)

Cast's documented stream transfer stops playback on the source, saves its state, starts the receiver application on the destination, and restores playback there. The state includes media position, queue position, authenticated user, and playing/paused state. The framework's default mechanism converts a media-status snapshot into a load request; custom data and refreshed credentials can extend that snapshot. This is a restart with preserved intent/state, rather than migration of a decoder process. [Web receiver: stream transfer and preserving session state](https://developers.google.com/cast/docs/web_receiver/core_features#stream_transfer)

The sender API distinguishes leaving/disconnecting from a running receiver application from stopping that application. This is a useful lifecycle distinction, not a guarantee that every receiver application has identical idle/disconnection policies. [Cast Session API](https://developers.google.com/cast/docs/reference/web_sender/chrome.cast.Session)

**Couch inference:** expose separate `detachController`, `stopPlayback`, and `transferPlayback` operations. Preserve portable session state; regenerate target-specific delivery and authentication. Use explicit renderer acknowledgements and status broadcasts. Cast's source-first stop sequence is a precedent, but Couch can improve failure handling by preparing the destination before committing to a source pause.

## Spotify Connect: the browser can itself be a target

Spotify's public API exposes playback transfer to a specified device, optionally forcing playback; omission preserves the current playback state. Only one destination is currently accepted. The endpoint requires `user-modify-playback-state`, is restricted to Premium users, and explicitly does **not** guarantee execution ordering when combined with other Player API endpoints. These restrictions describe Spotify's API, not requirements Couch should inherit. [Transfer playback](https://developer.spotify.com/documentation/web-api/reference/transfer-a-users-playback)

Device discovery exposes active, restricted, and volume-support properties. Spotify cautions that cached device IDs are not guaranteed to remain valid indefinitely and that some device models are absent from the API. [Available devices](https://developer.spotify.com/documentation/web-api/reference/get-a-users-available-devices)

The Web Playback SDK creates a named Connect player visible to other applications, emits readiness and playback-state events, and supports local rendering. Its documentation explicitly addresses transferring into a browser blocked by autoplay policy: activation must originate from user interaction, otherwise transfer can leave playback paused. [Web Playback SDK reference](https://developer.spotify.com/documentation/web-playback-sdk/reference)

**Couch inference:** a browser UI should optionally register its own renderer, with readiness distinct from login/connection. “Continue here” should collect the browser gesture needed for playback and retain an actionable paused state if autoplay fails. Do not infer Spotify's private coordination protocol or internal transaction guarantees from its public transfer endpoint. Couch should provide ordering and handoff-result semantics in its own API rather than reproduce this public API limitation.

## Sonos: explicit session ownership, joining, and eviction

Sonos distinguishes households, players, groups, and playback sessions. Transport commands address a group; a coordinator player handles most commands for it. Commands and events use separate request/subscription paths. The player processes received commands sequentially, but the cloud does not guarantee preservation of request order. Device identities and ephemeral group/session identities have different lifetimes. [Control API architecture](https://docs.sonos.com/docs/control)

Playback sessions provide semi-exclusive queue control, with multiple instances of an application able to join through matching app/context identifiers. Another application or a local user action can evict a session; clients must observe eviction and relinquish control. Sonos explicitly warns against automatically recreating a session after eviction, which would fight the user's new selection. Other controllers can still observe group playback metadata/status without owning that session. [Playback sessions](https://docs.sonos.com/docs/playback-sessions)

Creating a session unconditionally replaces an existing one. Sonos uses `appContext` to choose whether different instances share a session and `customData` to pass application information, such as the playlist identifier, to a joining instance. These identifiers are not a substitute for authentication. [Create session](https://docs.sonos.com/reference/playbacksession-createsession-groupid)

Control integrations require the user to authorize access to their household before discovery, commands, and subscriptions. [Control Sonos players](https://docs.sonos.com/docs/control-sonos-players)

Sonos also documents a simpler cross-device resume mechanism: a content service marks material resumable, receives reported positions, and can supply the start position when playback resumes on Sonos. That is a useful distinction between a durable bookmark and a live session with ownership. [Save and resume playback](https://docs.sonos.com/docs/save-resume-playback)

**Couch inference:** distinguish observing, controlling, joining, transferring, and taking over a busy target. An authorized user with an old browser tab should not continually seize the TV back. Local stop/replacement actions should invalidate superseded commands. Future Snapcast/Sendspin groups are an explicit Couch requirement: reserve group identity, membership and backend timing ownership now, while implementing the adapters incrementally. See [the focused research](multiroom-snapcast-sendspin.md).

## Jellyfin: service-mediated client control and playback reporting

Jellyfin's session controller lists sessions, supports filtering by a user allowed to control them, sends play requests to a target session, and issues playstate commands. Play requests include item IDs, starting position, media source, audio/subtitle stream indices, and queue start index. This is already more than sending remote keyboard events. [SessionController source](https://github.com/jellyfin/jellyfin/blob/master/Jellyfin.Api/Controllers/SessionController.cs)

Playback start, progress, and stop are reported through separate endpoints; progress resolves the authenticated session and passes a report to the session manager. This separates a command issued to a client from a report about execution. [PlaystateController source](https://github.com/jellyfin/jellyfin/blob/master/Jellyfin.Api/Controllers/PlaystateController.cs)

The session manager updates user resume state from playback reports and can remember audio/subtitle choices. Remote-control routing checks whether the controlling session is authorized; controlling another user's session requires the corresponding permission, with explicit special handling for privileged API-key and public-session contexts. Attaching another user has an additional administrative check because progress affects that user's data. [SessionManager source](https://github.com/jellyfin/jellyfin/blob/master/Emby.Server.Implementations/Session/SessionManager.cs)

The documented user policy distinguishes library access, playback/transcoding permissions, remote connections, remote control of other users, and device access. “Can play this item” and “can control that screen” are separate decisions. [Managing users](https://jellyfin.org/docs/general/server/users/adding-managing-users/)

**Couch inference:** retain this separation of commands, renderer reports, and durable user progress. Do not collapse an authenticated client connection, a renderer identity, a delivery/transcode job, and a logical viewing session into one ID. The inspected Jellyfin APIs are evidence for remote control and resume reporting; they do not establish an atomic, lossless transfer of an arbitrary whole video session between clients.

## Plex: choose a receiver; keep the controller role visible

Plex's official “Fling Media” documentation describes selecting another player before starting media, or selecting one while already playing so media moves to that receiver. The original application then displays remote playback controls. The same article expressly excludes Plex Mobile 2025.10 and later, so this is a documented architectural precedent, not a claim of universal current Plex client parity. The first-party search index returned the article text; opening the page directly returned HTTP 403 during this research. [Fling Media](https://support.plex.tv/articles/201112887-fling-media/)

**Couch inference:** selecting a destination should change command routing while preserving library browsing and a clear “playing on” indicator. Make controller and renderer capabilities part of a shared contract so clients cannot silently drift into an unsupported subset. The documentation does not establish whether every queue/track preference is preserved during a Plex fling.

## Kodi: broad remote control does not itself create portable sessions

Kodi exposes JSON-RPC over HTTP and socket transports; WebSocket/TCP can deliver notifications while HTTP request/response serves different transport needs. JSON-RPC remote access must be explicitly enabled. Its examples query active players and current items before issuing playback commands. The player being controlled is Kodi's active local player. [JSON-RPC overview](https://kodi.wiki/view/JSON-RPC_API), [official examples](https://kodi.wiki/view/JSON-RPC_API/Examples)

**Couch inference:** remote-controlling an existing native renderer can be an early incremental milestone. It is not sufficient for browser rendering or cross-target session persistence. Avoid letting local player IDs or file paths become the canonical session/media identity. Kodi's overview includes historical authorization discussion; it should not be treated as proof of modern per-user authorization guarantees or a template for internet exposure.

## MPD: daemon-owned playback with several thin controllers

MPD's protocol exposes player status, queue operations, and `idle` change notifications. It explicitly recommends queue-entry IDs over positions when multiple clients interact: positions shift as entries are inserted or removed. Entries for the same media have distinct IDs; those IDs do not survive daemon restart. Queue versions and delta queries support resynchronization. Authentication in this protocol uses a plaintext password. [MPD protocol](https://mpd.readthedocs.io/en/stable/protocol.html)

MPD can save queue and playback position to an optional state file and reload it after restart. Saving is configurable; startup may be configured to restore paused instead of immediately resuming. [MPD state file](https://mpd.readthedocs.io/en/stable/user.html#the-state-file)

**Couch inference:** preserve daemon-owned sessions when controller connections disappear; give every queue occurrence its own stable identifier and maintain a revision. Persist Couch IDs across restarts rather than copying MPD's lifetime limitation. Adopt explicit restart/resume policy. MPD's direct plaintext protocol should not become Couch's browser/internet security boundary.

## UPnP AV / DLNA-style integration: a useful adapter boundary

UPnP AV specifies a control point, media server, and media renderer, with actual content transferred separately from control messages. It explicitly states that the control point can disappear after initiating transfer without interrupting content flow. It defines services including content discovery, connection management, transport control, and rendering controls. [UPnP AV Architecture:2](https://upnp.org/specs/av/UPnP-av-AVArchitecture-v2.pdf), [OCF standardized device/service catalog](https://openconnectivity.org/developer/specifications/upnp-resources/upnp/mediaserver4-and-mediarenderer3/)

**Couch inference:** these roles validate separating control and delivery even on one Linux machine. A future UPnP/DLNA integration can be a renderer adapter with declared capabilities. This note does not establish security or handoff guarantees across arbitrary DLNA products; Couch should retain its own authorization and session model rather than rely on LAN discovery as permission.

## Recommended synthesis for Couch

These are design recommendations informed by the precedents, to be checked against Couch's existing implementation:

1. Give the service authority over session membership, queue, revisions, target assignment, and durable resume records. Give the renderer authority to report actual decoded position, buffering, selected tracks, and hardware state. Desired state and observed state must remain distinguishable.
2. Give controllers authenticated command access and revisioned snapshots/events. Use command IDs and idempotency; serialize conflicting operations in the service. A transport acknowledgement does not mean playback has begun.
3. Keep a stable logical session through handoff; replace its endpoint/group assignment and delivery plan. Increment an assignment generation so late source reports cannot overwrite destination progress. Adding a room to an existing synchronized group differs from moving the whole session.
4. Transfer media identity, queue occurrence, content position, paused/playing intent, speed, and semantic track preferences. Re-negotiate codecs, track availability, delivery URL, quality, output channels, and device volume for the destination.
5. Prepare a destination while the source remains usable, then obtain a fresh source checkpoint, fence old playback ownership, and start/confirm the destination. If preparation fails, leave the source intact. If commit fails, report a recoverable paused state; resume the available source only under a valid assignment and when the destination is known silent. If assignment already changed, recovery must grant a fresh generation. This is a proposed Couch protocol, not an atomicity guarantee furnished by these products.
6. Separate “resume this item” from “move this session.” The former consumes a durable bookmark; the latter preserves queue and live intent, with an operation result and failure policy.
7. Keep session lifetime independent from controller connection lifetime. A browser that is only a remote control can disappear without stopping the TV. A browser that is the renderer cannot promise to keep decoding after its tab/process is destroyed.
8. Treat target availability, command capability, media compatibility, authorization, and browser activation as independent checks. Discovery provides candidates, not control rights or playback guarantees.

No surveyed public API establishes that Couch should promise frame-perfect handoff, exactly-once physical playback, or synchronized multi-room playback. Those require stronger timing and failure protocols than approximate resume at the same content position.
