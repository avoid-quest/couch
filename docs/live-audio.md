# Live audio

Live plays an audio input on every listening device as it happens: the input reaches each listener within a shared lead, and all listeners play the same sample at the same moment. [ADR 0003](adr/0003-live-audio-uses-couchs-own-timestamped-stream.md) records why it has its own stream. Relaxed sharing (Audio input without Live, AirPlay, In sync) stays on Sendspin.

```text
couch-capture (native, 128 frames)
  → Main: clock mapping, upload
    → Core audio worker: timestamped PCM / Opus packets, shared lead
      → /api/live/listen (one WebSocket per listener)
        → listener Worker: clock fits, decoding
          → AudioWorklet: plays each sample at capture time + lead
```

## Shared lead

- Every listener reports what it needs: its output latency plus the margin it measured.
- Core sets one lead for the share and schedules each change at a host time, so all listeners move together. It rises after two elevated reports and falls by up to 10 ms every 6 s once 12 s of reports show it can.
- **Maximum** (100 ms by default) and **minimum** (0) are operator settings.
- **Raise for the slowest** (on by default): the lead rises for the slowest listener, up to the maximum. Off: a listener that needs more than the others by itself doesn't move the lead.
- A listener the lead can't cover keeps playing, **behind by** what it lacks. It's never refused; only the operator removes it.

## Listener recovery

Late audio never turns into silence once the listener has started. The listener holds, then catches up within 8 s by resampling up to ±2% (about 35 cents) and time-stretching up to 20%. A debt it can't repay that way is skipped with a 20 ms crossfade. A device whose output is always late settles at its real delay.

## Measured

Rig: a MacBook Air host with a UMC404HD. Out 3/4 is looped into in 1/2 as the input, and each listener's output is recorded on in 3/4, all on the interface's clock. Pink noise, 10 minutes, wired Linux Chrome listener.

| | Lead | In 1/2 → listener, median (p05–p95) | Missing samples | SNR 1.26 / 8 / 12.7 kHz |
| --- | ---: | ---: | ---: | ---: |
| Sendspin Live, PCM | 75 (lowest clean) | 77.27 (77.23–77.49) ms | 0 | 29.7 / 14.5 / 9.2 dB |
| Sendspin Live, Opus 128k | 75 | 77.16 (77.14–77.39) ms | 912 | 15.1 / 4.7 / 0.3 dB |
| Prototype, PCM | 30 | 31.32 ms | 0 | 43 / 25 / 21 dB |
| Prototype, Opus 192k | 36 | 37.18 ms | 0 | — |

At lead 45, Sendspin Live admitted PCM listeners but had gaps and withdrew them. It refused Opus listeners: Linux needs 17 ms, and the deadline allowed 11–12.

On phones, output timing is reported 10–30 ms off what's measured, with nothing a page can observe. Phones are in sync with each other and with desktops to within that error, not to the sub-millisecond of wired desktops.
