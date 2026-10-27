# Default Sendspin Live electrical baseline

One bounded hardware run on 27 October 2026 measured the clean integration at
`cd0beb1db1d02655837d1f1f5f3276041a0c41a5`. No product code, codec policy or
buffer setting was changed for the run. No tuning or additional hardware run
followed it.

| Electrical measurement | Median | p05 | p95 | Accepted windows |
| --- | ---: | ---: | ---: | ---: |
| Input → Linux analog return | 404.8 ms | 404.2 ms | 405.6 ms | 113/113 |
| Input → Android analog return | 412.5 ms | 411.5 ms | 414.0 ms | 110/113 |
| Android minus Linux, paired windows | 7.5 ms | 6.1 ms | 9.5 ms | 110 |

These are physical input-to-output measurements. The configured 250 ms receiver
buffer is one setting in that path, not its total latency. This result establishes
an approximately 0.4-second default baseline on this setup; it does not decompose
the delay or establish the lowest stable latency.

## Setup and defaults

- Apple M1 MacBook Air, macOS 14.8.7; maintained Couch desktop bundles launched
  from an isolated scratch directory through the previously authorized Electron
  44.4.5 runtime. The installed Couch and its data were untouched.
- Native Behringer UMC404HD input: Automatic capture rate delivered 48 kHz stereo;
  default 128 input frames requested and reported. Capture helper SHA-256:
  `35937448c639dab650131fc3038998c67cecd5d11292d568e38e2362e7059411`.
- Live: Automatic codec, 250 ms minimum buffer. Both receivers negotiated stereo
  48 kHz Opus with the unmodified browser SDK 3.2.1 and Node SDK 0.6.2.
- Linux Chrome 156.0.0.0 on the existing private Pulse/onboard analog output
  route, over the wired network. No Chrome audio-buffer flag or Pulse latency
  override was supplied. The existing harness's foreground/browser-launch flags
  were retained; this is not a background or sleep test.
- Redmi Note 8T, Android 10, Chrome 155.0.0.0, Wi-Fi reception and analog return.
  USB/ADB controlled its real Chrome tab; audio used the network. Both Couch
  receiver volumes read 80%, unmuted. The phone screen was awake.
- Owner confirmed unchanged wiring/gains: UMC inputs 1–2 source loopback, input 3
  Linux return, input 4 Android return. One UMC IOProc played the existing pink
  stimulus on outputs 3–4 and recorded all four inputs on one sample clock.

## Recording and analysis

The first 60 seconds of the existing `pink-180s.f32` stimulus were used unchanged.
The recorder retained 61.0133 seconds including its tail: 2,928,640 four-channel
frames in 22,880 blocks of 128 frames. It exited 0, with zero ring overflows,
zero input/output sample-position discontinuities, no nonfinite samples and no
clipped samples on any channel.

Normalized cross-correlation compared each analog return against the recorded
source, using 0.5-second windows every 0.5 seconds, starting at 3 through 59
seconds, and a 0–1,500 ms delay search. Both returns identified reference input 1;
the independent right-channel reference gave substantially weaker correlation.
The 0.4 correlation cutoff is an analysis-confidence filter, not a product gate.
All windows remain in `electrical-windows.csv`. Android's windows at 10, 16 and
58.5 seconds fell below that cutoff and are excluded from the reported latency
and paired-skew percentiles, rather than silently discarded.

There were no detected return silences of 20 ms or longer in [3,59) seconds,
using 10 ms RMS bins below 1% of each return's median RMS, floored at −80 dBFS.
This does not rule out shorter discontinuities or establish fidelity. The
Android waveform's lower correlation remains an observation, without an assigned
cause or an audibility claim.

Public SDK getters sampled every two seconds during the recorder-launch bracket
showed zero resync-count increments on both receivers. Linux stayed at 0; Android
stayed at its pre-recording count of 1. These counters are separate from the
electrical continuity check. No phone lock, Wi-Fi interruption, long-duration or
audience-size test was performed.

The sole hardware recording began at approximately 15:04:52 UTC. Earlier setup
attempts produced no hardware recording. Android's initial certificate failure
and the erroneous hidden debug-tab attachment were corrected before this run;
the self-signed certificate was accepted through the real Chrome interstitial.

## Evidence and cleanup

Evidence is retained on the harness host at:

`/home/avoid/.t3/worktrees/couch/t3-9c313ca8/.scratch/sendspin-field/20261027-144335-default-live/`

It contains `rig.f32`, `rig.blocks`, recorder/configuration logs, public SDK
observations, `analysis.json`, every correlation window, `latency.png`, build and
process receipts, and the analysis script's surrounding scratch workflow.
Local and remote recording SHA-256 agree:

`ab99b67c20ab5d40a91b8f1ba0fac8134e5e25bc327901e8281130660f322493`

Both listeners left, the source stopped and native capture exited with
`captureError: 0`. The task-owned desktop, Core, browser, Pulse, Xvfb, recorder and
tunnel processes were stopped. Only task-created phone tabs and the ADB forward
were closed. Temporary USB ownership was restored. The UMC returned to its
pre-run 48 kHz / 512-frame device setting; physical gains stayed unchanged.
The separate browser preview on Linux port 48760 remains available.
