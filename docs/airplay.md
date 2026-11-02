# Receive AirPlay

A Couch on Linux can receive AirPlay sound (AirPlay audio and the sound of
Screen Mirroring) from an iPhone, iPad or Mac and play it like any shared
source. Not the picture, DRM video, AirPlay 2 multiroom, or a Couch on macOS or
Windows. Not yet checked with real Apple devices.

## Use it

An admin turns on **Settings → Sources → Receive AirPlay**; it runs only while
**Share on network** is on. The first time a device plays here it asks for an
AirPlay password: the **Code** below the switch, with its dashes. **New code**
restarts AirPlay and makes every device enter it again.

While a device plays, **AirPlay · {name}** leads Home's **Shared sources** and
plays automatically on the Couch computer; other devices join it with **Play on**
or **Where it plays**. Every receiver gets Couch's buffered stream, a few seconds
behind the sender. One sender plays at a time; after it
leaves, AirPlay restarts, so the Couch may briefly disappear from AirPlay lists.
A sender that has played counts as playing, so a TV's unattended update waits.

## How it works

Couch runs [UxPlay](https://github.com/FDH2/UxPlay) 1.74, pinned to commit
`d9e293da6d5276315af6820d10542a859bbc3424` with one Couch patch
(`native/airplay/uxplay-sender-address.patch`), as a separate process
(`src/server/airplay.ts`). UxPlay keeps the protocol, discovery (its own mDNS),
the password check and one sender at a time.

- **The code is UxPlay's `-pw` password, not `-pin`**: with `-pin`, UxPlay sets
  up a sender's audio even if it skipped pairing (all-zero keys play). With
  `-pw`, no stream is set up until the Digest answer matches. Digest is MD5, so
  the code is long and random (about 59 bits).
- The code lives in `<data>/airplay/uxplayrc` (mode 0600) as `pw <code>`, so it
  isn't on a command line; `HOME` is `<data>/airplay`. Code and receiver identity
  are in `couch.sqlite` (`installation_airplay`).
- `setpriv --pdeathsig KILL` ends UxPlay with Core; `stdbuf -oL` lets Core read
  its log live. A crash restarts it up to three times in five minutes.
- Sound reaches only Core, on a private pipe, as RTP L16 44.1 kHz stereo framed
  per RFC 4571 (`-artp "pt=96 ! rtpstreampay ! fdsink fd=3 sync=false"`).
  `src/server/airplay-audio.ts` paces it on Core's clock and fills loss with
  silence, then it goes through the scheduled-audio worker like other capture.
- A sender becomes a source only when its sound arrives on a connection UxPlay
  authenticated (`-d 1` log lines). One UxPlay process serves one sender: after
  it leaves, Core restarts UxPlay, because log and sound arrive on separate pipes
  in no fixed order.
- **Couch's patch**: upstream UxPlay accepted a sender's UDP audio from any
  address, and packets shorter than one AES block are never decrypted, so another
  host could inject sound. The patch accepts packets only from the sender's own
  address (and interface, for IPv6 link-local).
- UxPlay listens on every interface; it can't be limited to Couch's selected
  address. Keep AirPlay off where other networks shouldn't reach it. Anyone who
  reaches it can disturb it (hold the one connection, crash it), but can't publish
  sound without the code.

## Build and test

Linux packages ship UxPlay in `Resources/airplay` with its GPL license, source
and patch. It uses the system's GStreamer, libplist and OpenSSL (the deb
recommends the packages; the dedicated TV installs them). The build uses
`-DNO_MARCH_NATIVE=ON`, or UxPlay compiles for the build machine's CPU.

```sh
bun scripts/build-airplay.ts      # into build/airplay, for a development Core
bun test tests/airplay-audio.test.ts
```

`tests/airplay.integration.ts` runs the real Core against a script speaking
UxPlay's interface. `COUCH_TEST_UXPLAY=build/airplay/uxplay` also starts the real
UxPlay; run that in a container on an internal network
(`docker network create --internal`), with a multicast route so its mDNS starts,
so nothing is announced on your own network.
