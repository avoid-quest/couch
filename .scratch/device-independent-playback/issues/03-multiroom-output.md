# Sendspin synchronized audio

Type: task
Status: both roles implemented; actual software boundaries qualified
Remaining qualification: physical outputs and third-party receiver interoperability

## Scope

The user selected Sendspin only on 2026-09-27. Core optionally hosts a group using
`@sonn-audio/node-sendspin`; clients optionally join this Core or another LAN server
using official `@sendspin/sendspin-js`. Keep protocol, crypto and synchronization
in those dependencies. Ordinary browser/native playback remains independent.

The completed replacement permits removal of Snapcast, its daemon configuration,
control connection, idle stream and TCP PCM producer. The shared FFmpeg decoder
remains for Sendspin's one group timeline. Existing group/session ownership,
revocation, reconnect and output-silence safeguards remain.

## Implemented and verified

- Authenticated Couch pairing provisions durable owner-bound PSKs. This Couch needs
  no separate Sendspin PIN. Revocation ends current and future encrypted admission.
- Actual Couch browser → two SDK Web Audio outputs → browser works with session
  continuity and 1.25× speed. Paused preparation, seek, Stop and membership work.
- Independent maintained TypeScript PSK peers, reconnect, revocation and actual
  decoded PCM pass in the recorded fixtures.
- The client retains waiting/reconnect status and Leave when Core is unavailable.

See [configuration](../../../docs/sendspin.md) and the exact observations in
[boundary qualification](../boundaries-2026-09-27.md). Software graph silence is not
physical speaker qualification; transfers remain gated by the output's qualification.

## Remaining limits and next actions

Host 0.6.2 requires AES-GCM and explicit PSK provisioning. Its maintained library
has no server PIN onboarding; the Rust alternative has no replacement host pairing
API. Use Couch pairing for Couch clients and the documented PSK path for compatible
third-party receivers. Add PIN-only receiver support only when a maintained host
API and an actual target receiver are available; do not implement custom crypto.
The official client still supports pairing with another server that provides it.

No external server, Linux device or physical speaker setup is available. On the
intended hardware, measure synchronized speaker capture across pause, seek, loss
and transfer before granting qualification. No acoustic superiority over Snapcast
has been measured; Sendspin was selected to remove duplicate integration machinery.

Historical Snapcast receipts and Python experiments remain in
[validation](../validation.md). Pre-retirement source is preserved at
`archive/playback-before-local-sendspin-20260927` (`6356e76d`); the Python archive and
closed PR #628 remain unchanged.
