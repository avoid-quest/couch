# Share a live device

Pair each receiving device with the same Couch. A device can always play a source on itself with **Play on → This device**. To let *other* devices choose it as an output, enable **Settings → General → Let other devices use speakers** and, for a screen, **Let other devices use screen**. These permissions are separate from what the device currently plays and from capture, which starts only on the sharing device.

On the publishing device, open **Find → Add source → This device**, or **Settings → Sources → This device**. Choose **System audio**, **Screen**, or **Microphone or audio input**, then choose the screen/window or audio input and **Add source**. Allow the macOS permission prompts. When the window shows another Couch (Client mode), this computer also asks each time before that Couch's page may use its microphone, a screen or window, or its audio, naming that Couch's address. A microphone is asked about for **Choose audio input** and again for **Add source**. A screen or window is asked about for **Add source**, naming it from this computer's own list and saying whether this computer's audio is included; for **System audio** the prompt also says that page gets the screen's picture. Allow only what you just chose there. After you allow it, the page itself stops the capture when sharing ends: a page that ignores Close keeps what it was given until sharing is stopped through the OS or Couch quits. The names of screens and windows are listed to the page without asking. Audio defaults to the system input; **Choose audio input** requests microphone access, lists connected microphones and audio interfaces, then immediately releases that temporary capture.

Screen capture defaults to at most 1920×1080 at 30 fps, preserving its aspect ratio. Choose **720p** to reduce bandwidth and processing, or **Original resolution** for more detail. Turn off **Include system audio** for picture only. System-audio capture retains a small video track at at most 320×180 and 1 fps because the display-capture API requires it; Couch's page never sends that video. Captured audio requests echo cancellation, noise suppression and automatic gain control off so they do not alter music or input signals.

Active inputs appear directly alongside other sources in **Find** and its search results. The **Shared sources** source filter and **Live** kind filter include them. Their ordinary media rows offer **Play**, **Play on**, **Play next** and **Queue**. Playing one opens the same **Now Playing** experience as a TV channel or radio station, with the normal player, mini player, **Playback** settings and **Up next**.

The publishing device never plays its own capture: neither its picture nor its sound, microphone monitoring included. It stays a controller, listed in **Where it plays** as **Sharing this source**, and is not counted as a receiver. This applies to Play, Play on, Where it plays, **Only here**, a mix the source inherits, a queued source reached with Next, and reconnection; the publisher's other playback and its capture are unaffected. While its source plays in a playback the publisher was part of, or asked to choose receivers for, the publisher keeps viewing and controlling that playback, even after a device that keeps its outputs private joins it or stops sharing: Play, Play on another device, Queue and Where it plays all act on it. Capturing a source gives no control of anybody else's playback of it. When the queue moves on to an ordinary item or another device's source, or the publisher plays something, including another device's source, with Play, its output returns to that playback, unless it moved to another playback, was unpaired, or **Only here** moved the playback meanwhile; a speaker or screen it stopped sharing meanwhile does not return. Playing a source on its publisher, from **Play on** or with Play while controlling it, opens **Where it plays** to choose receivers, again on each repeat; once closed, it stays closed when you open the player, until the next request. When the source already plays somewhere you can view, including the playback the publisher keeps controlling, it shows that playback and opens its **Where it plays** in that window only, again on each repeat, while the receivers keep playing.

**Play** and **Play on** join the playback already playing that source, with its queue and clock, so two devices that choose the same source share one session from Find or from **Where it plays** in Now Playing; a device busy with something else leaves it, and that item keeps its queue. Joining brings that playback's transport and queue controls, so it works only where you could already control it: when the source plays only on devices that keep their outputs private, Couch refuses and changes nothing. Couch also refuses rather than guesses when the source plays in several independent playbacks; open one in Now Playing to add the device there. A playback still waiting for its first receiver counts as neither. **Queue** and **Play next** add the source to Up next without joining or interrupting anything. **Only here** moves a playback to one device exclusively, including after the queue moves on; while another device's private output plays in it, or a publisher's private output waits to return after its source, Only here is unavailable, since nobody may take over that output. Couch checks this again when the move lands, so an output that turned private while the item loaded for its new device leaves the playback as it was. Pressing Only here on a device that is already the only output still makes it exclusive: a publisher left out for its own source then stays out.

Open **Where it plays** in the player or mini player, raise another device's level to add sound, and enable its **Picture** to add video. A browser may ask for **Tap to hear** on its own screen. A receiver plays only the channels Couch routed to it, whatever the sharing device sends. When a device stops sharing the screen or speakers a source uses, and no other output in the playback uses that source, the devices it cannot use leave the playback, which pauses and opens **Where it plays** to choose another; a device playing it privately on itself stays, and the playback keeps waiting through that device reconnecting until an output that uses the source is chosen.

Use the same volume, mute and supported playback preferences as for other media. While several devices play in sync, each row offers **Sync … ms earlier**, the per-device output alignment. A live input plays in sync only when **In sync** is on (below); otherwise, and with one receiver, the row shows the saved value and when it applies. The value is the one the speaker last reported; Core keeps it across restarts, and the speaker's own player keeps the value it applies. **Audio delay** in Playback is different: it shifts sound against picture where the player supports it. Queue an input alongside other items, then use **Next** or play it from **Up next**; there is no need to stop first. Captured inputs exist only while sharing is active, so they cannot be saved for later or restored after restarting Couch. Ending capture removes its entries while retaining other queued media. **Save as list** can save ordinary items in Up next.

**Stop** stops the selected playback; **Stop sharing** ends capture and removes the source from every receiver. Sharing remains active while you browse, with a Stop sharing action in the header. Closing or reloading the publishing window, disconnecting it from Couch, or stopping capture through the OS also ends sharing. Another controller can play or stop reception but cannot request capture or end somebody else's source.

System audio on macOS requires **14.2 or later**. Screen capture on older supported macOS versions can provide picture without audio; Couch displays the actual captured capability. Including system audio sends the computer's audio mix, including when the picture is one window. It does not isolate that window's application audio. If permission was just changed in **System Settings → Privacy & Security → Screen & System Audio Recording** or **Microphone**, reopen the test app when macOS asks.

Every receiving device gets the capture directly over WebRTC in the ordinary player, its picture and sound together, however many devices receive it ([ADR 0001](adr/0001-live-inputs-play-over-webrtc-unless-in-sync.md)). Each device plays as soon as it receives the capture, so two rooms can be slightly apart. The publisher sends each receiver its own stream, so its upload and encoding work grow with every receiver.

To have devices play together instead, open **Where it plays** while the source plays on more than one device and turn on **In sync**. The playback's Sendspin group then distributes sound against a shared clock, and each picture follows that clock through the normal HLS renderer, from an address that works only while that device's output shows the picture. In sync buffers the capture: devices play together a few seconds behind the source. It stays on for that playback until turned off, which returns every receiver to WebRTC. Only while something plays the source buffered does Couch ask the publisher for a recording, upload it with a token scoped to the publication, and encode it with FFmpeg; the first time, Couch may download FFmpeg then.

In sync keeps recording and encoding while paused, including while waiting for offline outputs to reconnect. Stop that playback or turn In sync off to release its stream when no other playback or fallback receiver needs it. Fallback receivers need the stream only while connected; when the last one disconnects and no In sync playback needs it, recording and encoding stop.

When the sharing device and a receiver can't connect directly, Couch plays Couch's buffered stream of the source on that receiver alone, a few seconds behind, and **Where it plays** marks that device **Buffered**. The other receivers keep their direct connections. This happens, for example, when a browser allows WebRTC no network path. The direct connection is abandoned when it fails, when either device can't negotiate it, or when it hasn't connected within 10 seconds; the receiver keeps buffering meanwhile, and `couch.log` records the reason and lists the device as `(buffered)` in its delivery line. That receiver stays buffered for this source until sharing ends; another item, or another device, plays directly as usual. A failure of the buffered stream itself ends only buffered delivery: direct receivers and capture continue, while each buffered receiver stops and **Where it plays** shows why. Couch doesn't restart that failed stream automatically; playing the source again retries it. When no other receiver plays it, the playback shows the error.

Buffered playback adds encoding, HLS and scheduling delay; In sync uses it so receivers can play the same sound together. Receivers can only delay sound, never play it before it arrives, so none of them can line up with the original sound on the sharing Mac. Muting the original and letting the Mac play the delayed copy as a synchronized speaker needs a native Core Audio process tap; that has only been prototyped and is not part of Couch. Its capture-to-output latency must be measured separately from single-device playback. Capture does not create a seekable recording. The player exposes controls according to the stream's reported capabilities, as it does for other live channels.

Use the normal HTTPS Couch address for capture and playback. Direct playback uses LAN STUN on Couch's port over UDP when that port is free, otherwise Couch logs it and keeps sharing without it. It can also use an authenticated TURN relay when the network blocks a direct connection, which keeps that receiver direct instead of buffered only if its browser can reach the relay: a browser or network that gives WebRTC no path to it still falls back to buffered. On the hosting computer, open **Settings → Devices → Live playback relay**. Enter an existing relay's TURN address, username and password, then **Save relay**. Couch saves these with this Core's data and keeps them after a normal app restart; it does not provision a relay. **Check saved relay** asks this computer's browser to make an authenticated TURN allocation, without capturing any media. A successful check proves reachability from this computer only; test the actual receiving device too. A failed check reports the problem and leaves the saved configuration available to correct or remove. Saving alone is not a connectivity check.

Connected devices receive saved changes for their next WebRTC connection; current streams keep playing. If a receiver is already **Buffered**, **Stop sharing** and start sharing again, then rejoin it. A new connection still tries ordinary local routes as well as the relay; Couch never forces all playback through TURN. **Remove relay** takes effect for new connections and survives restarts. Relay settings can be edited only on the hosting computer. Credentials are stored in its private data directory and supplied only to admitted paired devices; they are never part of public discovery.

`COUCH_LIVE_TURN_URL`, `COUCH_LIVE_TURN_USERNAME` and `COUCH_LIVE_TURN_CREDENTIAL` remain startup defaults for deployments. A saved relay or saved removal takes precedence over them.

## Packaged Mac check

Use the isolated, consistently signed **Couch Dev** setup in
[macOS development capture permissions](macos-development.md). Ad-hoc builds
can lose their permission identity on every rebuild even while Settings shows
access enabled. Launching Electron directly from Terminal or an IDE also does
not prove that the packaged app's macOS audio permission declarations work.

```sh
bun install --frozen-lockfile
bun run typecheck
bun run package --mac --dir --arm64 \
  -c.appId=quest.avoid.couch.dev '-c.productName=Couch Dev' \
  -c.extraMetadata.identifier=quest.avoid.couch.dev \
  -c.directories.output=.artifacts/app-dev \
  '-c.mac.identity=Couch Development' -c.forceCodeSigning=true
couch_live_data=$(mktemp -d "${TMPDIR%/}/couch-live.XXXXXX")
open -n --env "COUCH_DATA_DIR=$couch_live_data" --env COUCH_PORT=4510 \
  "$PWD/.artifacts/app-dev/mac-arm64/Couch Dev.app"
```

For Intel, use `--x64` and `mac` in the bundle path. Record the PID of this exact
bundle's main executable after LaunchServices starts it. The separate data
directory gives Chromium a separate profile and instance lock. Pair the receivers
with this scratch Couch's address and code. Its application log is
`$couch_live_data/logs/couch.log`.

Set `couch_live_pid` to that verified main-process PID before using the stop command below.

Check system audio with music playing, screen & audio with a changing picture and sound, and microphone with speech or an audio interface signal. Add a second receiver through **Where it plays**, check that both stay direct (`Direct on …` in `couch.log`, no **Buffered** row), then turn on **In sync** and check audible alignment between devices and picture/sound alignment on each. Measure capture-to-output delay separately; a shared software clock does not establish physical speaker timing. Confirm volumes, timing adjustment, picture selection and queued-item playback work, and **Stop** reception leaves capture active. Confirm **Stop sharing**, the OS stop-sharing control, and publisher disconnect each end the input on every receiver and release capture while retaining other queued media. Stop this scratch app by its recorded PID:

```sh
kill "$couch_live_pid"
```

Browser checks with a generated canvas and audio track can verify routing, WebRTC delivery, buffered upload, rendering, autoplay recovery and cleanup. They do not verify physical macOS capture, audible synchronization between devices, hardware encoding or capture-to-output latency.

## Scratch Core with a relay

To test a candidate build from a Mac and phones on the LAN, run its Core on a
Linux machine with a temporary TURN relay. [scripts/live-dev.sh](../scripts/live-dev.sh)
starts the built Core (`node build/core.mjs`) and coturn's official image,
waits until both answer, and stops both when it exits. It needs Docker, `curl`, `setsid`,
`openssl`, `ss` and `ip`. Pull the pinned relay image once; the script never
pulls it:

```sh
docker pull coturn/coturn:4.18.0-alpine
bun install --frozen-lockfile
bun run build
couch_live_data=$(mktemp -d /tmp/couch-live.XXXXXX)
COUCH_DATA_DIR=$couch_live_data COUCH_PORT=4610 scripts/live-dev.sh 192.168.1.20
```

Pass this machine's LAN IPv4 address. Core serves HTTPS with its self-signed
certificate on every local address at `COUCH_PORT` and prints the pairing code.
Open it by IP address, `https://192.168.1.20:4610`: a standalone Core accepts
only its own addresses as the host, so a DNS name gets `Unrecognized host or
origin`. Accept the certificate warning once on each device and pair it.

The relay listens on that address at `COUCH_PORT + 1` over TCP only, the
`turn:…?transport=tcp` URL Core hands to paired devices, and relays through UDP
ports 49160–49200 on the same address. It requires the generated credential,
which stays in `$couch_live_data/turn` (mode 0600) and Core's environment,
never in arguments or logs, and lasts as long as that data directory. It relays
only to private (RFC 1918) addresses, so it can't carry traffic to the internet;
do not forward its ports. A standalone Core has no LAN STUN, so a browser that
hides its host addresses, as Android Chrome does without capture permission,
can connect through the relay rather than fall back to buffered playback, if it
can reach this address and port.

Capture on the Mac with Couch Preview 0.3.1-preview.3 or later in Client mode,
which has the capture bridge the page uses. A scratch data directory leaves the
installed Couch's own mode and pairing as they are:

```sh
couch_client_data=$(mktemp -d "${TMPDIR%/}/couch-client.XXXXXX")
open -n --env "COUCH_DATA_DIR=$couch_client_data" --env COUCH_PORT=4510 "/Applications/Couch Preview.app"
```

Enter `https://192.168.1.20:4610` in **Another Couch**, connect, pair, then add
the source as above. A browser tab on the Mac can capture the screen too, but may
not include the computer's audio.

To tell how each receiver plays, read `$couch_live_data/logs/couch.log`:
`playback … Direct on A, B` means WebRTC, and `(buffered)` after a name means
that device fell back to Couch's buffered stream, after a `player error` line
with the reason. Browsers open a relay session for every connection, so a
session in `$couch_live_data/logs/turn.log` alone doesn't show the media went
through the relay; the selected candidate pair in `chrome://webrtc-internals`
on Android Chrome does.

Stop it with Ctrl-C, or by the PID it recorded once `ps` shows it is this script:

```sh
ps -o args= -p "$(cat "$couch_live_data/live-dev.pid")"
kill "$(cat "$couch_live_data/live-dev.pid")"
```

If the script itself was killed without cleaning up, remove what it recorded,
Core once `ps` shows it is `node build/core.mjs`:

```sh
ps -o args= -p "$(cat "$couch_live_data/core.pid")"
kill "$(cat "$couch_live_data/core.pid")"
docker rm -f "$(cat "$couch_live_data/turn/container")"
```
