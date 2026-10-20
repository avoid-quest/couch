# Receive AirPlay

A Couch that runs on Linux can receive AirPlay sound from an iPhone, iPad or Mac
and play it like any other shared source. It is another source, next to shared
screens and sound: nothing about [sharing a live device](live-inputs.md) changes.

What it does: sound from AirPlay audio, and the sound of Screen Mirroring, on the
computer that runs Couch. What it doesn't: the mirrored or streamed picture,
protected (DRM) video, Apple's AirPlay 2 multiroom, or a Couch on macOS or
Windows. It has been tested with UxPlay's own interface and GStreamer, not yet
with Apple devices (see [Validation](#validation)).

## Turn it on

On the hosting computer or a paired admin's device, open **Settings**, then
**Sources** under the Couch's name, and turn on **Receive AirPlay**. It starts
off, and only an admin changes it. AirPlay runs only while **Share on network**
is on; until then it says it is waiting.

The Couch appears in AirPlay under its own name. The first time a device plays
here it asks for an AirPlay password: enter the **Code** shown below the switch,
three groups of four letters and digits with the dashes. The device remembers it.
**New code**, once you confirm it, restarts AirPlay, which stops a device
playing, and makes every device enter the new code again. The
status line says whether AirPlay is ready, who is playing, or why it can't run.

## Play it

While a device plays to the Couch, **AirPlay · {its name}** leads **Discover**'s
**Shared sources** and appears in **Search**, like a shared screen or sound.
Nothing plays until someone chooses it: **Play**, **Play on**, **Play next** and
**Queue** work as for any shared source, and the sender's volume still applies.
Connecting a device never takes over what the Couch plays.

Every device that plays it gets Couch's buffered stream, a few seconds behind
the sending device. With several devices, **In sync** in **Where it plays**
plays them together, as for other live sources. When the sender stops AirPlay
or disconnects, the source ends: playback of it stops and the rest of the queue
stays. One sender plays at a time; another is refused until the first leaves.
After a sender that played leaves, AirPlay restarts, so for a second or two
the Couch may briefly disappear from devices' AirPlay lists; a device that
played here before doesn't need the code again, as long as it hasn't changed.

While a device is connected and has played sound, the Couch counts as playing,
even paused, so a TV's [unattended update](native-tv.md#tv-maintenance) waits.
A device that only connects, or hasn't entered the code, doesn't count.

## How it works

Couch runs [UxPlay](https://github.com/FDH2/UxPlay) 1.74, pinned to commit
`d9e293da6d5276315af6820d10542a859bbc3424`, as a separate process
(`src/server/airplay.ts`). UxPlay keeps the AirPlay protocol, discovery (its own
mDNS responder), the password check and its one-sender-at-a-time rule. Couch
starts it, unmodified, only while the switch and **Share on network** are on, with
`-rc <data>/airplay/uxplayrc -n <name> -nh -vs 0 -d 1 -key <data>/airplay/key.pem -m <address>`
and `-artp "pt=96 ! rtpstreampay ! fdsink fd=3 sync=false"`. The startup file
`uxplayrc` (mode 0600) holds only `pw <code>`, UxPlay's own `-pw` option, so the
code isn't on a command line other users of the computer can read. The code and
the locally administered address that keeps it the same receiver to senders are
in `couch.sqlite` (`installation_airplay`); `HOME` is `<data>/airplay`, so no
`~/.uxplayrc` or file outside Couch's data applies.

The code is UxPlay's password rather than its `-pin`, because only the password is
enforced. With `-pin`, UxPlay offers PIN pairing but sets up a sender's audio
whether or not it paired: a sender that skips pairing and sends all-zero keys
gets a zero AES key (`fairplay_decrypt` fails and UxPlay carries on) and plays.
With `-pw`, UxPlay answers the first SETUP, which carries a sender's keys, with
an RFC 2617 Digest challenge, and sets up no audio or mirroring stream until that
sender's answer matches the password (`lib/raop_handlers.h`). The Digest scheme is
MD5, so the code is long and random: three groups of four from 31 letters and
digits (no i, l, o, 0 or 1), about 59 bits: far too many to try over the network,
and slow to recover offline from a captured exchange. A device stores the
password it entered. `setpriv --pdeathsig KILL`
ends UxPlay with Core however Core ends, and `stdbuf -oL` lets Couch read its
log as it happens. A crash restarts it up to three times in five minutes;
missing libraries or GStreamer plugins, and a network where its mDNS responder
can't start, stop it with a message instead. Turning AirPlay off and on retries.

UxPlay sends the decoded sound only to Core, on that private pipe, as RTP with
16-bit 44.1 kHz stereo samples (`rtpL16pay`), each packet after a 16-bit length
(`rtpstreampay`, RFC 4571). Nothing listens for it on the network. Core reads
it with `src/server/airplay-audio.ts`: it checks every packet, places each
sample by its RTP timestamp a quarter second behind the first one, fills loss
and pauses with silence, and emits exactly the elapsed samples on Core's own
clock. It holds at most two seconds ahead; a sender whose clock jumps (pause,
seek) or falls behind starts again from where it is. FFmpeg reads that PCM from
its standard input, as it reads a browser's upload, into the same rolling HLS
the buffered and In sync paths of live inputs use (`src/server/live-stream.ts`).
If FFmpeg falls behind by more than 4 MB, the stream ends with an error rather
than buffering.

A sender becomes a source only when its decoded sound arrives, which UxPlay
produces only after the sender answered its password challenge, never from a TCP
connection or a device announcing its name. Core publishes it as a live source it owns
(`publisher` `airplay`, never a Device), so no device can end it, send it media
or play it as its publisher; a device that stops sharing its speakers leaves it
waiting in **Where it plays**, as for any shared source. A sender is UxPlay's one
RTSP (RAOP) connection, which it refuses to anyone else while it is open. Couch
runs UxPlay with `-d 1` (its debug log, without packet data), whose lines name
when that connection is identified, when UxPlay authenticates it (`Client
authentication success`) and when it is removed. Sound counts only on a
connection UxPlay authenticated. The source ends
as soon as that connection is removed, or after 30 minutes without sound; other
connections, such as one UxPlay refused or one that only asked for its `/info`,
neither keep it nor end it.

The log and the sound come on separate pipes, which Core reads in no particular
order, and UxPlay logs a removal before it stops that sender's decoding, so its
last sound can arrive after the next connection's log lines. So one UxPlay process
serves one sender's sound: once an authenticated connection is removed, Core
ignores everything that process still sends, stops it and starts another
(`airplay receiver restarting for the next sender`, not counted as a crash). A
sender that connects next always gets a new source, which nothing plays until
someone chooses it. A device connecting during the restart reaches no receiver and
tries again; the receiver's identity is kept in `<data>/airplay`. Core reads the
sound pipe's framing from its first byte, whoever the sound turns out to belong
to, and drops only whole packets that belong to nobody. The
sender's name comes from UxPlay's log, stripped of control characters and cut
to 60 characters.

UxPlay listens on every network interface, with ports it picks, plus mDNS on
UDP 5353; it can't be limited to the network address Couch selected. Keep
AirPlay off where the Couch's other networks shouldn't reach it. Its code is
its only admission control; Couch pairing doesn't apply to AirPlay senders.

Anyone who can reach UxPlay can still disturb it without the code. It serves
one sender connection at a time, so a connection that holds it keeps others
out. With `-d 1`, UxPlay also logs the contents of that connection's requests,
so their text can imitate the log lines Couch reads. At most that ends a source
or restarts the receiver; it can't publish a source, because sound needs a
stream that only the password check sets up. A malformed `Authorization` header
can make UxPlay crash, which counts towards the three restarts in five minutes,
after which AirPlay waits for an admin to turn it off and on.

Core's log (`couch.log`) records `airplay sender connected` and `airplay sender
disconnected` for each sender connection, `airplay <id> receiving` and
`airplay <id> ended` for each source, and `airplay receiver stopped` with the
reason. UxPlay's own log stays in Core's memory.

## Requirements

Linux packages include UxPlay in `Resources/airplay`, with its license
(GPL-3.0 or later), `NOTICE.txt` and the exact source it was built from. It
uses the computer's GStreamer, libplist and OpenSSL: the deb recommends
`libplist-2.0-4`, `gstreamer1.0-plugins-base`, `gstreamer1.0-plugins-good`,
`gstreamer1.0-plugins-bad` and `gstreamer1.0-libav`, and the dedicated TV
installs them. With an AppImage, or a deb installed without recommended
packages, install them yourself; the status line names what is missing. It also
needs `setpriv` and `stdbuf` (util-linux and coreutils), which Debian always has.

## Develop and test

Packaging builds UxPlay with CMake in the electron-builder `afterPack` hook
(`scripts/build-airplay.ts`), on Linux only, for the machine's own architecture.
It fetches the pinned commit with git and checks it. Package installs
`cmake pkg-config libssl-dev libplist-dev libgstreamer1.0-dev
libgstreamer-plugins-base1.0-dev` on its Linux runner. To build it for a
development Core, which looks in `build/airplay`:

```sh
bun scripts/build-airplay.ts
```

The pacing and framing tests need nothing else:

```sh
bun test tests/airplay-audio.test.ts
bun build tests/airplay.integration.ts --target=node --outfile=build/airplay.integration.mjs
node --test build/airplay.integration.mjs
```

The integration runs the real Core, `setpriv`, `stdbuf` and FFmpeg
(`COUCH_TEST_FFMPEG`, or `ffmpeg` on `PATH`) against a script that speaks
UxPlay's interface. Two more cases run where their tools are:
`COUCH_TEST_GST_LAUNCH=/usr/bin/gst-launch-1.0` sends a tone through GStreamer's
own `rtpL16pay ! rtpstreampay ! fdsink`, and `COUCH_TEST_UXPLAY=build/airplay/uxplay`
starts the real UxPlay with Couch's arguments and speaks to it as a sender that
never pairs. Run those in a container on an internal network, so nothing is
announced on your own network:

```sh
docker network create --internal couch-airplay-test
docker run --rm --network couch-airplay-test --cap-add NET_ADMIN --init \
  -v "$PWD:/work" -v "$(command -v node):/usr/local/bin/node:ro" -w /work \
  -e TMPDIR=/work/.artifacts/tmp -e COUCH_TEST_FFMPEG=/work/<ffmpeg> \
  -e COUCH_TEST_GST_LAUNCH=/usr/bin/gst-launch-1.0 -e COUCH_TEST_UXPLAY=/work/build/airplay/uxplay \
  <debian:trixie with the packages above, gstreamer1.0-tools and iproute2> \
  sh -c 'ip route add 224.0.0.0/4 dev eth0 && setpriv --reuid "$(stat -c %u .)" --regid "$(stat -c %g .)" --clear-groups -- node --test build/airplay.integration.mjs'
```

The multicast route lets UxPlay's mDNS responder start; without it UxPlay
exits, as it would on such a network.

## Validation

Checked: the pinned UxPlay built on Ubuntu 24.04 (Package's runner) starts on
Debian 13 with Couch's arguments, answers an unpaired sender's request without
Couch publishing anything, challenges a sender's key SETUP without the code or
with a wrong one and gives it no stream (the all-zero-key attack that plays
under `-pin` publishes nothing), and for a sender that answers with the code sets
up the same stream, whose ALAC sound becomes a source (the test client uses a zero
key, not FairPlay), refuses a second connection's request while that one
is open, logs each sender connection as Couch reads it, and stops on Couch's signal; GStreamer's own framing
arrives as a continuous tone at the right pitch through Couch's HLS; admission,
ending, one source per sender (also with an unpaired connection open, a next
sender straight after, a last packet read after the next connection's log, and a
frame split across the moment UxPlay authenticates the sender), Where it plays when a device stops sharing its speakers,
restarts and update busy-ness against UxPlay's interface.

Not yet checked with real devices: an iPhone, iPad or Mac asking for the code as
an AirPlay password, accepting the dashes, and remembering it,
AirPlay audio and Screen Mirroring sound from iOS and macOS, a second sender's
refusal, the sender's volume, reconnecting, including how quickly a device finds
the Couch again after AirPlay restarts between senders, long sessions (a sender clock that
drifts from Core's is corrected by starting again, an audible skip),
end-to-end delay, and In sync between devices. Test those on a scratch Couch
with its own `COUCH_DATA_DIR` and `COUCH_PORT` before relying on them.
