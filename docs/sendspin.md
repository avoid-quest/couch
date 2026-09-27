# Sendspin output groups

Couch uses `aiosendspin` 9.1.1 in an optional Python helper. The SDK owns clocks, negotiated codecs, buffering, encrypted transport and group synchronization. Core keeps the queue, source resolver, decoder and session assignment. Browser/native output remains available without Python or Sendspin.

## Operator installation

The helper is an explicitly installed file, not an assumed file beside a compiled Core executable. Configure absolute Python, script and private state-directory paths. The runtime does not install dependencies or download code.

```sh
python3.12 -m venv /opt/couch-sendspin
/opt/couch-sendspin/bin/pip install --no-deps -r deploy/sendspin/requirements.lock
install -m 755 src/server/sendspin-server.py /opt/couch-sendspin/sendspin-server.py
```

Run these as the account owning the installation, using appropriately owned paths. Python 3.12 and the frozen dependency versions were qualified on Linux arm64. FFmpeg runs on Core's machine through the same bounded decoder used by Snapcast. The helper receives decoded PCM and no provider URLs or authorization headers. SDK and CLI are Apache-2.0; dependency license/version details must accompany packaged distributions.

`SendspinConfig` selects `python`, `script`, `stateDirectory`, `name`, IP `host` (default127.0.0.1), `port`, optional `ffmpeg`, and optional `qualifiedClientIds`. The SDK listener is separate from private stdio control. Set an explicit LAN address, `0.0.0.0` or `::` to accept remote speakers. The SDK requires encrypted Noise transport and pairing; unencrypted legacy clients are disabled. Private Core control remains stdio. Remote speakers can join and play, but their output timing remains unverified unless separately qualified.

## Pairing and groups

Discovery does not authorize playback. The administrator starts dynamic-PIN pairing, reads the PIN on the selected speaker, and enters it in Couch. Only methods advertised by the actual client are offered. The helper uses the SDK's pairing implementation and persistent `FileServerPairingStore`; the server identity stays stable in the private state directory. PINs and key material are never included in ordinary target snapshots.

The first setup has no joined members. Select paired clients to form the output group. Membership and output volume come from SDK observations. Removing a client ends its stream; rejoining uses the SDK's current group schedule. Restart/reconnect restores identity, trust and chosen members, waits the one-second startup buffer fence, and leaves transport idle. Backend or complete member loss invalidates the target and cancels decoding.

## Timing and handoff limits

Generic clients are marked `handoffSafety: unverified`; active session transfer must fail closed. A stop response means the SDK accepted the operation, not that a physical speaker acknowledged silence.

The qualified software-output path uses the official Python CLI commit `511645a9c685544250037f801b63bbc86b6e9000`, SDK9.1.1, two PulseAudio null sinks, 48kHz/s16/stereo PCM, zero static delay, and reported startup/minimum buffers no greater than500ms. `qualifiedClientIds` is an operator assertion that those specific persisted identities still use that qualified configuration. Merely giving an arbitrary speaker's ID this flag does not qualify it. A changed or unknown output invalidates that assertion.

For those clients only, Couch bounds SDK send-ahead to500ms, permits one20ms PCM request at a time, sends clear/end, then waits one second before reporting transport silence. This includes the configured software pipeline and a conservative margin; it is not a universal Sendspin timing constant. Actual baseline captures measured stop return preceding silence by32–34ms and clear seek tails of7–59ms. Physical outputs, external audio latency and long-run drift remain unqualified. SDK-observed static delay/buffer changes remove qualified handoff eligibility.

Content position is calculated in the SDK's server-monotonic clock from scheduled frame timestamps and source offsets. It remains explicitly estimated. Pausing checkpoints that timeline before discarding buffered output; seeking resets both the decoder and SDK stream generation. Source starvation freezes the last scheduled content position instead of advancing a fictitious clock.

## Bridge lifecycle

Core and helper exchange private versioned NDJSON over stdio. Frames are limited to16KiB, control requests to32, and PCM to one3,840-byte request in flight. Base64 PCM is a bounded local transport choice; no new synchronization protocol is involved. SDK backpressure prevents unbounded decode-ahead. Priority clear/stop cancels pending PCM work and rejects stale epochs. Malformed output, broken IPC, unknown silence or helper failure makes the target unavailable.

## Qualification

`tests/linux/sendspin.ts` uses the actual production adapter/helper plus two actual CLI clients and separate Pulse monitor recordings. It checks PIN pairing, durable trust, membership after restart, remote HTTP playback, pause/seek/stop silence, per-member volume, removal/rejoin and backend recovery without autoplay. Results and PCM recordings go to `.artifacts/sendspin`. These are software-sink checks, not an audible-sync claim.

Prepare the test image with Python3.12, PulseAudio, FFmpeg, PortAudio/ALSA, frozen SDK dependencies and the pinned CLI source. The default image name is `couch-sendspin-qualification:9.1.1`; override with `COUCH_SENDSPIN_IMAGE`. Each run uses its own disposable container and keeps other services untouched.

```sh
bun tests/linux/sendspin.ts
```

A reproducible fixture image uses the same lock and pinned client source:

```dockerfile
FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg pulseaudio libportaudio2 libasound2-plugins libsndfile1 ca-certificates
COPY deploy/sendspin/requirements.lock /requirements.lock
RUN pip install --no-deps -r /requirements.lock && pip install 'https://github.com/Sendspin/sendspin-python-cli/archive/511645a9c685544250037f801b63bbc86b6e9000.tar.gz'
```

Build that recipe from the repository root with tag `couch-sendspin-qualification:9.1.1`. PIN logs and private trust material stay in ignored test artifacts.

The published CLI7.5.0 requires SDK6.x and is **not** compatible with this pinned SDK9.1.1 environment. Use the qualified source commit, not an unversioned latest CLI installation.
