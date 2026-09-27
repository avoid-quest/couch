# Couch playback

Vocabulary for accessing one Couch library and choosing where its media plays.

## Language

**Couch Core**: The authority for a Couch library, integrations, access permissions
and playback sessions. It can serve clients without being a playback device.
_Avoid_: Player, desktop app when referring to this authority.

**UI client**: A user interface connected to Core for browsing, management and
playback control. It may also offer a renderer on the same device.
_Avoid_: Remote when it implies a reduced interface.

**Playback target**: A selectable destination for a session's playback: one
renderer or a synchronized output group.
_Avoid_: Server, device when the destination could be a group.

**Renderer**: The endpoint that consumes media and produces picture or sound.
Its supported formats and output controls depend on the device and playback backend.
_Avoid_: Client when only playback, rather than the UI, is meant.

**Playback session**: The continuing queue, current item, playback intent and
observed progress that can move between targets.
_Avoid_: Player instance, connection, individual media load.

**Media delivery**: The path and representation that make a source playable by
a target, including direct access, relay, remuxing or transcoding.
_Avoid_: Transcoding as a synonym for streaming.
