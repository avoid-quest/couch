# Share a live device

Pair each receiving device with the same Couch. A device can always play a source on itself with **Play on → This device**. To let *other* devices choose it as an output, enable **Settings → General → Let other devices use speakers** and, for a screen, **Let other devices use screen**. These permissions are separate from what the device currently plays and from capture, which starts only on the sharing device.

On the publishing device, open **Find → Add source → This device**, or **Settings → Sources → This device**. Choose **System audio**, **Screen**, or **Microphone or audio input**, then choose the screen/window or audio input and **Add source**. Allow the macOS permission prompts. Audio defaults to the system input; **Choose audio input** requests microphone access, lists connected microphones and audio interfaces, then immediately releases that temporary capture.

Screen capture defaults to at most 1920×1080 at 30 fps, preserving its aspect ratio. Choose **720p** to reduce bandwidth and processing, or **Original resolution** for more detail. Turn off **Include system audio** for picture only. System-audio capture retains a small video track at at most 320×180 and 1 fps because the display-capture API requires it; that video is never sent. Captured audio requests echo cancellation, noise suppression and automatic gain control off so they do not alter music or input signals.

Active inputs appear directly alongside other sources in **Find** and its search results. The **Shared sources** source filter and **Live** kind filter include them. Their ordinary media rows offer **Play**, **Play on**, **Play next** and **Queue**. Playing one opens the same **Now Playing** experience as a TV channel or radio station, with the normal player, mini player, **Playback** settings and **Up next**.

The publishing device never plays its own capture: neither its picture nor its sound, microphone monitoring included. It stays a controller, listed in **Where it plays** as **Sharing this source**, and is not counted as a receiver, so a Mac sharing to one phone stays on the low-latency single-receiver path. This applies to Play, Play on, Where it plays, **Only here**, a mix the source inherits, a queued source reached with Next, and reconnection; the publisher's other playback and its capture are unaffected. While its source plays in a playback the publisher was part of, or asked to choose receivers for, the publisher keeps controlling that playback, even after a device that keeps its outputs private joins it; capturing a source gives no control of anybody else's playback of it. When the queue moves on to an ordinary item or another device's source, the publisher's output returns to that playback, unless it moved to another playback, was unpaired, or **Only here** moved the playback meanwhile. Playing a source on its publisher, from **Play on** or with Play while controlling it, opens **Where it plays** to choose receivers, again on each repeat; once closed, it stays closed when you open the player, until the next request. When the source already plays somewhere you can view, it shows that playback instead.

**Play** and **Play on** join the playback already playing that source, with its queue and clock, so two devices that choose the same source share one session from Find or from **Where it plays** in Now Playing; a device busy with something else leaves it, and that item keeps its queue. Joining brings that playback's transport and queue controls, so it works only where you could already control it: when the source plays only on devices that keep their outputs private, Couch refuses and changes nothing. Couch also refuses rather than guesses when the source plays in several independent playbacks; open one in Now Playing to add the device there. A playback still waiting for its first receiver counts as neither. **Queue** and **Play next** add the source to Up next without joining or interrupting anything. **Only here** moves a playback to one device exclusively; while another device's private output plays in it, Only here is unavailable, since nobody may take over that output. Couch checks this again when the move lands, so an output that turned private while the item loaded for its new device leaves the playback as it was. Pressing Only here on a device that is already the only output still makes it exclusive: a publisher left out for its own source then stays out, unless its output is private to it.

Open **Where it plays** in the player or mini player, raise another device's level to add sound, and enable its **Picture** to add video. A browser may ask for **Tap to hear** on its own screen.

Use the same volume, mute and supported playback preferences as for other media. While several devices play in sync, each row offers **Sync … ms earlier**, the per-device output alignment. With one receiver there is nothing to align: the row shows the saved value and when it applies, and Couch never switches to buffered group playback just to show the control. The value is the one the speaker last reported; Core keeps it across restarts, and the speaker's own player keeps the value it applies. **Audio delay** in Playback is different: it shifts sound against picture where the player supports it. Queue an input alongside other items, then use **Next** or play it from **Up next**; there is no need to stop first. Captured inputs exist only while sharing is active, so they cannot be saved for later or restored after restarting Couch. Ending capture removes its entries while retaining other queued media. **Save as list** can save ordinary items in Up next.

**Stop** stops the selected playback; **Stop sharing** ends capture and removes the source from every receiver. Sharing remains active while you browse, with a Stop sharing action in the header. Closing or reloading the publishing window, disconnecting it from Couch, or stopping capture through the OS also ends sharing. Another controller can play or stop reception but cannot request capture or end somebody else's source.

System audio on macOS requires **14.2 or later**. Screen capture on older supported macOS versions can provide picture without audio; Couch displays the actual captured capability. Including system audio sends the computer's audio mix, including when the picture is one window. It does not isolate that window's application audio. If permission was just changed in **System Settings → Privacy & Security → Screen & System Audio Recording** or **Microphone**, reopen the test app when macOS asks.

One receiving device gets the capture over WebRTC in the ordinary player, avoiding segmented playback buffers. When outputs span several devices, the existing Sendspin group distributes sound against a shared clock; each picture follows that clock through the normal HLS renderer. Couch switches delivery automatically when outputs change. The publisher also keeps one authenticated encoded upload available for that grouped playback path.

Grouped playback adds encoding, HLS and scheduling delay so receivers can play the same sound together. Receivers can only delay sound, never play it before it arrives, so none of them can line up with the original sound on the sharing Mac. Muting the original and letting the Mac play the delayed copy as a synchronized speaker needs a native Core Audio process tap; that has only been prototyped and is not part of Couch. Its capture-to-output latency must be measured separately from single-device playback. Capture does not create a seekable recording. The player exposes controls according to the stream's reported capabilities, as it does for other live channels.

Use the normal HTTPS Couch address for capture and playback. Direct playback uses LAN STUN and can use an authenticated TURN relay when the network blocks a direct connection. Configure `COUCH_LIVE_TURN_URL`, `COUCH_LIVE_TURN_USERNAME` and `COUCH_LIVE_TURN_CREDENTIAL` in Couch's launch environment. Relay credentials are returned only to paired devices through `/api/live/ice-servers`; they are never part of public discovery.

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

Check system audio with music playing, screen & audio with a changing picture and sound, and microphone with speech or an audio interface signal. Add a second receiver through **Where it plays**, then check audible alignment between devices and picture/sound alignment on each. Measure capture-to-output delay separately; a shared software clock does not establish physical speaker timing. Confirm volumes, timing adjustment, picture selection and queued-item playback work, and **Stop** reception leaves capture active. Confirm **Stop sharing**, the OS stop-sharing control, and publisher disconnect each end the input on every receiver and release capture while retaining other queued media. Stop this scratch app by its recorded PID:

```sh
kill "$couch_live_pid"
```

Browser checks with a generated canvas and audio track can verify capture upload, routing, rendering, autoplay recovery and cleanup. They do not verify physical macOS capture, audible synchronization between devices, hardware encoding or capture-to-output latency.
