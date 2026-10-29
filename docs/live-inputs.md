# Share a live device

Pair each receiving device with the same Couch. To play a source here, choose this device's name under **Play on**; it says **This device** underneath. With only one eligible online target, **Play on** is hidden; use **Play**. Playing here needs no output-sharing permission, though a publisher never plays its own capture (below).

To let *other* devices choose it as an output, open **Settings → This device** and enable **Speakers** and, for a screen, **Screen** under **Let other devices use**. Use the header's **Settings** tab on the TV and wide desktop windows, or the bottom bar's **Settings** tab on phones and narrow desktop windows. Choose **General** under **This device**, in the rail or, on a narrow screen, in the Settings list. Only that device can change these switches; an admin can't change them remotely. The app hosting Couch instead shares its own speakers and screen while **Share on network** is on in **Devices & network**. These permissions are separate from what the device currently plays and from capture, which starts only on the sharing device.

On the publishing device, press **Share** in the header (the screen icon at the end of a phone's top bar). Choose **Screen**, **Window**, **System audio** (this computer's audio) or **Audio input**. The hosting desktop also offers **Live** playback of a selected stereo input. In the desktop app, choose the screen or window from its pictures (another Couch's page in Client mode lists their names only). In a browser, choose the screen or window after **Start sharing**, in the browser's own picker. For a microphone or audio interface, keep **System default** or use **Find audio inputs** (then **Refresh inputs**) and select the input. To play it at once, choose devices under **Play on**; without one it waits in Home's **Shared sources**. Then **Start sharing**. A browser without screen capture offers audio inputs only; use the desktop app for a screen or system audio. On a TV, use its own remote for capture and consent; another device's **Remote** cannot change them. Allow the macOS permission prompts. A refused prompt, or a screen picker closed without a choice, is reported in the Share dialog in Couch's words ("Screen capture wasn't allowed. Choose a screen or window and allow it, then try again."; "No audio input was found…"), not the browser's. When the window shows another Couch (Client mode), this computer also asks each time before that Couch's page may use its microphone, a screen or window, or its audio, naming that Couch's address. A microphone is asked about for **Find audio inputs** and again for **Start sharing**. A screen or window is asked about for **Start sharing**, naming it from this computer's own list and saying whether this computer's audio is included; for **System audio** the prompt also says that page gets the screen's picture. Allow only what you just chose there. After you allow it, the page itself stops the capture when sharing ends: a page that ignores Close keeps what it was given until sharing is stopped through the OS or Couch quits. The names of screens and windows are listed to the page without asking. Audio defaults to the system input; **Find audio inputs** requests microphone access, lists connected microphones and audio interfaces, then immediately releases that temporary capture.

Screen capture defaults to at most 1920×1080 and a 60 FPS target, preserving its aspect ratio. The capture API accepts 30, 60 or 120 FPS independently of resolution, both before starting and during sharing. These are requested ceilings, not guarantees about the display, encoder or receiver; changing resolution preserves the rate and changing the rate preserves resolution. Choose **720p** under **Picture** to reduce bandwidth and processing, or **Original resolution** for more detail, before starting or while sharing, from the header's sharing capsule. Turn off **Include this computer's sound** for picture only. System-audio capture retains a small video track at at most 320×180 and 1 fps because the display-capture API requires it; Couch's page never sends that video. Captured audio requests echo cancellation, noise suppression and automatic gain control off so they do not alter music or input signals.

Buffered video keeps the recording's actual timestamps and variable frame rate,
including 60/120 FPS, instead of converting everything to a 30 FPS ceiling.
Misleading MediaRecorder frame-rate metadata does not duplicate idle frames.
[Video performance](video-performance.md) describes measurements and repeatable checks.

Active inputs lead **Home**'s **Shared sources** row while a device shares, and appear alongside other sources in **Search** results. Search's **Shared sources** source filter includes them. Their primary action plays; their menu offers **Play on**, **Play next** and **Queue**. Playing one opens the same **Now Playing** experience as a TV channel or radio station, with the controls allowed by its intent. Relaxed sources retain the normal player, **Playback** settings and **Up next**. Live audio listeners get **Join**, **Leave** and their own listening level; joining grants reception, while the source owns the programme.

The publishing device never plays its own capture: neither its picture nor its sound, microphone monitoring included. It stays a controller, listed in **Where it plays** as **Sharing this source**, and is not counted as a receiver. This applies to Play, Play on, Where it plays, **Move here**, a mix the source inherits, a queued source reached with Next, and reconnection; the publisher's other playback and its capture are unaffected. While its source plays in a playback the publisher was part of, or asked to choose receivers for, the publisher keeps viewing and controlling that playback, even after a device that keeps its outputs private joins it or stops sharing: Play, Play on another device, Queue and Where it plays all act on it. Capturing a source gives no control of anybody else's playback of it. When the queue moves on to an ordinary item or another device's source, or the publisher plays something, including another device's source, with Play, its output returns to that playback, unless it moved to another playback, was unpaired, or **Move here** moved the playback meanwhile; a speaker or screen it stopped sharing meanwhile does not return. Playing a source on its publisher, from **Play on** or with Play while controlling it, opens **Where it plays** in the window that pressed Play to choose receivers, again on each repeat; once closed, it stays closed when you open the player, until the next request. When the source already plays somewhere you can view, including the playback the publisher keeps controlling, it shows that playback and opens its **Where it plays** in that window only, again on each repeat, while the receivers keep playing.

**Ask every device where a shared source plays** in **Settings → Playback** is off by default. When off, only the window that pressed Play opens the chooser; other devices can still find the source in Home’s Shared sources and Search and choose to play it themselves. An admin can turn it on to ask every window viewing a playback waiting for receivers to open Where it plays. This is a Couch-wide setting, independent of the watching profile, and survives restarts. Playing on the publisher of a source already playing elsewhere still opens the chooser only in the requesting window.

**Play** and **Play on** join the playback already playing that source, with its queue and clock, so two devices that choose the same source share one session from Search or from **Where it plays** in Now Playing; a device busy with something else leaves it, and that item keeps its queue. For relaxed sharing, joining brings that playback's transport and queue controls, so it works only where you could already control it: when the source plays only on devices that keep their outputs private, Couch refuses and changes nothing. Couch also refuses rather than guesses when the source plays in several independent playbacks; open one in Now Playing to add the device there. A playback still waiting for its first receiver counts as neither. **Queue** and **Play next** add the source to Up next without joining or interrupting anything. **Move here** moves a playback to one device exclusively, including after the queue moves on; while another device's private output plays in it, or a publisher's private output waits to return after its source, Move here is unavailable, since nobody may take over that output. Couch checks this again when the move lands, so an output that turned private while the item loaded for its new device leaves the playback as it was. Move here stays offered on a device that is already the only output while a publisher left out for its own source would return; pressing it keeps that publisher out.

Open **Where it plays** in the player or now-playing bar and turn on a device's **Picture** or **Sound** to add it, as its consent and the source allow; turning off its last channel takes it out. While its sound is on, its row shows the volume fader. **Move here** transfers the Playback and queue exclusively to that destination. The **…** menu offers **Sync…** where applicable; the main Volume control mutes. On a TV, Left and Right on a device's row change its level, and OK opens its options. A browser may ask for **Tap to hear** on its own screen. A receiver plays only the channels Couch routed to it, whatever the sharing device sends. When a device stops sharing the screen or speakers a source uses, and no other output in the playback uses that source, the devices it cannot use leave the playback, which pauses and, when **Ask every device where a shared source plays** is on, opens **Where it plays** to choose another; a device playing it privately on itself stays, and the playback keeps waiting through that device reconnecting until an output that uses the source is chosen.

Use the same volume, mute and supported playback preferences as for other media. While a device's sound plays in sync with other devices, its row shows **Sync … ms earlier**, the per-device output alignment, when its delay is not 0. At 0, choose **Sync…** in the row's **…** menu to reveal the slider. Timestamped relaxed audio inputs and AirPlay use scheduled sound even with one listener, so Sync remains available. Captured video and legacy audio compatibility use **In sync** as described below. Live audience controls retain source-owned timing. The value is the one the speaker last reported; Core keeps it across restarts, and the speaker's own player keeps the value it applies. **Audio delay** in **Playback**, opened with the player's gear, is different: it shifts sound against picture where the player supports it. Queue an input alongside other items, then use **Next** or play it from **Up next**; there is no need to stop first. Captured inputs exist only while sharing is active, so they cannot be saved for later or restored after restarting Couch. Ending capture removes its entries while retaining other queued media. **Save as list** can save ordinary items in Up next.

**Stop** stops the selected playback; **Stop sharing** ends capture and removes the source from every receiver, whose players close with it under a toast that says who stopped sharing ("Golden Hare stopped sharing"); the publisher gets no toast for its own action. Sharing remains active while you browse, with the header's sharing capsule (Stop sharing, and a panel with who watches, each one's route, the picture's quality, a microphone's mute and Where it plays) and Stop sharing in the player's top band. When the last device stops playing it, a toast says it's still sharing, with Stop sharing. Closing or reloading the publishing window, disconnecting it from Couch, or stopping capture through the OS also ends sharing. Another controller can play or stop reception but cannot request capture or end somebody else's source.

For **Live audio**, the hosting desktop owns the input and publication. On Mac, inputs marked **Native** use the packaged capture helper; other inputs use a separate hidden browser capture window. The controller does not open a second microphone. A real stereo input is required. Sharing controls report the actual input rate and, for native inputs, buffer readback; the capture sample rate is in **Settings → Advanced audio**. Live listeners **Join** with the upstream Sendspin player, unlock it with **Tap to hear** if asked, and **Leave** without stopping capture or another listener. Their own volume and mute apply only to them. See [Live audio](live-audio.md) for the pipeline, the playback buffer and measured behavior.

Timestamped **Audio input** and AirPlay use the Sendspin relaxed audio scheduler, including a single listener, without an audio-only HLS recording. Browsers that cannot provide timestamped capture retain the WebRTC/buffered compatibility path below. Captured screen/window fallback retains actual recorded picture and sound.

System audio on macOS requires **14.2 or later**. Screen capture on older supported macOS versions can provide picture without audio; Couch displays the actual captured capability. Including system audio sends the computer's audio mix, including when the picture is one window. It does not isolate that window's application audio. If permission was just changed in **System Settings → Privacy & Security → Screen & System Audio Recording** or **Microphone**, reopen the test app when macOS asks.

For a relaxed captured screen or an audio publisher without timestamped capture, every receiving device gets its selected capture channels directly over WebRTC, however many devices receive it ([ADR 0001](adr/0001-live-inputs-play-over-webrtc-unless-in-sync.md)). Each device plays as soon as it receives the capture, so two rooms can be slightly apart. The publisher sends each receiver its own stream, so its upload and encoding work grow with every receiver.

For those WebRTC sources, to have devices play together instead, open **Where it plays** while the source plays on more than one device and turn on **In sync**. The playback's Sendspin group then distributes sound against a shared clock, and each picture follows that clock through the normal HLS renderer, from an address that works only while that device's output shows the picture. In sync buffers the capture: devices play together a few seconds behind the source. The switch stays on for that playback until turned off, but synchronization applies only while it has more than one receiver. Turning it off returns receivers to WebRTC, except those that already fell back to buffered delivery (**Behind**) for this source. Only while something plays the source buffered does Couch ask the publisher for a recording, upload it with a token scoped to the publication, and encode it with FFmpeg; the first time, Couch may download FFmpeg then.

In sync keeps recording and encoding while paused, including while waiting for offline outputs to reconnect. Stop that playback or turn In sync off to release its stream when no other playback or fallback receiver needs it. Fallback receivers need the stream only while connected; when the last one disconnects and no In sync playback needs it, recording and encoding stop.

For those WebRTC sources, when the sharing device and a receiver can't connect directly, Couch plays Couch's buffered stream of the source on that receiver alone, a few seconds behind, and **Where it plays** marks that device **Behind**. The other receivers keep their direct connections. This happens, for example, when a browser allows WebRTC no network path. The direct connection is abandoned when it fails, when either device can't negotiate it, or when it hasn't connected within 10 seconds; the receiver keeps buffering meanwhile, and `couch.log` records the reason and lists the device as `(buffered)` in its delivery line. That receiver stays buffered for this source until sharing ends; another item, or another device, plays directly as usual. A failure of the buffered stream itself ends only buffered delivery: direct receivers and capture continue, while each buffered receiver stops and **Where it plays** shows why. Couch doesn't restart that failed stream automatically; playing the source again retries it. When no other receiver plays it, the playback shows the error.

Buffered playback adds encoding and HLS delay. The buffered fallback plays HLS on that receiver alone; **In sync** also schedules sound with Sendspin so receivers can play it together. Receivers can only delay sound, never play it before it arrives, so none of them can line up with the original sound on the sharing Mac. Muting the original and letting the Mac play the delayed copy as a synchronized speaker needs a native Core Audio process tap; that has only been prototyped and is not part of Couch. Its capture-to-output latency must be measured separately from single-device playback. Capture does not create a seekable recording. The player exposes controls according to the stream's reported capabilities, as it does for other live channels.

Use the normal HTTPS Couch address for capture and playback. Direct playback uses LAN STUN on Couch's port over UDP when that port is free, otherwise Couch logs it and keeps sharing without it. It can also use an authenticated TURN relay when the network blocks a direct connection, which keeps that receiver direct instead of buffered only if its browser can reach the relay: a browser or network that gives WebRTC no path to it still falls back to buffered. On the hosting computer or a paired admin's device, open **Settings → Devices & network** (on a phone, choose **Devices & network** in the Settings list). Turn on **Share on network**, then under **Live playback relay** enable **Run relay on** followed by the Couch's name. The relay always runs on the computer hosting Couch; press **Check relay** in the **Check from this device** row to test whether the device you hold reaches it. Couch includes the relay in the installed app; it needs no separate server, account, runtime download or terminal command. The switch defaults to off and is saved across restarts. It starts only while **Share on network** has a usable selected LAN address. The relay listens on an automatically assigned TCP port on that address and uses UDP sockets on the same address to relay media. Couch manages fresh credentials for each run and supplies them only to paired devices. Allocation and peer access are restricted to the selected private IPv4 subnet; loopback, public, multicast and subnet broadcast addresses are refused. The helper stops, including existing relay connections, when its switch or network sharing is turned off, the selected address disappears, Core exits or its parent pipe closes. A failed start is shown in Settings and leaves ordinary Couch control available.

**Check relay** asks the browser of the device you hold to make an authenticated TURN allocation, without capturing any media. For an existing external service instead, turn the built-in relay off and expand **External relay settings**, enter its TURN address, username and password, then **Save relay** and **Check saved relay from this device**. External settings are saved across normal restarts. While the built-in switch is on, the external relay is not used, including if the built-in relay fails to start. A successful check proves reachability from the device that ran it only; test the actual receiving device too. A failed check reports the problem; check network access or correct external credentials as appropriate. Saving alone is not a connectivity check.

Removing a paired device restarts the built-in relay with fresh credentials and closes all its existing allocations before removal completes. The removed device cannot reuse cached built-in credentials. Other paired devices receive fresh settings for their next connection; their current relayed playback is interrupted and may switch to buffered delivery. To retry low-delay playback, stop sharing the source and start again. Direct connections that do not use the relay are unaffected. If restarting fails, the built-in relay remains unavailable without using the saved external service. Couch cannot revoke credentials or allocations on an external relay; rotate those through its provider if a removed device must lose access.

Connected devices receive saved changes for their next WebRTC connection; current streams keep playing. If a receiver is already **Behind**, **Stop sharing** and start sharing again, then rejoin it. A new connection still tries ordinary local routes as well as the relay; Couch never forces all playback through TURN. **Remove relay** removes the saved external service for new connections and survives restarts. The hosting computer and paired admins can edit relay settings; controllers can't. External credentials are stored in the hosting computer's private data directory; built-in credentials stay only in memory. Both are supplied only to admitted paired devices; they are never part of public discovery.

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

Check system audio with music playing, screen & audio with a changing picture and sound, and Audio input with speech or an audio interface signal. Separately test Live audio with a real stereo input, verify native readback, browser Join/Leave/own volume, and source cleanup. For captured video, add a second receiver through **Where it plays**, check that both stay direct (`Direct on …` in `couch.log`, no **Behind** row), then turn on **In sync** and check audible alignment between devices and picture/sound alignment on each. Measure capture-to-output delay separately; a shared software clock does not establish physical speaker timing. Confirm volumes, timing adjustment, picture selection and queued-item playback work, and **Stop** reception leaves capture active. Confirm **Stop sharing**, the OS stop-sharing control, and publisher disconnect each end the input on every receiver and release capture while retaining other queued media. Stop this scratch app by its recorded PID:

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
