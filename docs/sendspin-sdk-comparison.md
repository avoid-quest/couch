# Sendspin SDK timing comparison

**Subsequent owner decision:** Noise and the current upstream release are now
authorized. This review describes the earlier 3.2.1 baseline; its plaintext-only
constraint and recommendation to build a pre-Noise revision are superseded. See
[current integration](live-audio.md) and the [5.0.0 field run](sendspin-upstream5-20261027.md).

Research date: 2026-10-27. This is a source review, not a native-versus-browser
latency measurement. The sequential 150 ms then 100 ms field checks keep Couch's
existing implementation unchanged, with both receivers measured together at
each setting.

## Findings that affect Couch

- **250 ms is a configurable player default.** Couch explicitly uses the same
  value for Live. It is neither a JavaScript language limit nor a minimum imposed
  by the Sendspin protocol. Both the JavaScript and Python SDKs default their
  startup lead and ongoing minimum buffer to 250 ms. [1][2][3]
- **The pinned browser SDK has an upstream timing fix available.** Official
  Sendspin PR [#159](https://github.com/Sendspin/sendspin-js/pull/159) removes the
  fixed 200 ms scheduling offset, the compensating platform delay defaults, and
  an inconsistency between its render and output clocks. Published 3.2.1 predates
  that fix; published 4.0.0 and 5.0.0 include it. This is a concrete upstream
  implementation difference, not evidence that a different language is needed.
  [4][5]
- **Native defaults are not automatically faster.** The current C++ SDK requests
  **500 ms** of ongoing protocol buffer. Its reference CLI's **100 ms** setting
  controls the output backend's buffer, a different layer. The Python reference
  player also uses a deliberately buffered output configuration. [6][7][8]
- **Current releases have a compatibility cost.** The latest official receiver
  SDKs use Noise. That does not change Couch's requirement to retain plaintext:
  replacing the working baseline with their newest releases would not be a
  drop-in change. Importantly, the exact upstream JS timing-fix commit predates
  Noise and is a possible later, bounded experiment without implementing our own
  player. It has not been built or measured here. [4][9][10][11]

## What the 250 ms setting actually means

There are two distinct protocol requests:

| Field | Purpose | Pinned JS 3.2.1 default | Couch Live behavior |
| --- | --- | --- | --- |
| `required_lead_time_ms` | Startup allowance after starting or clearing a stream | 250 ms | Inherits SDK default |
| `min_buffer_ms` | Audio requested ahead of ongoing playback | 250 ms | Explicit `minBufferMs`, initially 250; public setter updates it |

Sources: the versioned JS
[protocol handler](https://github.com/Sendspin/sendspin-js/blob/830e8f1062b44746606b368e7e8823fe565f8b3c/src/core/protocol-handler.ts),
Couch's [defaults](../src/shared/audio-settings.ts) and
[player integration](../src/client/session/sendspin.ts). [1][2]

The current official protocol says players should report the lowest values that
reliably avoid underruns and truncated starts under expected conditions. Startup
lead is a hint: for Live, the server should not add latency just to reach it.
Ongoing send-ahead includes the minimum buffer and the player's output-delay
compensation. A group uses its most demanding player. The server may retain a
larger lead after a timing requirement decreases to avoid a playback glitch. [12]

Couch's [capture scheduler](../src/server/scheduled-audio.ts) uses the maximum of
the receivers' `minBufferMs + staticDelayMs` for Live captures and retains the
larger lead within the same capture generation. That is why the 150/100 ms checks
need fresh shares. Leaving startup lead at 250 ms does not by itself impose a
250 ms ongoing floor.

The SDK source establishes the defaults, but does **not** provide a measurement
or engineering rationale proving that 250 ms is optimal for Couch's devices.
The justified way to choose between these values is the electrical comparison
and subsequent stability evidence.

## Browser output: pinned 3.2.1 versus published 5.0.0

| Item | JS 3.2.1 used by Couch | Published JS 5.0.0 |
| --- | --- | --- |
| Startup / ongoing defaults | 250 / 250 ms | 250 / 250 ms |
| Public timing controls | Constructor values, `setRequiredLeadTimeMs`, `setMinBufferMs`, sync-delay controls | Same timing controls |
| Fixed scheduler offset | Adds 200 ms to mapped playback target | Removed |
| Platform default static delay | Linux/Android 200 ms; other platforms 150–250 ms | Platform defaults removed; zero absent explicit/persisted configuration |
| Desktop output without supplied audio element | Direct Web Audio | Direct Web Audio |
| Mobile output | Web Audio through a media stream / audio element | Same output-mode selection |
| `AudioContext` construction | Sample rate specified; no explicit `latencyHint` | Same |
| Plaintext protocol transport | Supported | Every connection uses Noise |

Sources: exact published sources [1][4][9][13]. npm currently reports 5.0.0 as
`latest`; there is no published 3.2.2 or 3.3 release between 3.2.1 and 4.0.0. [5]
Current upstream HEAD, checked at
[`18d6658`](https://github.com/Sendspin/sendspin-js/tree/18d6658ef815f852bde53f26b0bc2214e508ca2d),
retains the 250/250 defaults and the scheduler without the fixed offset.

For 3.2.1, the simplified first-chunk scheduling equation is:

```text
mapped server playback time + 200 ms - reported output latency - static delay
```

The server separately includes that static delay in its send-ahead. Therefore
the observed `static_delay_ms: 200` is **not another independent 200 ms to add to
the scheduler's fixed offset or subtract a second time from a latency forecast**.
Changing only static delay can just move time between sender and receiver while
leaving the electrical result unchanged. The correct upstream fix addresses the
whole mapping, including clock-domain consistency. [4]

The official fix's explanation is explicit: the old 150–250 ms platform delays
mostly canceled the 200 ms scheduler slack, obscuring the timing and leaving web
players behind native players. It also normalizes `getOutputTimestamp()` into the
render-clock domain so changing clock sources does not shift playback. Its
tests check the modeled audible instant, not just the requested `start()` time.
These are upstream tests and reasoning, not measurements of this rig. [4]

Couch supplies no audio element. The SDK therefore already selects direct
Web Audio on the Linux receiver and the media-element path on Android. Moving
Linux to direct output is not an unimplemented opportunity. A native capture
source and browser playback are independent choices; changing receiver SDKs
does not require abandoning native input capture. [2][13]

### A plaintext-compatible upstream opportunity

The merged official timing-fix commit is
[`1e8f4d49f77d63d6d42ba16ef4888d3b801e0f3b`](https://github.com/Sendspin/sendspin-js/commit/1e8f4d49f77d63d6d42ba16ef4888d3b801e0f3b).
It is after 3.2.1 and before the Noise introduction
[`7a243389`](https://github.com/Sendspin/sendspin-js/commit/7a243389e8cfc1a091bd19cd6de9054c0147ecc2).
Its core still uses the ordinary WebSocket protocol handler and has no Noise
transport. The
[official comparison](https://github.com/Sendspin/sendspin-js/compare/830e8f1062b44746606b368e7e8823fe565f8b3c...7d103075138dda5c8909045647bb42b33c2d44fc)
shows this order. [4][10]

A follow-up could build and pin that exact **unmodified official commit**, with
a reproducible artifact, then repeat one existing measurement. It is an
unreleased intermediate revision, so that should be recorded explicitly. It is
not a request to edit `node_modules`, copy out a scheduler, or build a custom
engine. Any old persisted static-delay compensation must be accounted for;
upstream specifically says to reset compensations made for the old timing.
No such experiment or state migration was performed during this research.

Source inspection bounds the follow-up further:

- Relative to the installed 3.2.1 source commit, this exact revision contains
  **two** merged changes: FLAC buffer-capacity derivation (#158) and the timing
  correction (#159). It is not just a one-line removal. No package dependency
  manifest change is part of that comparison. [18]
- Couch's used configuration fields (`playerId`, `baseUrl`, `clientName`,
  `storage`, `codecs`, `minBufferMs`, `onStateChange`) and used public methods /
  getters (`connect`, `disconnect`, `unlock`, `setMinBufferMs`, `isConnected`,
  `timeSyncInfo`, `trackProgress`) remain present at that revision. That is a
  source-level compatibility check, **not a successful Couch build or runtime
  test**. [18]
- The repository does not track `dist`, although its package exports point
  there. Its `prepare` only runs Husky; a Git dependency alone does not provide
  an already built published package. Its official release workflow uses Node
  24, `yarn install --frozen-lockfile` and `yarn build`, then publishes the built
  `dist`. The source package's `0.1.0` version is a placeholder replaced during
  releases, not the identity of this experimental revision. [18]
- The checked-in Yarn v1 lock pins runtime `opus-encdec` to 0.1.1, TypeScript
  to 6.0.3 and Vitest to 4.1.10. Preserve that lock and record the exact commit,
  build runtime and resulting artifact hash rather than resolve fresh caret
  dependencies. [18]

The maintenance cost is ownership of a reproducible package built from an
unreleased upstream revision and its compatibility checks until a suitable
published update is adopted. A scoped validation would build/test the original
upstream revision, build Couch with the artifact, verify unchanged public API /
plaintext handshake and codec negotiation, deliberately handle old delay state,
then repeat one electrical run at the already selected buffer. It would not
establish long-term support or automatically include later upstream fixes.

## What the other official implementations do

The project's [SDK catalogue](https://www.sendspin-audio.com/build/sdks/) lists
C++, Python and JavaScript client SDKs; Python is the reference server library.
It recommends **sendspin-cpp-cli** as the reference player and describes the
Python client library primarily as a reference/testing client. It lists a C++
server as planned, not implemented. These are separate roles and deliverables.
[14]

| Implementation reviewed | What it provides | Timing / output behavior in source | Interpretation |
| --- | --- | --- | --- |
| Official `sendspin-cpp` v0.9.5; current HEAD `985fba57` | Native/embedded client library; application supplies output callbacks | Startup pipeline allowance derives from 25 ms priming + 50 ms extra silence + 75 ms allowance = 150 ms by default; reported lead cannot fall below derived allowance. Ongoing `min_buffer_ms` defaults to 500. Both have configuration fields. | A native library with explicit timing control, not a measured low-latency preset. The 500 ms default intentionally tolerates shared Wi-Fi interference. [6] |
| Official `sendspin-cpp-cli` v0.4.0; current HEAD `b052a43b` | Standalone native reference player built on `sendspin-cpp` | Released CLI pins library v0.9.5, leaves its protocol timing defaults in place, and defaults output `--buffer-ms` to 100 (accepted range 10–2000). Backends include ALSA, CoreAudio, PortAudio, PulseAudio and PipeWire; actual granted buffering can exceed request. | The CLI's 100 ms is an output-backend request, **not** its protocol minimum or an end-to-end claim. A default run would still advertise 500 ms ongoing minimum. [7] |
| Official `aiosendspin` 10.2.2; current HEAD `af5aacca` | Async Python client and reference server SDK | Client defaults required lead / minimum buffer to 250 / 250 ms, exposes constructor values and public setters, and delivers audio through callbacks rather than providing a complete device-output engine. | Changing protocol-library language alone does not select a faster audio backend. [3][14] |
| Official `sendspin-python-cli` 9.1.0; current HEAD `ede55927` | Standalone Python player using `aiosendspin` | Does not override the SDK's 250/250 requests. Its output handler has a 200 ms startup queue threshold and uses `sounddevice.RawOutputStream` / PortAudio with 2048-frame callbacks and `latency="high"` (2048 frames ≈42.7 ms at 48 kHz). | A buffered reference player, not evidence that Python delivers lower Live latency. These are different layers; do not simply add all constants as an end-to-end total. [8] |
| Community `@sonn-audio/node-sendspin` 0.6.2 used by Couch | Node server/client protocol building blocks | Server exposes reported receiver timing through public APIs. Client provides audio callbacks and clock mapping; it does not supply a complete browser/native output backend. Plaintext is supported; Noise is opt-in. | This is not another official native playback SDK. Couch's existing capture scheduler, rather than this package having a universal 250 ms preset, chooses the Live presentation lead from receiver requests. [11] |

The catalogue's official status applies to the Sendspin organization projects.
`sonn-audio/node-sendspin` is a separate maintainer's implementation and is not
listed there as an official SDK. Its own README describes it as tracking the
reference implementation. [11][14]

Latest release versions above were checked through each project's GitHub
release endpoint on the research date. Source assertions use the named release
or exact commit, not an assumption that every release equals current `main`.
No native player was installed, built or run on the rig for this comparison.

Current C++ explicitly documents no cleartext transport, current JS states every
connection is encrypted, and the current Python client uses the Noise handshake.
This limits their interchangeability with this particular plaintext baseline;
it does not authorize changing Couch's encryption policy. [9][15][16]

## Does JavaScript impose the remaining latency?

The evidence does not support a 250 ms JavaScript floor. It shows configurable
timing requests, an old SDK-specific 200 ms scheduling offset already corrected
upstream, and different desktop/mobile output paths. Those should be resolved
before attributing a number to the language.

The Web Audio standard provides scheduled audio playback and describes
`latencyHint` as a browser-interpreted preference. Its default is already
`"interactive"`, meaning the lowest output latency possible without glitching.
Omitting that option in this SDK is therefore not evidence that it accidentally
selected the high-latency `"playback"` preset. Actual `baseLatency` and
`outputLatency` depend on the browser, operating system and output device. [17]

Browser execution, timer delivery, decoding and output buffering still matter.
Native backends expose different controls and clocks and may ultimately improve
the achievable result or resilience. But the same SDK can run inside Electron
and remain a browser audio implementation, while Python's output library can
call native PortAudio. Language names alone do not identify the audio path.
The reviewed sources supply **no defensible physical lower bound** for this
Linux/Android pair and do not establish a stable 30 ms Couch mode.

The scoped next decision is to use the 100/150 ms electrical results to choose
a promising buffer, then consider one exact upstream timing-fix comparison.
Native receiver work should answer a demonstrated remaining bottleneck rather
than precede that comparison. This preserves Sendspin and native capture while
avoiding another implementation campaign.

## Primary sources

1. JS 3.2.1 exact npm source commit [`830e8f1062b44746606b368e7e8823fe565f8b3c`](https://github.com/Sendspin/sendspin-js/tree/830e8f1062b44746606b368e7e8823fe565f8b3c): [`src/core/protocol-handler.ts`](https://github.com/Sendspin/sendspin-js/blob/830e8f1062b44746606b368e7e8823fe565f8b3c/src/core/protocol-handler.ts), [`src/audio/scheduler.ts`](https://github.com/Sendspin/sendspin-js/blob/830e8f1062b44746606b368e7e8823fe565f8b3c/src/audio/scheduler.ts). Checked against installed package 3.2.1.
2. Couch: [`src/shared/audio-settings.ts`](../src/shared/audio-settings.ts), [`src/client/session/sendspin.ts`](../src/client/session/sendspin.ts), [`src/server/scheduled-audio.ts`](../src/server/scheduled-audio.ts).
3. Python 10.2.2 [`aiosendspin/client/client.py`](https://github.com/Sendspin/aiosendspin/blob/10.2.2/aiosendspin/client/client.py): constructor defaults, setters, callbacks.
4. Official JS [PR #159](https://github.com/Sendspin/sendspin-js/pull/159), [merged commit and complete diff](https://github.com/Sendspin/sendspin-js/commit/1e8f4d49f77d63d6d42ba16ef4888d3b801e0f3b), including modeled audible-output tests.
5. npm registry [full JS version metadata](https://registry.npmjs.org/@sendspin/sendspin-js), [3.2.1 metadata](https://registry.npmjs.org/@sendspin/sendspin-js/3.2.1), [5.0.0 metadata](https://registry.npmjs.org/@sendspin/sendspin-js/5.0.0).
6. C++ v0.9.5 [`include/sendspin/config.h`](https://github.com/Sendspin/sendspin-cpp/blob/v0.9.5/include/sendspin/config.h), [`src/player_role.cpp`](https://github.com/Sendspin/sendspin-cpp/blob/v0.9.5/src/player_role.cpp).
7. C++ CLI v0.4.0 [`CMakeLists.txt`](https://github.com/Sendspin/sendspin-cpp-cli/blob/v0.4.0/CMakeLists.txt), [`src/cli.h`](https://github.com/Sendspin/sendspin-cpp-cli/blob/v0.4.0/src/cli.h), [`src/cli.cpp`](https://github.com/Sendspin/sendspin-cpp-cli/blob/v0.4.0/src/cli.cpp), [`src/main.cpp`](https://github.com/Sendspin/sendspin-cpp-cli/blob/v0.4.0/src/main.cpp), [`src/audio_sink.cpp`](https://github.com/Sendspin/sendspin-cpp-cli/blob/v0.4.0/src/audio_sink.cpp).
8. Python CLI 9.1.0 [`sendspin/audio.py`](https://github.com/Sendspin/sendspin-python-cli/blob/9.1.0/sendspin/audio.py), [`sendspin/daemon/daemon.py`](https://github.com/Sendspin/sendspin-python-cli/blob/9.1.0/sendspin/daemon/daemon.py), [`sendspin/tui/app.py`](https://github.com/Sendspin/sendspin-python-cli/blob/9.1.0/sendspin/tui/app.py).
9. Published JS 5.0.0 source [`7d103075138dda5c8909045647bb42b33c2d44fc`](https://github.com/Sendspin/sendspin-js/tree/7d103075138dda5c8909045647bb42b33c2d44fc): [`README.md`](https://github.com/Sendspin/sendspin-js/blob/7d103075138dda5c8909045647bb42b33c2d44fc/README.md), [`src/core/protocol-handler.ts`](https://github.com/Sendspin/sendspin-js/blob/7d103075138dda5c8909045647bb42b33c2d44fc/src/core/protocol-handler.ts), [`src/audio/scheduler.ts`](https://github.com/Sendspin/sendspin-js/blob/7d103075138dda5c8909045647bb42b33c2d44fc/src/audio/scheduler.ts).
10. Plaintext core at timing-fix commit [`src/core/core.ts`](https://github.com/Sendspin/sendspin-js/blob/1e8f4d49f77d63d6d42ba16ef4888d3b801e0f3b/src/core/core.ts); subsequent [Noise introduction](https://github.com/Sendspin/sendspin-js/commit/7a243389e8cfc1a091bd19cd6de9054c0147ecc2).
11. Node 0.6.2 [npm metadata](https://registry.npmjs.org/@sonn-audio/node-sendspin/0.6.2), exact [`README.md`](https://github.com/sonn-audio/node-sendspin/blob/bb435a032e8a55aba0ef95a5945f961b5b3a6082/README.md), [`src/server/session.ts`](https://github.com/sonn-audio/node-sendspin/blob/bb435a032e8a55aba0ef95a5945f961b5b3a6082/src/server/session.ts).
12. Official [player specification, Server Audio Send Constraints](https://www.sendspin-audio.com/build/spec/#server-audio-send-constraints).
13. Output selection in pinned JS [`src/index.ts`](https://github.com/Sendspin/sendspin-js/blob/830e8f1062b44746606b368e7e8823fe565f8b3c/src/index.ts) and published 5.0.0 [`src/index.ts`](https://github.com/Sendspin/sendspin-js/blob/7d103075138dda5c8909045647bb42b33c2d44fc/src/index.ts).
14. Official [SDK catalogue](https://www.sendspin-audio.com/build/sdks/), checked 2026-10-27.
15. C++ v0.9.5 [encryption and pairing integration guide](https://github.com/Sendspin/sendspin-cpp/blob/v0.9.5/docs/integration-guide.md#encryption-and-pairing).
16. Python 10.2.2 [`aiosendspin/client/connection.py`](https://github.com/Sendspin/aiosendspin/blob/10.2.2/aiosendspin/client/connection.py).
17. W3C [Web Audio: `AudioContextOptions`](https://www.w3.org/TR/webaudio/#dictdef-audiocontextoptions), [latency categories](https://www.w3.org/TR/webaudio/#enumdef-audiocontextlatencycategory), [`baseLatency`](https://www.w3.org/TR/webaudio/#dom-audiocontext-baselatency), [`outputLatency`](https://www.w3.org/TR/webaudio/#dom-audiocontext-outputlatency).
18. Exact pre-Noise fix revision: [comparison from 3.2.1](https://github.com/Sendspin/sendspin-js/compare/830e8f1062b44746606b368e7e8823fe565f8b3c...1e8f4d49f77d63d6d42ba16ef4888d3b801e0f3b), [`package.json`](https://github.com/Sendspin/sendspin-js/blob/1e8f4d49f77d63d6d42ba16ef4888d3b801e0f3b/package.json), [`yarn.lock`](https://github.com/Sendspin/sendspin-js/blob/1e8f4d49f77d63d6d42ba16ef4888d3b801e0f3b/yarn.lock), [`src/types.ts`](https://github.com/Sendspin/sendspin-js/blob/1e8f4d49f77d63d6d42ba16ef4888d3b801e0f3b/src/types.ts), [`src/index.ts`](https://github.com/Sendspin/sendspin-js/blob/1e8f4d49f77d63d6d42ba16ef4888d3b801e0f3b/src/index.ts), [`release.yml`](https://github.com/Sendspin/sendspin-js/blob/1e8f4d49f77d63d6d42ba16ef4888d3b801e0f3b/.github/workflows/release.yml), [`.gitignore`](https://github.com/Sendspin/sendspin-js/blob/1e8f4d49f77d63d6d42ba16ef4888d3b801e0f3b/.gitignore).
