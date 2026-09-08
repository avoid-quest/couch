# TV sound routing qualification

Issue: [Choose an audio output and test TV sound](https://github.com/avoid-quest/couch/issues/14).

The September 8, 2026 disposable Ubuntu ARM64 run passed 32 checks using the actual Tauri/libmpv player, paired remote, PipeWire, WirePlumber and two synthetic output sinks. It verified current and subsequent routing, observed system volume/mute and external changes, persistent delay, selected-output loss, explicit resume, a queued lossless-track transition, and restart without autoplay. The adopted successor retained its playback identity through output loss and explicit resume.

The alternate sink monitor produced samples before the selected sink was removed. Its capture contained 220,800 bytes of signed 16-bit stereo PCM at 48 kHz: 110,400 channel samples, all zero. A silent stream kept the alternate output's clock active. Both Pulse clients used 50 ms latency. Earlier empty captures were fixture failures and supplied no silence evidence.

The native run exposed an actual recovery defect: setting the unchanged `audio-device` did not reopen mpv's null output after reconnection. The explicit output action now calls `ao-reload`, following mpv's bundled null-output recovery example. Reconnection stays paused; both ordinary and adopted-track explicit resume restored the selected route in the passing run.

## Reproducible identities

- Native application source: `4a166ef1d236e335b5cac53447dcd6c77dc937d6`, clean build identity, `aarch64-unknown-linux-gnu`, debug, Bun 1.4.2. This includes the expiry/gapless integration and native failed-open correction.
- Final fixture: `14c2b45e045fbaffbd83c87683b979d95b177e09`. Changes after the application build only dismiss the initial setup dialog and wait for the restarted server before connecting.
- Native SHA-256: `b21a73b3b524a03bf72da5c872f5bb309b665e29490d77bda90b68e35b163a62`.
- Sidecar SHA-256: `c67350aa9634748aeeb5b62c756bd5c6a4f8e0b637f26ccfbea28f4c13b3ea1b`.
- Fixture entry point: `tests/linux/sound-routing-run.sh`. Supply an exact `git bundle create source.bundle HEAD` at `/artifacts/source.bundle`, private writable `/work`, private Cargo caches, and PipeWire/Pulse tools. The runner checks out the bundle in the disposable container and refuses a dirty or missing build identity. It bounds the runtime to 180 seconds.

Local evidence is retained under `/tmp/couch-sound-route-20260908/.artifacts/sound-native/`: `run-final.log`, `sound-routing-result.json`, `fallback-monitor.pcm`, `build-info.json`, binary hashes and `bin-4a166ef/`. The container was stopped after qualification. No T480 settings or user data changed.

Focused source checks passed for routing/profile rollback, administrative revocation, stable identities, actual volume, paused provider reports, canceled source recovery, and loss across queued adoption. The native build and 31 application Rust checks passed; the integrated native failed-open regression also passed.

## Remaining physical acceptance

This establishes software behavior with real audio-server streams, not physical audibility. The actual Ubuntu user session still needs HDMI and internal analog profile activation, phone selection, audible left/right tests, hardware volume keys, unplug/replug and session restart. Wireless outputs require an already available Ubuntu sink. Profile activation/rollback has source-test and official JSON-schema coverage; the container has no physical audio card. Issue 14 remains open for that acceptance.
