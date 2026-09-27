# Couch playback

This is the active product contract. Historical briefs, issue answers and validation
receipts remain preserved evidence. They do not prescribe the product model.

Couch is one application: browse and manage the library, play media, and control
playback from browser, desktop or TV. Keep the existing windows, navigation, player
placement and design system. Permissions and actual device capabilities explain
any differences.

## One playback, assigned devices

A playback owns its queue, current item, timeline, paused/playing intent, speed,
track choices and watching preferences. Its lifetime is independent of the window
controlling it and the devices rendering it. Several playbacks can run concurrently.

Each window selects a playback to control. Opening Couch starts nothing and takes
over nothing. Pairing authorizes playback control for that library; choosing another
ongoing playback is explicit. Library administration remains a separate permission.
Each persistent client has a default playback, but this is a convenience pointer,
not the playback's identity or lifetime. A new playback never mutates another queue.

The player names its assigned devices. Its transport, queue, seek and shared volume
controls affect that playback. One Devices list shows availability, what is playing,
and device loudness. It handles these operations directly:

- Play media on this device by default, or choose another available device.
- Control an existing playback without changing its devices or fetching its media.
- Move playback to a device while preserving the ongoing experience.
- Add or remove compatible audio devices from that same playback.
- Start another playback on a device while other playbacks keep running.

There are no personal/household modes, audio-group destinations, or Listen together
setup flow. Adding another compatible speaker selects synchronized delivery internally.
Occupied devices require an explicit contextual replacement choice. Unsupported
combinations explain the limitation at that action. Browser audio permission appears
only when the affected device needs a gesture. Device loudness stays with the device;
a move does not copy a TV's loudness to headphones.

## Assignment and recovery

Assignment is one operation owned by Core: validate access and capabilities, prepare
and verify the destination, preserve queue occurrences and media state, retire the
previous rendering appropriately, and publish the observed outcome. Command acceptance
is not playback success. Joining audio follows the existing timeline. Independent audio
playbacks have independent synchronized delivery, not one global audio group.

Closing a controller leaves playback elsewhere running. Renderer loss, reconnection,
revocation and Core restart produce an accurate recoverable state without duplicate
owners or unexpected autoplay. Preserve meaningful live/DVR position, compatible tracks,
speed and paused intent. Failed preparation keeps the source where safe; uncertain
silence remains a visible recovery condition. Release abandoned decoders and jobs.

## One connection and identity

A persistent client has one device identity and name across pairing, direct playback
and synchronized audio. Use sensible defaults and one Rename location in Settings →
Devices. Preserve names, pairings and identity through restart and migration. Browser
storage is origin/profile scoped; another origin cannot silently inherit it. Personal
watching preferences remain distinct where useful; do not invent an account platform.

Standalone desktop remains convenient. Core may run independently without a player or
TV window. Additional native clients connect once to another library. Local hardware
and installation maintenance name and affect the correct machine. Home-network selection
works with virtual Mac interfaces; ambiguity is resolved in the app. Normal setup
requires no JSON, environment variables, protocol enrollment or role coordination.

Core coordinates ordinary media intent, authorization and library access; selected
clients fetch and decode supported media. Preserve sources and native behavior, direct
browser audio/video, maintained HLS/DASH clients, tracks, quality limits and live/DVR.
Sendspin is the synchronized-audio adapter, with protocol/crypto/synchronization kept in
maintained dependencies. Optional external audio-server connections live in device
settings. Core audio hosting can be disabled explicitly; its default operation needs
no separate playback setup.

Access is local computer/home-network only. Internet media providers remain sources.
Public deployment, Snapcast, Python Sendspin and new Jellyfin adaptation are outside
scope. Third-party PIN onboarding is deferred.

## Evidence

Acceptance comes from complete built-app paths across fresh and migrated installs,
standalone and independent Core, browsers and native clients, control without rendering,
concurrent playback, multiple audio devices, audio/video moves, continuity, volume,
identity, navigation, close/restart/disconnect/revocation and failure. Keep focused
regressions for ownership and recovery; retire tests of deleted workflows. Separate
actual device observations, software-output evidence and unavailable physical checks.
Measure startup, seek, move and cleanup; physical synchronization requires measurement.
Preserve data and historical work. Deliver reviewable PRs and a built app; do not merge
or release as part of this work.
