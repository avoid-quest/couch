# Share a live device

## Use it

- **Receivers**: to let other devices use this device's speakers or screen, turn
  them on in **Settings → This device → Let other devices use**. Only that device
  can change them. The hosting app shares its own while **Share on network** is
  on.
- **Publishing**: press **Share** in the header and choose **Screen**,
  **Window**, **System audio** or **Audio input**, optionally devices under
  **Play on**, then **Start sharing**. On the Couch computer an **Audio input**
  is always [Live audio](live-audio.md), and **System audio** is Live when
  **Playback** is **Live**. Without a destination the source waits in
  Home's **Shared sources**. A browser without screen capture offers audio inputs
  only.
- **Picture**: 1080p and 60 FPS by default, with 720p or original resolution and
  30/60/120 FPS targets, changeable while sharing. Targets are ceilings, not
  guarantees. Captured audio turns off echo cancellation, noise suppression and
  gain control so music isn't altered.
- **The publisher never plays its own capture**, except a Live audio input,
  which the Couch computer's own outputs can play like any other device's.
  Otherwise it stays a controller, listed as **Sharing this source** in **Where it plays**.
- **Stop sharing** ends the source on every receiver. Closing the publishing
  window, disconnecting it or stopping capture through the OS does too.
- macOS system audio needs 14.2+. Including system audio sends the whole mix,
  even when the picture is one window.

## Delivery

Screens and audio without timestamped capture go **directly over WebRTC** to
each receiver ([ADR 0001](adr/0001-live-inputs-play-over-webrtc-unless-in-sync.md)),
so each device plays as soon as it receives and two rooms can be slightly apart.
The publisher encodes once, in H.264, and sends that one stream to the Couch
computer, whose relay helper forwards it to every receiver. A browser that can't
send H.264, or can't reach the Couch computer, encodes once per receiver instead.

- **In sync** (in **Where it plays**, with more than one receiver) buffers the
  capture through FFmpeg and HLS so devices play together, a few seconds behind.
- **Through Couch**: a receiver that can't connect directly within 10 seconds
  plays the buffered stream alone; `couch.log` lists it as `(buffered)` with the
  reason. It stays buffered for that source until sharing ends.
- A timestamped **Audio input** or **System audio** shared Relaxed plays on one
  speaker through the forwarding relay, as a screen's sound does. With a second
  speaker Core moves it to Sendspin's scheduler, so every speaker plays in step
  after a short break, and back when one is left. Without the relay helper, or
  once the share or a speaker couldn't connect through it, it stays on Sendspin.
  AirPlay always uses Sendspin. **Live audio** on the hosting desktop is
  described in [Live audio](live-audio.md).
- Receivers can only delay sound, never play it early, so none can line up with
  the original sound on the sharing Mac.

## Relay

Direct playback uses LAN STUN on Couch's port over UDP, and optionally TURN when
the network blocks direct connections. In **Settings → Devices & network → Live
playback relay**, **Run relay on {name}** starts the bundled relay
(`native/live-relay`) on the hosting computer once **Share on network** has a LAN
address. It relays only within the selected
private IPv4 subnet, gets fresh credentials each run (only paired devices receive
them), and restarts with new credentials when a device is unpaired. **Check
relay** tests reachability from the device you hold only. An external TURN
service can be saved instead; Couch can't revoke its credentials. Deployment
defaults: `COUCH_LIVE_TURN_URL`, `COUCH_LIVE_TURN_USERNAME`,
`COUCH_LIVE_TURN_CREDENTIAL`.

## Test on a Mac

Use the signed **Couch Dev** build from
[macOS development](macos-development.md): ad-hoc builds can lose their
permission identity on every rebuild. Check system audio, screen with sound and
an audio input; add a second receiver and check both stay direct (`Direct on …`
in `couch.log`), then **In sync**. A shared software clock doesn't prove physical
speaker timing: listen.

## Scratch Core with a relay

[scripts/live-dev.sh](../scripts/live-dev.sh) runs a built Core on a Linux machine
with a temporary coturn relay, for testing a Mac and phones on the LAN. It needs
Docker, `curl`, `setsid`, `openssl`, `ss` and `ip`.

```sh
docker pull coturn/coturn:4.18.0-alpine
bun run build
couch_live_data=$(mktemp -d /tmp/couch-live.XXXXXX)
COUCH_DATA_DIR=$couch_live_data COUCH_PORT=4610 scripts/live-dev.sh 192.168.1.20   # this machine's LAN address
```

On the Mac, choose **Another Couch**, connect to `https://<ip>:4610` and pair;
phones open the same address. A standalone Core accepts only its own addresses
as the host. The relay listens on `COUCH_PORT + 1` over TCP and
relays only to private addresses. Stop it with Ctrl-C, or `kill` the PID in
`$couch_live_data/live-dev.pid` after checking it with `ps`.
