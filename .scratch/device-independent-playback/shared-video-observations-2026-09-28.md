# Shared playback: 2026-09-28

Scope: every participant controls one Playback; one selected screen shows video
while all selected devices share its soundtrack. Multiple picture screens are
deferred by the user's choice. The [contract](../../docs/playback-product.md)
remains authoritative; this is an observation record, not full acceptance.

## Built application and physical observation

Standalone **Couch Mixer** hosts its normal library at `http://10.10.2.96:4100`.
It uses `quest.avoid.couch.mixer` data, preserving earlier Couch Playback data and
historical receipts. The separate `:4416` test Core was stopped; its files remain.
The browser paired through the application and automatically became Mac · Chrome.
The user's phone retains its existing pairing and name.

On build `a2e53fbc52fa3e694d23c73a67962c846eb718cb`:

- Paused Mux HLS moved from the browser to the Mac at 3:32. Adding the browser in
  Output retained that item, position and paused intent. Output named the Mac
  **Picture and sound** and the browser **Sound**.
- Play from the browser resumed the shared Playback. Native captures showed
  changing scenes, rather than only an advancing control timeline. No native
  Enable audio step was used.
- The user added their phone. They confirmed its soundtrack was **audible and
  appeared aligned** with the Mac's moving picture. This is a subjective physical
  observation, not measured acoustic synchronization or quantified A/V offset.
- Browser Pause stopped at 369.4821 s. Browser Forward 10 seconds changed the Mac's
  displayed frame and paused position to 379.4821 s. All three outputs stayed
  selected. These were ordinary controls in the built app.

Earlier in this iteration, the browser was also the picture device with the Mac
sharing sound: browser video was muted, readyState 4, 1920 pixels wide, and advanced
to 183.38 s / 1060 decoded frames while the SDK audio stream ran. Removing the Mac
had preserved the paused item at 167.6 s before adding it again. This is decoder and
software-output evidence; physical audio was confirmed separately above.

Build `da15c350e13a39fb83fc60ee65553daa54a59676` reopened after normal Quit:
the item, 379.4821 s position and all three assigned devices remained; no media
autoplayed. Browser pairing survived. The disconnected phone remained selected
and was reported disconnected instead of silently disappearing.

## Failures found through the app

- First Play could succeed but report “Playback selection changed.” Automatic
  participant following now preserves an already selected canonical Playback.
- Shared browser video emitted enough rate-change observations to trip the
  connection limit. Routine telemetry now coalesces; new occurrences and errors
  remain immediate.
- Native shared video originally showed a frozen frame. The built app lacked
  permissions for follower commands, and frequent polling starved fresh native
  observations. Both were corrected before the physical result above.
- Output assignment could race browser audio activation. It now starts activation
  in the click and awaits readiness before assignment.
- Quit previously erased desired output membership through backend observation
  callbacks. Explicit assignment actions now exclusively own the durable selection.
- Restart revealed that an offline output could not be switched off. That UI
  restriction was removed and recovery copy now names Output.
- The user confirmed phone Join, but reported that moving video to another device
  still did not work and rejected the explicit Control action. Transfer and the
  overall interaction model remain open; shared audio/video success does not close them.

## Limits and verification

This covers Mux HLS and the earlier Sygma radio path, not every source. Shared video
currently rejects unsupported local-library/recording delivery, segment/replaygain/
audio-delay combinations, and browser picture sources requiring external subtitles
or a separate audio source. Shared producer audio-track selection remains limited;
provider tracks, quality and live/DVR still need complete acceptance. Independent
background Core installation through desktop settings remains unimplemented.

The Mac build and TypeScript check passed. Build logs are retained under
`/tmp/couch-mixer-build-shared-video-{1,2,3,4,5}.log`. Existing verification on
`da15c350` failed: eager import of the DOM-dependent media synchronizer broke
non-browser test imports, older renderer tests assumed immediate telemetry, and
the previously observed real-PCM resume check failed again. Linux stopped in the
same core checks before native smoke. Logs: `/tmp/couch-mixer-verify-da15c350.log`
and `/tmp/couch-mixer-linux-da15c350.log`. These are failed gates, not acceptance.
Earlier successful Linux desktop and physical radio observations remain scoped to
their recorded builds in the [prior receipt](model-software-observations-2026-09-27.md).
