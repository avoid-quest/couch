# Passive Sendspin confirmation and latency options

One six-minute confirmation used the unchanged implementation
`cd0beb1db1d02655837d1f1f5f3276041a0c41a5`, native UMC404HD input and the same
360-second pink-noise stimulus as the prior recovery check. Settings remained
Automatic codec, 250 ms minimum receiver buffer, Automatic capture rate and
128 requested/reported native input frames. Both actual receivers negotiated
stereo 48 kHz Opus; Couch volume was 80%, unmuted.

The confirmation removed heap inspection, SDK polling
and observer reacquisition during recording. A fixed passive CDP observer kept
protocol notifications; the planned UI actions still used ordinary controls.
Its script contains no `Runtime` methods. No product change, rebuild, tuning,
additional measurement run or host-network disruption occurred.

## Result

**Neither prior long Android attenuation recurred.** Across the complete
analyzed interval [3,359) seconds, there were no detected uncommanded return
attenuations lasting 20 ms or more. All detected gaps overlapped the deliberate
Leave/Join or phone-only Wi-Fi actions and their recovery. The source references
stayed active throughout; the peer stayed active during each receiver's outage.

| Electrical timing | Median | p95 | Accepted correlation windows |
| --- | ---: | ---: | ---: |
| Input → Linux return | 405.0 ms | 405.7 ms | 68/71 |
| Input → Android return | 412.9 ms | 413.8 ms | 57/71 |
| Android minus Linux | 8.0 ms | 9.9 ms | 54 paired |

Timing is not perfectly constant. At about 237.8 s, Android's delay briefly
increased by approximately 17 ms, producing about 25 ms inter-receiver skew.
Shorter correlation windows confirm this step; it was not one of the earlier
110/70 ms attenuations. The retained `timing-outlier.json` contains that diagnostic.
No cause is assigned and no fix was attempted. Most accepted timing windows
remain close to the original baseline.

The 0.4 correlation cutoff, every window and all attenuation spans are retained.
Deliberate outages account for some rejected windows; lower-confidence windows
also remain. This is neither a sample-perfect nor a fidelity qualification.

Linux Leave/Join at about 60/75 s and Android Leave/Join at about 120/135 s both
recovered without restarting capture. Only Android Wi-Fi was disabled, for about
ten seconds at 180–190 s. Its electrical return recovered automatically roughly
five seconds after Wi-Fi was restored; Linux stayed active. Screen off/on was
not repeated because the existing MIUI control restriction was already known.

At the two previous event intervals, the new Android level was approximately
103% of its nearby baseline, versus approximately 1–1.6% in the earlier recording.
Together with the prior event/observer timing and V8's intrusive heap query,
this supports the [observer-interference explanation](sendspin-stability-20261027.md).
One confirmation does not prove that every future interruption is observer-induced.

The recorder captured 361.0053 seconds including its tail: 17,328,256 coherent
four-channel frames, 135,377 blocks of 128 frames, zero ring overflows and zero
sample-position discontinuities. All channels had zero nonfinite/clipped samples;
native capture stopped with `captureError: 0`. SDK resync counters were deliberately
not collected during this recording.

## Current situation and next step

The clean Sendspin integration now has reproducible approximately 0.4-second
physical latency, working independent participation/recovery and a confirmation
without the prior long uncommanded attenuations. Keep this as the default baseline.
Music/voice listening, fidelity, screen-off behavior, longer duration and larger
audiences remain unverified. The sharing UX still needs a focused product pass.

The next latency experiment should be **one fresh share at 100 ms configured
minimum buffer**, retaining everything else, compared with this saved default
recording. That is a supported SDK/application setting, not a new transport or
listener. A short real-content listening check should accompany that comparison
before selecting a lower default. No such tuning run was started here.

## Potential latency reductions on this same base

The existing public `minBufferMs` / `setMinBufferMs` setting is the first concrete
opportunity. Couch currently maps the largest receiver buffer into capture
deadlines, so reducing that buffer for the group should advance steady playback
by approximately the same amount in a **fresh capture/playback**.

| Configured minimum buffer | Nominal saving from default | First-order Linux / Android estimate |
| --- | ---: | ---: |
| 250 ms, measured default | — | 405 / 413 ms, measured |
| 150 ms | about 100 ms | about 305 / 313 ms |
| 100 ms | about 150 ms | about 255 / 263 ms |
| 50 ms | about 200 ms | about 205 / 213 ms |

**All lower-buffer rows are estimates, not measured stable operating points.**
They assume the same devices, route, format and timing behavior, with no new
underruns or added recovery delay. They are not guaranteed savings or a minimum
latency claim. The 100 ms point is a useful first comparison against the owner's
approximately 250 ms starting ambition; 50 ms is a more aggressive later option.

Important implementation details behind these estimates:

- The installed browser SDK 3.2.1 has a fixed
  `SCHEDULE_HEADROOM_SEC = 0.2` in `audio/scheduler.js`. Its target playback time
  adds that 200 ms cushion and subtracts the output-latency estimate. The cushion
  has no public setting in this version. It helps explain why a 250 ms configured
  buffer does not produce 250 ms physical latency.
- Both players declared 200 ms `static_delay_ms`. Couch adds that compensation
  to send-ahead, and the player subtracts it when scheduling. In this uniform
  group those terms largely cancel. Zeroing this value does not independently
  offer another 200 ms saving.
- Couch keeps an existing capture's lead from decreasing mid-stream
  (`next.captureLead = Math.max(previous, captureLead())`). A lower receiver
  request therefore needs a **fresh share** for a comparable lower-latency run;
  changing the running field alone can leave existing deadlines unchanged.
- Switching PCM/Opus or reducing capture/packet block size does not by itself
  advance those presentation deadlines. Native input is already 128 frames,
  about 2.7 ms at 48 kHz. Such changes may affect quality, CPU, network load or
  buffer headroom; this evidence does not justify assigning them large savings.

The SDK's internal 200 ms cushion is a concrete **longer-term upstream
opportunity** if configuration-only reductions are insufficient: investigate a
supported upstream control or appropriate published client version. How much
can safely be removed is unmeasured, and that potential must not be added to the
table as guaranteed savings. There is no basis yet to promise 30–50 ms using
only the current player settings. This is a property of the selected client
implementation, not an established Sendspin protocol limit.

## Evidence and cleanup

Evidence is at
`.scratch/sendspin-field/20261027-161137-passive-confirmation/`: the complete
`rig.f32` / `rig.blocks`, raw wire/actions/source logs, settings readback,
`analysis.json`, every correlation window, both attenuation detectors,
`confirmation-findings.json`, `timing-outlier.json`, `latency.png`, scripts and
cleanup receipts. Local and remote recording SHA-256 match:

`4019f874a4e12c3a869e77507f9e9ab846ed4ff7065e64a430765eb06283c579`

All measurement-owned app/Core/capture/recorder, Linux Chrome/Pulse/Xvfb and tunnel
processes stopped. The UMC returned to its original 48 kHz / 512 hardware frames;
phone Wi-Fi/stay-awake and temporary USB ownership were restored. Four original
native Android tabs stayed present; only the task-created tab was closed. One
pre-existing empty-URL synthetic target stopped being enumerated; the difference
is retained in the receipts. The ADB forward/daemon were removed. Installed Couch
and owner data were untouched. **pve1 networking was unchanged**, and the separate
Linux preview on port 48760 remains available.
