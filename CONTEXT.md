# Couch language

[The playback contract](docs/playback-product.md) defines behavior. Use these words
in the application and active product documents.

**Library**: Media, sources and authorized settings coordinated by one Couch Core.
Connecting to a Library does not assign a playback device.

**Playback**: One durable queue, current item, timeline, intent, track choices and
watching preferences. Several Playbacks may run independently. Participating devices
control the same Playback. A window may explicitly control another authorized
Playback without joining or interrupting it.

**Device**: A named place that can render media. One persistent client identity and
name spans pairing, direct rendering and synchronized audio. Device loudness stays
with that Device.

**Move**: Continue the same Playback on a different Device, preserving its state.

**Add device**: Give a compatible audio Device the existing Playback's timeline.
Sendspin synchronization is internal. This action creates no separate Playback.

**New playback**: Start a separate queue and timeline without changing another
Playback. A client has a default Playback for convenience; the default is not an
ownership mode.

Core, renderer, assignment, media delivery, Sendspin client IDs and legacy session
aliases are implementation terms. Their seams are recorded in
[architecture](docs/architecture.md), not exposed as setup choices.
