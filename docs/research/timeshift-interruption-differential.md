# Ant interruption differential, 8 September 2026

This report preserves the earlier comparisons. The later [controlled EVENT replay](timeshift-event-reload.md) reproduced the failure and isolated `max_reload`; it supersedes the unresolved diagnosis below.

[Stable live/growing timeshift](https://github.com/avoid-quest/couch/issues/67) remains incomplete. Two bounded follow-ups narrowed the retained premature-EOF failure without establishing a production fix. Neither run passed overall, and neither qualifies packaged playback or physical audio.

The tests reused the same dirty native/sidecar pair as the prior passing baseline: source d77af244cf6d1f6aab872e2fee0a11897284815f, staged tree 36657fd28d59bf6efd034ea90e4b4e8e3d5d661f, native SHA256 10ef0d0d85746c66f2ddc9b829f33cb06ad88d9acccba04d42a5428cc4386de0, sidecar SHA256 d3e0891d11350e1111ad8385ac52913b9aef50bad8d1fc07e09ad0d4a5ea3a50. No application source, libmpv option, image, package or installed device changed.

## Results

| Run | Observation | Limit |
| --- | --- | --- |
| Original `lifecycle-sxcZWj` | Couch froze at the 24-second EVENT edge, received resumed segment 13 without ENDLIST, then reported ended at 24.0084 seconds. | The retained failure remains unexplained. All 53 original manifest members still match. |
| `duplex-yY0yf3` | Couch and an independent direct libmpv owner froze, then resumed on their existing loads. Over 24 comparison samples, Couch advanced 26.54 to 32.42 seconds; direct libmpv advanced 26.50 to 32.26. Native pixels later showed 33.20 seconds and an appended seek to 26.00. | The interruption failure did not reproduce. The full run failed later because the fixture sought beyond the player's still-stale published duration. |
| `duplex-DMVbwz` | An additional 3.2 seconds of publisher suspension crossed Ant's 20-second RTMP inactivity limit. Ant closed the publisher and emitted ENDLIST before resume; FFmpeg then reported broken pipe and exited 224. | Couch ending after that actual ENDLIST is a different outcome from the original premature EOF. This does not reproduce the original bug. |

The recovered run retained all served segment bytes and Range/Content-Range headers. Native responses for segments 1 through 13 have identical SHA256, byte length and Range to the original failing run. Segment 13 is 46,436 bytes with SHA256 5fee96877273ac89aa90deb946ca2bd2d9a841da67b3cca6e20630338adb4879. Both new consumers received `bytes 0-46435/46436`. The evidence therefore rules out changed segment payloads as the difference between those two runs. TS packet alignment was checked, but no full packet/decode analysis ran on the host.

Timing differs. The relay recorded the original native client's segment 13 request 21.636 seconds after its first native manifest request; the recovered run's interval was 18.412 seconds. This supports a timing comparison, but does not identify an exhausted libmpv option or justify increasing `max_reload`. The earlier generated-HLS default recovery still falsifies the proposed simple option explanation.

## Fixture and backend findings

The recovered run's final seek used the backend's final 38.000011-second manifest while Couch still published a 36.009-second duration. The requested 37.000011-second seek was therefore clamped by the existing session contract. The observer recorded exactly 36.009, then native duration 38.036 arrived 757 milliseconds later, with position 36.02. The follow-up fixture waits until published duration covers the target before seeking. It did not reach that corrected check because the backend timed out earlier. This is not evidence for changing production seek bounds.

In the extended run, Ant's retained log states that it closed RTMP after 20,000 milliseconds without an update at 08:47:57.952 UTC. The fixture resumed at 08:47:58.547. Both consumers then fetched an ENDLIST manifest and a shorter final segment 13. This run identifies the backend timeout as a confound in longer publisher-suspension tests. It does not establish restart identity or recovery after a publisher reconnects.

The next useful isolation is to delay client-visible media while keeping the publisher alive, or replay the retained byte-identical media. Either avoids Ant's publisher timeout. It must retain direct snapshots while awaiting backend growth too: the extended run aborted before the post-growth comparison loop, so it has no direct-player end-state snapshot. Production changes require a reproduced cause at the actual application path.

## Evidence and cleanup

The private fixtures are under `/tmp/couch-timeshift-diagnosis-fresh-20260908/.artifacts/`. They are deliberately outside shipped application code. The original worktree and every earlier receipt are unchanged.

| Directory beneath `.artifacts/` | Manifest SHA256 | Members / bytes | Elapsed |
| --- | --- | --- | --- |
| `duplex/duplex-yY0yf3` | 615e4e9b43d18f530bde503b965dfd1771eaf04893c0ad83bc9a8494e3deb282 | 88 / 2,192,677 | 77.249 seconds |
| `duplex-late/duplex-DMVbwz` | 02dbc2325c4ff951f2cd7ca58e4deee19b1e0cd29e7e68ce47317dbfd018dd30 | 70 / 1,669,932 | 73.146 seconds |

Each run used the pinned Ant image df8d825bbf2293048958904163c84d3160c154dc5611595151a9f4daf6366d59 and native image d6ee346fcadb8a466236d0e3dd174895c6be3e2d10387a3fbfb99fb2aecde798. Ant received 2 GiB and 2 CPUs; the native container, including the additional direct client, received 4 GiB and 2 CPUs. There were no pulls, builds or published host ports. Both runs stayed inside their 300-second allocations. All fixture cleanup checks passed; exact-ID listings confirmed both owned containers absent after each run. The preserved preview containers were not changed. Ant's expected host-initiated SIGTERM remains recorded in its server result, separate from the earlier producer failure.

The direct client used null audio/video output. Actual Couch used software-rendered X11 video and a PulseAudio null sink. Neither run proves audible continuity, packaged acceptance, durable growing-recording identity/completion, private media authentication, retention policy or target/controller qualification.
