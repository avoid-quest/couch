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

Every participating device controls the playback it is playing: media selection,
queue, transport and membership are shared. Joining or being added to a playback
updates those controls without changing the page being browsed. There is no primary
controller. Home's Now view shows ongoing playback and its devices. Opening one
shows its player and queue without joining or starting a local decoder. Joining is
a contextual action on that playback. The opened playback remains selected until another choice or
a new local assignment. Opening Couch starts nothing and takes over nothing.
Pairing authorizes playback control for that library; administration remains a
separate permission. An independent device keeps its own playback. A client's
default playback is a convenience pointer, not ownership or control permission.

The player names its assigned devices. Its transport, queue, seek and shared volume
controls affect that playback. One Output panel shows availability, what is playing,
and a volume fader for each device. Its on/off switch adds or removes that device;
zero volume leaves it assigned but silent. Switching off remembers its level. It
handles these operations directly:

- Play media on this device by default, or choose another available device.
- Control an existing playback without changing its devices or fetching its media.
- Move playback to a device, including an existing participant, while preserving the
  ongoing experience and retiring the previous outputs.
- Add or remove compatible audio devices from that same playback.
- Watch video on one selected screen with its sound on all selected audio devices.
- Start another playback on a device while other playbacks keep running.

There are no personal/household modes, audio-group destinations, or Listen together
setup flow. Adding another compatible speaker selects synchronized delivery internally.
Video retains one picture output while the selected devices share its soundtrack.
Multiple simultaneous picture outputs are deferred; selecting several devices must
not make video unavailable.
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

Core coordinates media intent, authorization and library access; selected clients
fetch and decode supported media. Prefer the most efficient supported client path.
Playback must not require Core to fetch, decode or relay the actual media to clients,
including as the mandatory shared-audio path. The current Core PCM producer does
not satisfy this requirement and remains an architecture blocker. Preserve sources and native behavior, direct
browser audio/video, maintained HLS/DASH clients, tracks, quality limits and live/DVR.
Existing Internet sources—including YouTube, Twitch, StreamingCommunity, Bandcamp,
RaiPlay, radio and IPTV—must also play with several devices selected. Choosing
devices must not disable a source that Couch already supports. Source delivery and
browser-compatible rendition selection belong inside playback, without extra setup.
Jellyfin and local files are excluded from the current source-qualification pass.
Sendspin is the synchronized-audio adapter, with protocol/crypto/synchronization kept in
maintained dependencies. Optional external audio-server connections live in device
settings. Optional Core hosting remains available, but must not make Core media processing
a prerequisite for shared playback. Normal operation needs no separate playback setup.

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
