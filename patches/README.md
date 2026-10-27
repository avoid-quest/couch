# Sendspin server message isolation

The browser SDK is unpatched. The Node SDK 0.6.2 patch retains only its WebSocket
exception boundary and application-message shape checks. In the relaxed
`audio-isolation.integration.ts` regression, removing these hunks lets a paired
client's encrypted `null` message throw from the SDK and terminate the audio
worker, interrupting healthy Opus playback. Malformed messages must close only
the offending connection. The same suite checks valid extension traffic.

Run that suite separately on Node as [CI](../docs/ci.md) describes. The retained
hunks change no scheduling, timing, codec or output-preparation APIs. Remove them
when an upstream release passes this regression without the patch. Upstream:
<https://github.com/sonn-audio/node-sendspin> (MIT).

The four direct SDK dependency pins used for patched materialization are gone;
the frozen install resolves the upstream transitive dependencies. Verify a fresh
frozen install, typecheck and build when changing this patch.
