# Local workflow qualification — 2026-09-27

Software scope is implemented: optional administrator-configured Core hosting,
optional clients joining another LAN server, and bounded denied-admission retries.
Physical speaker, TV and systemd-boot checks remain unqualified. Third-party PIN
onboarding is explicitly deferred and outside scope, not a completion blocker.
Local-only deployment, client media fetching/decoding, existing presentation and
the exclusions in [map.md](map.md) remain unchanged.

## Implementation and regressions

Hosting settings are in PR #635; the reconnect fix belongs to #632. PR #631 also
corrects a PCM test to observe the existing disconnect/drain boundary before
asserting stopped production. Dependents were rebased with gh-stack. PR #634 owns
the revised PIN scope. This qualification layer records the integrated result.

- Settings → Remotes reuses administrator permissions, SQLite persistence and flat
  shared settings components. Enable saves the choice and requires Core restart;
  disable closes sockets, cancels/drains PCM and marks the group unavailable.
  Existing COUCH_SENDSPIN_CONFIG is inherited until the saved choice overrides it.
  Config/bind errors leave Core usable and appear in settings. Revocation remains
  effective while hosting is disabled and after restart/re-enable.
- Maintained SDK 5.0.0 still resets its attempt count when the WebSocket opens,
  before encrypted admission. Reproduced with the retained revoke fixture. Couch
  now counts seven automatic reconnects per explicit Join using public lifecycle
  hooks; successful transient reconnects also consume this budget. The next hook
  cancels the newly opening socket in a microtask because the SDK opens it after
  calling the hook. The terminal state has no transport commands, a clear error,
  and Leave/new Join recovery. Protocol and cryptography remain in dependencies.
- Focused reconnect/UI checks: 57 passes across three repetitions, including actual
  SDK encrypted denial, revocation, transient reconnect and Leave cancellation.
  Hosting checks cover permissions, persistence, config errors, occupied ports,
  revocation races and stop. The corrected PCM fixture passes 12 checks across
  three repetitions. Earlier red/failing receipts are retained, not counted green.

Official API references: [Sendspin JS](https://github.com/Sendspin/sendspin-js),
[maintained host](https://github.com/sonn-audio/node-sendspin), and
[shadcn Switch](https://ui.shadcn.com/docs/components/switch).

## Actual compiled application

Clean source `97e1770130339e9194063b27f6eb3da8c89480cf`, Bun 1.4.2, arm64 macOS:
typecheck, 1,805 core tests and three isolated real-clock tests pass; ten platform/
opt-in core tests skip. Production build passes. The retained compiled binary's
version identifies that exact clean revision.

The real shared application paired a second Couch browser context, saved hosting,
restarted Core without a config file, retained pairings and enablement, joined
This Couch, selected its group and played a generated 120-second WAV. Both browser
contexts used the same compiled Core on loopback; this is not a second physical
computer or LAN device qualification. UI pause/resume and disable were exercised.
Web Audio analyser RMS was about 0.0624 while playing, zero 1.5 seconds after pause,
0.0624 after resume, and zero 1.8 seconds after disable. Those are observation
samples, not measured latency bounds or physical speaker silence. Disable showed
Hosting is off and Player unavailable; the client exhausted retries with the
recoverable error, and Leave restored the normal output choices.

The retained independent TypeScript PSK fixture recovered from an actual socket
drop, then rejected revoked credentials until Couch stopped retries. Its final
event list remained at 15 entries with one error several minutes later. Leave was
then exercised. This qualifies software interoperability and denied admission;
there is no user-provided external Sendspin server.

Core process samples on the accessible Mac were 2.8–3.3% CPU and 109,472–124,656 KiB
RSS during group playback. These two `ps` observations are not sustained whole-device
costs and exclude browser cost; prior full decoder/browser workload observations
remain in [boundary qualification](boundaries-2026-09-27.md). No new acoustic drift,
speaker latency or physical silence measurement was possible.

Receipts, logs, binary and UI snapshots are retained under
`.artifacts/sendspin-settings-20260927` (notably `compiled/workflow.json`,
`integrated-check.log`, `mac-build.log`, and `pcm-drain-regression.log`). Revoke
before/after evidence and focused logs are under `.artifacts/sendspin-reconnect-20260927`.

## Exact final Linux gate

The final clean qualification commit is bundled into an immutable Linux checkout.
`.artifacts/local-workflow-20260927/verification.json` owns the exact revision,
clean-tree eligibility and exits for `bun run verify --remote`; `verify.log` and
`built-remote/` retain the full output, checks, asset hashes and screenshot. Read
that receipt before treating the gate as passed. The same retained Ubuntu 24.04
image supplies WebKit/Xvfb and a null PulseAudio sink. This gate qualifies the
compiled browser application, not native pixels, physical sound or systemd boot.
No workflow, package, release or hosted dispatch is changed by this continuation.

## Unavailable hardware: exact next actions

1. Speakers: on two intended physical receivers, pair and join the local host,
   select its group and capture both outputs against the same clock through play,
   pause, seek, socket loss, Leave and transfer. Record drift, audible latency,
   silence and per-device CPU/RSS/network cost. Grant output qualification only
   after these measured results meet the transfer policy.
2. Desktop/TV: install the same qualified revision on the target device; run the
   retained native desktop journey from `docs/ci.md`, then repeat group join,
   playback, pause/resume, disable and direct playback in desktop and TV modes.
   Record physical pixels/audio, Close/reopen/Quit and output recovery.
3. Linux/systemd: when a Linux device is available, install the exact qualified
   binary and unit using `docs/core-service.md` with a disposable data directory.
   Pair an administrator, enable hosting, restart the service, join from another
   Couch, disable hosting, and verify silence. Re-enable/restart, reboot the host,
   verify health and saved settings, then stop the service and verify child/output
   cleanup. Retain `systemctl status`, journal and revision receipts. The earlier
   isolated PID1 probe exited 255 before launch; a container browser pass does not
   replace this boot check.

All archives, the Jellyfin stash and historical receipts remain preserved. Nothing
is merged or released.
