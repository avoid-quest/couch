# Static PWA platform boundaries

Research, 2026-09-27. Scope: ordinary installable web apps, with remote and mostly
unauthenticated sources. This evaluates platform feasibility, not an implemented
Couch migration. Recommendations below are architectural judgments.

**A static PWA can be a complete standalone player for compatible sources and can
connect active devices through WebRTC. It cannot promise the lifetime, source
access, or network discovery of a native process merely by being installed.**
The practical decision is which of those promises Couch actually needs.

## Sources: public is not the same as browser-readable

JavaScript can directly fetch remote catalogs, playlists, subtitles and media
when their servers permit the app's origin through CORS. Authentication and CORS
are separate: a public URL that works in curl can still be unreadable to browser
JavaScript. `fetch(..., { mode: "no-cors" })` produces an opaque response, without
a readable body or useful status/headers; it cannot unlock JSON or playlist
parsing. Custom headers may require preflight, and browser-controlled headers
such as `Cookie`, `Host` and `Origin` cannot simply be supplied like native HTTP
headers. Installing the site or intercepting its requests with a service worker
does not change these Fetch rules. [Fetch standard](https://fetch.spec.whatwg.org/#http-cors-protocol),
[opaque responses](https://fetch.spec.whatwg.org/#concept-filtered-response-opaque),
[forbidden headers](https://fetch.spec.whatwg.org/#forbidden-request-header).

There is an important useful exception: an HTML audio/video element can play
cross-origin resources without exposing their bytes to JavaScript. A playable
URL therefore does not automatically need a proxy. Conversely, routing that
element into Web Audio requires CORS access: the specification requires silence
for a CORS-cross-origin source. A JavaScript streaming engine that fetches and
parses manifests/segments also needs readable responses. Test catalog access,
plain playback and processed playback separately. [Web Audio cross-origin media rules](https://www.w3.org/TR/webaudio/#MediaElementAudioSourceNode-security).

## Installation, storage and lifetime

Installation supplies an app entry point and standalone presentation; some
capabilities additionally depend on installation. It is not a blanket permission
grant. For example, iOS Home Screen apps can request push permission following
user interaction; installing alone does not grant it. [PWA installation](https://web.dev/learn/pwa/installation),
[WebKit Home Screen push permissions](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).

IndexedDB is suitable for local libraries, settings, queues and progress. Its
databases are scoped to storage keys; it supplies no cross-device replication.
Cache storage and service workers can make the application shell and selected
resources available offline. Storage remains subject to quota and eviction;
requesting persistence helps where granted, and WebKit considers Home Screen
installation in that decision. A local database can be authoritative for one
device; a shared household library still needs an explicit synchronization and
conflict policy. [IndexedDB](https://www.w3.org/TR/IndexedDB/),
[WebKit storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/).

A service worker handles events; the browser may terminate it when there is no
event or when an event exceeds imposed limits. It is useful for offline fetches
and supported background events, but cannot be an indefinitely running peer,
scheduler or playback coordinator. [Service worker lifetime](https://www.w3.org/TR/service-workers/#service-worker-lifetime).

That does **not** mean background media is categorically impossible. Active
audio and WebRTC influence browser lifecycle decisions: Chrome documents
protection against discarding these pages except under extreme resource
constraints. Hidden-page timers have separate throttling rules. These are
browser policies, not a cross-platform promise that a locked phone will remain
an available household server. [Chrome page lifecycle](https://developer.chrome.com/docs/web-platform/page-lifecycle-api),
[Chrome timer throttling](https://developer.chrome.com/blog/timer-throttling-in-chrome-88).

## A mesh is possible, with explicit rendezvous

WebRTC transports audio, video and arbitrary data between peers. Establishing a
connection requires exchanging descriptions and ICE candidates through another
channel; WebRTC does not supply signaling. STUN discovers network-facing
connectivity, while TURN relays traffic when a direct route is unavailable.
These are distinct jobs. A static host distributes application files; by itself
it provides no mailbox for live peers' offers and answers. [WebRTC connection guide](https://webrtc.org/getting-started/peer-connections).

Inference from that protocol: users can exchange complete offers/answers and
gathered candidates manually, including QR codes or copy/paste, instead of
operating a signaling service. Both directions must be delivered. A room-code QR
alone still needs somewhere to resolve the code. Reachable LAN peers can use
host candidates without a public relay; restrictive networks and browser IP
exposure policies make that a tested deployment condition, not a guarantee.
Automatic reconnection and discovery make a small signaling service attractive.
TURN becomes a reliability option if connections beyond friendly LANs matter.
[WebRTC configuration and candidate types](https://www.w3.org/TR/webrtc/#rtcconfiguration-dictionary).

Once connected, peers can exchange queue changes or library records. Product
decisions remain: which device owns the current session, what happens when it
disappears, and how conflicting edits merge. These costs are an architectural
consequence of distributed state, not a reason to add a distributed framework
before the feature needs one.

`BroadcastChannel` and `SharedWorker` coordinate related browsing contexts within
the browser's storage/origin boundaries; neither discovers another computer.
[BroadcastChannel specification](https://html.spec.whatwg.org/multipage/web-messaging.html#broadcasting-to-other-browsing-contexts),
[Shared workers](https://html.spec.whatwg.org/multipage/workers.html#shared-workers-and-the-sharedworker-interface).

## LAN access and audio precision

An ordinary web app can contact a known compatible LAN HTTP endpoint, subject to
browser restrictions and permissions. Chrome 142 introduced Local Network
Access permission for covered local requests. Granting it is not a general
socket API or Bonjour/SSDP discovery service. Standard web apps lack raw TCP/UDP
listeners. Chrome's Direct Sockets **does** now support TCP servers, UDP and
discovery use cases, but specifically for **Isolated Web Apps**, with their own
installation/security requirements. It is not an ordinary PWA capability.
[Chrome LNA](https://developer.chrome.com/release-notes/142#local_network_access_restrictions),
[Direct Sockets for IWAs](https://developer.chrome.com/docs/iwa/direct-sockets).

Web Audio schedules audio on its rendering timeline; AudioWorklet supports
custom processing on the audio rendering thread. This is substantially better
suited to precise local audio than `setTimeout` playback commands. It does not
synchronize independent devices' clocks or output latency automatically, nor
override interruption/suspension. Synchronized speakers would still need clock
estimation, buffering and drift correction, plus device testing.
[Web Audio rendering and interruptions](https://www.w3.org/TR/webaudio/#rendering-loop),
[AudioWorklet](https://www.w3.org/TR/webaudio/#AudioWorklet).

## Recommendation

Try the smallest static player against representative real sources first:
catalog fetch, playlist/segment fetch, playback, seeking and locked-screen
continuation on the intended devices. Add local IndexedDB state. If live
device-to-device control matters, test one WebRTC pair before designing a mesh.
Keep a small optional native/coordinator path only for demonstrated needs such
as incompatible source access, unattended lifetime, native discovery or managed
audio outputs. A static PWA is a credible simpler product if those capabilities
are optional; retaining all of them through a browser mesh is not automatically
simpler than one small coordinator.
