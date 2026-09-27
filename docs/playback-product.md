# One Couch, your devices

This is the active product contract for device-independent playback. It supersedes
design choices and completion claims in the historical brief, issue answers and
validation receipts. Those records remain evidence, not instructions. Architecture
documents describe how this contract is implemented; acceptance records say which
behavior has actually been observed.

## Product language and ownership

- **Library** is the Couch collection and its authorized settings. Connecting to a
  library does not choose where media plays. Browser, desktop and TV use the same
  application, navigation and player; permissions and device capabilities explain
  differences. Keep the existing window model and presentation.
- **Playback** is one queue, current item, timeline, paused/playing intent, speed,
  track choices and watching preferences. Each independent playback has one owner
  and authorized controllers. Opening a client starts nothing and takes over nothing.
  Choosing playback to control changes only that controller's view.
- **Devices** are the named places where playback can be heard or seen. A device has
  one persistent name across connection, native/browser playback and shared audio.
  Rename lives in Settings → Devices. Credentials and transport registrations stay
  internal. A browser profile's storage belongs to its origin; another profile or
  origin cannot silently inherit its pairing or identity.

The existing player controls the selected playback and names its devices. One device
control shows its destination, other authorized playback, device availability and
audio adjustment. Remove competing output/server pickers, role toggles, repeated
name prompts, protocol-specific transport controls and setup-only playback modes.
Library connection and installation maintenance live in settings, scoped to the
machine named there. Device loudness belongs to that device, never to the queue.

## Actions

**Play** starts the selected media on the chosen available device. With no explicit
selection, offer this device through the same action; integrate any browser audio
gesture there. Each client can start independent playback without changing anyone
else's queue. Existing shared queues and watching history survive migration.

**Control** selects an authorized ongoing playback without fetching media, opening a
decoder, moving a screen or changing its playback. Closing that controller leaves
remote playback running. Queue, seek, tracks, speed, pause and stop always affect the
playback named beside those controls.

**Move here / Move to…** keeps the playback, queue occurrences, progress, paused or
playing intent, speed and compatible tracks. Prepare and verify the destination,
observe the source checkpoint, confirm destination state and retire the previous
load. Preserve meaningful live/DVR position. Keep destination volume. An occupied
device requires a contextual, explicit choice to replace its playback. Failure leaves
the source playing when safe, otherwise a truthful paused/recoverable state; command
acceptance is never success and uncertain silence never authorizes duplicate playback.

**Listen together** adds compatible devices to the same audio timeline. Joining follows
the existing timeline; it does not move its owner or create another queue. Membership
and per-device volume appear in the device control, alongside shared adjustment.
**Play separately** leaves shared audio and starts/selects independent playback. Video,
unsupported source combinations and devices requiring a local gesture explain what
the user can do next. Sendspin is the sole synchronized-audio implementation.

## Runtime and setup

Standalone desktop remains convenient. Core may also run independently with no local
player; closing a TV window cannot stop that independent process. Additional native
clients connect once and offer their playback capability without another enrollment
workflow. Remote hardware and local installation maintenance target the named machine.

Normal setup uses the application, sensible automatic names and a usable home-network
address, including on Macs with virtual interfaces. Ambiguous networks can be chosen
in the app. Optional synchronized-audio hosting is enabled where listening together
needs it; no file, environment variable, restart hunt or technical-role graph is a
normal playback prerequisite. Clients may also join another Sendspin server.

Only selected/preparing devices fetch and decode ordinary supported media. Preserve
existing providers/native playback, direct browser media, maintained HLS/DASH playback,
track selection, quality limits and live/DVR behavior. Prefer compatible upstream
renditions. Cancel abandoned preparation and release decoders and jobs. Unsupported
access or formats must remain accurate and actionable.

Disconnect, revocation, renderer loss and Core restart fence stale commands and
observations. Reconnection restores identity and resumable intent without unexpected
autoplay or duplicate owners. Authentication, playback access and watching preferences
remain distinct where needed; no new account platform.

Access is local computer/home-network only; Internet media sources remain valid.
Keep protocol, cryptography and synchronization in maintained dependencies. Public
deployment, Snapcast, Python Sendspin and new Jellyfin relay/adaptation are outside
scope. Third-party PIN onboarding is deferred.

## Acceptance

Exercise complete setup-to-playback paths in the built application. The compact matrix
must cover fresh and migrated installs; standalone, independent Core, browser and
additional native clients; control-only and simultaneous independent playback; shared
audio and membership; audio/video moves; queue/progress/track continuity; scoped volume
and names; navigation, close, restart, disconnect, revocation and failure; real sources
and unsupported capabilities. Tests protect isolation, ownership and recovery but do
not establish product acceptance.

Measure available startup, seek, move, cleanup and resource behavior. Separate actual
device observations, software-output evidence and unavailable hardware checks. Physical
synchronization claims require measurement. Preserve data, pairings, archives, stashes
and historical receipts. Keep PR concerns in their owning stack layers; do not merge
or release as part of this work.
