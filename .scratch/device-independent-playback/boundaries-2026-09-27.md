> Historical qualification at the revisions below. The later local-only scope
> retires public deployment and Snapcast; [map.md](map.md) owns the active backlog.

# Playback boundary qualification — 2026-09-27

Both optional Sendspin roles remain implemented. This continuation qualified real
software boundaries and fixed missing connection-status text. It adds no playback
architecture, window/navigation/layout changes, Python runtime or Jellyfin work.

## Revisions and receipts

Baseline `f38c3bc34a7ef9f6991646d5f221bdc90cb3ceb4` supplied the actual browser
handoff, independent protocol peers, compiled Core service and HTTPS tests below.
Integrated `64ae44e94e1d0aac63986c07413429ee8463358f` adds the host enrollment
documentation and client status fix; the workload's before/after revision and
runtime-source hashes match. Receipts/scripts remain under
`.artifacts/sendspin-boundaries/`; archived experiments and stash
`6b5303026b2056bdbf34fb39efd05923bac7de72` remain intact.

The final committed head is checked with `bun run verify --remote` in the existing
Linux test image. Its exact before/after SHA, cleanliness, exits and eligibility
are retained in `.artifacts/sendspin-boundaries/final-verify/verification.json`.
Use that receipt for the final gate, rather than treating an earlier SHA as current.

## Actual boundaries

- **Browser → group → browser:** the shared Couch application and its actual HTML
  renderer moved paused playback at 32 seconds/1.25× to two official SDK Web Audio
  outputs. Browser media became `src=null`, readyState 0; both outputs subsequently
  measured RMS about 0.062. Return preserved session, queue and speed, resumed the
  actual browser around 56.63 seconds, and left both output graphs at zero RMS.
  Browser progress then advanced to 86.24 seconds; Stop released its source and
  reached idle. Transfer acknowledgments took 1.029 s outward and 2.052 s back,
  including configured drain fences. Actions used authenticated control messages;
  this is actual rendering, not a simulated endpoint or physical-silence proof.
  Receipts: `handoff/browser-events.json`, `handoff/outputs.json`.
- **External receiver → Couch:** a separate `node-sendspin` 0.6.2 client process
  used persistent identity, AES-GCM and provisioned long-term PSK. It received 148
  encrypted PCM frames of 3,840 bytes; a generated 440 Hz source measured about
  450 Hz in the first 20 ms frame. Revoking its owning controller denied a fresh
  connection with the same identity. That fixture disconnected before revocation;
  active Couch revocation remains covered by the existing real-SDK hub tests.
  Receipts: `external/receiver-{connected,revoked,pcm}.json`.
- **Couch client → external server:** the production client adapter connected to
  an independent maintained TypeScript server after out-of-band PSK provisioning,
  automatically reconnected after transport loss, and stayed disconnected after
  server-side revocation deleted the PSK and terminated its active socket. This
  qualifies provisioned protocol interoperability; the fixture implements no PIN
  server and its provisioning endpoint is not Couch's Another server UI.
  Receipt and reproduction: `external/REPORT.md` and its TypeScript fixtures.
- **Connection status:** SDK `connect()` resolves on WebSocket open before an
  admitted state is observed. The dialog now retains waiting/pairing or reconnect
  status until observed connection changes; pairing and Leave remain usable.
  The focused UI regression passes three repetitions, including Leave/rejoin state
  reset. The actual shared app displays the waiting state against an unprovisioned
  external host; Leave returns to the form with zero media elements.
  Receipt: `handoff/status-fixed.json`.

## Deployment

The clean compiled Linux arm64 Core passes six process checks: private Core-only
startup, embedded frontend serving, initial administrator pairing, recovery,
restart persistence and SIGTERM. The shipped unit passes `systemd-analyze verify`.
The disposable systemd PID1 probe exits 255 before service launch. Receipt:
`deployment/qualification.json`, including binary SHA256 and commands.

Two actual WebKit browsers pair through Caddy 2.11.4 at
`https://localhost:9443/saved`, register over authenticated WSS, play direct media
from the separate HTTPS origin `https://localhost:9444`, transfer paused playback,
resume, and stop on destination revocation (HTTP 401, WSS loss, renderer removal).
The fixture CA is trusted only inside the disposable container; no host trust or
public port changes. Receipt: `deployment/https/qualification.json`. The helper's
historical “HTTP remote” check labels refer to these actual HTTPS browser URLs.
The same journey passes H.264/AAC video (320×180 decoded dimensions) after installing
Ubuntu's maintained `gstreamer1.0-libav` and `gstreamer1.0-plugins-bad` in the
disposable guest. The stock guest reported no MP4 support and media error 4; with
the plugins it reports “probably” and decodes the unchanged MP4. This was a test
environment dependency gap, not an application fix. The successful receipt is
`deployment/https/qualification-video.json`; failed attempts are retained.
This qualifies the local TLS/proxy/browser topology, not public DNS/WAN routing.

## Full software workload

The production adapters and actual Core ran direct browser playback concurrently
with a personal Sendspin group, two Web Audio outputs and 20 authenticated idle
Couch controller sockets. The fixture is a small adapter page, not 20 full UI tabs.
Audio and H.264/AAC 640×360 video scenarios each ran for about 15 seconds. Video
decoded frames advanced 27 → 360 and position 1.01 → 15.01 seconds. Both group
outputs reported playing. No bottleneck was established, so no optimization was made.

| Cost | Audio scenario | Video scenario |
| --- | --- | --- |
| Core CPU during window | 0.25 CPU s / 15.044 s (1.66% of one core) | 0.22 CPU s / 15.038 s (1.46%) |
| Core RSS, start → end | 92,864 → 106,624 KiB | 93,568 → 108,032 KiB |
| FFmpeg complete process | 0.09 CPU s; 18,628,608 B peak RSS | 0.14 CPU s; 21,184,512 B peak RSS |
| Sendspin encrypted WS payload out | 5,824,906 B | 5,824,922 B |
| Source bodies, two requests total | 23,040,088 B | 21,226,290 B |
| 12 command round trips | 0.345–0.892 ms | 0.320–0.622 ms |

FFmpeg decoded the short fixture in 0.38 seconds, then Core paced buffered PCM;
its complete process CPU/peak memory includes startup and is not a steady-state
decoder percentage. The video window also records **all T3 browser helper
processes**, including renderers and GPU/utility services: 3.17 CPU seconds and
4,941,168 → 4,995,168 KiB aggregate RSS. This includes unrelated tabs; per-tab
attribution is unavailable and these totals are not Couch-only browser costs.
Individual process rows are retained. Twenty idle controller sockets received
1,778,156 application bytes in the video window and fetched no media. Source counts
include served range bodies; WS counts exclude frame/TCP overhead. These short
local fixtures establish accounted costs, not high-resolution or long-soak budgets.
Receipts: `workload/audio-report.json`, `workload/video-report.json`, timed decoder
logs and fixture source. No synthetic renderer observations replace media decoding.

## External blockers and next actions

| Remaining qualification | Evidence / blocker | Exact next action |
| --- | --- | --- |
| External PIN pairing and PIN-only receiver enrollment | Latest host dependency 0.6.2 lacks server PIN/pairing-PSK/trust-store APIs; Rust alternative documents client foundations. User confirms no external Sendspin server is available. | When a maintained TS/Rust host implements pairing, integrate its public API with the existing store, then run Another server PIN confirmation, reconnect and revocation against it. Until then use the verified authenticated PSK alternative in [Sendspin configuration](../../docs/sendspin.md). |
| Bounded retry after denied encrypted handshake | SDK 5.0.0 resets retry count on WebSocket open; revocation remains enforced but repeated attempts continue as “1/7”. Leave stops retries. | Qualify an upstream SDK fix that counts failed admission across open/close cycles, then rerun the retained revoke fixture. Keep protocol/retry internals in the maintained dependency. |
| Actual systemd startup/recovery/boot | User confirms no Linux device; container PID1 probe exits 255. Compiled-process and unit checks pass. | On the intended Linux systemd host, install the exact binary/unit with a fresh data directory, start/pair/restart/stop, then reboot and verify recovery per [service guide](../../docs/core-service.md). |
| Native/physical platform behavior, speaker drift, latency and silence | No Linux/TV/speaker test setup or synchronized physical capture is available. Existing native libmpv receipts are software/Xvfb/null-sink evidence. | On each intended native platform and actual output configuration, run the retained native receiver journey; record synchronized speaker capture across pause, seek, loss and transfer before granting output qualification. |
| Public HTTPS deployment and per-device resource budgets | Only isolated local TLS topology is available; browser-process attribution includes other T3 tabs. | Repeat the retained HTTPS journey at the intended trusted deployment and rerun workload fixtures on isolated target devices with per-process attribution and representative media. |

No merge or release was performed. Implementation and evidence remain on the
existing owning stack layers #631, #632 and #633.
