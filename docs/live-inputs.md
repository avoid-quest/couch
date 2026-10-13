# Share a live device

On each receiving device, pair with the same Couch and enable **Settings → General → Share audio** and, for a screen, **Share video**. These permissions let other devices use its outputs; capture still starts only on the sharing device.

On the publishing device, open **Settings → Sources → Device inputs**, or **Find → Device inputs → Add source**. Choose **System audio**, **Screen**, or **Microphone or audio input**, then choose the screen/window or audio input and **Start sharing**. Allow the macOS permission prompts. Audio defaults to the system input; **Choose audio input** requests microphone access, lists connected microphones and audio interfaces, then immediately releases that temporary capture.

Screen capture defaults to at most 1920×1080 at 30 fps, preserving its aspect ratio. Choose **720p** to reduce bandwidth and processing, or **Original resolution** for more detail. Turn off **Include system audio** for picture only. System-audio capture retains a small video track at at most 320×180 and 1 fps because the display-capture API requires it; that video is never sent. Captured audio requests echo cancellation, noise suppression and automatic gain control off so they do not alter music or input signals.

Active inputs appear alongside other sources in **Find → Device inputs** and in Find search results. The **Device inputs** source filter and **Live** kind filter include them. Playing one opens the same **Now Playing** experience as a TV channel or radio station, with the normal player, mini player, **Playback** settings and **Up next**.

Choose **Play on** beside the new live source to select the first receiver. Open **Where it plays** in the player or mini player, raise another device's level to add sound, and enable its **Picture** to add video. A browser may ask for **Tap to hear** on its own screen. The sharing Mac's sound stays off for system audio and screen capture to prevent recapturing its playback.

Use the same volume, mute, device timing adjustment and playback preferences as for other media. Queue another item while an input is playing, then use **Next** or play it from **Up next**; there is no need to stop first. Captured inputs exist only while sharing is active, so they cannot be saved for later or restored after restarting Couch. Ending capture removes its entries while retaining other queued media. **Save as list** can save ordinary items in Up next.

**Stop** stops the selected playback; **Stop sharing** ends capture and removes the source from every receiver. Sharing remains active while you browse, with a Stop sharing action in the header. Closing or reloading the publishing window, disconnecting it from Couch, or stopping capture through the OS also ends sharing. Another controller can play or stop reception but cannot request capture or end somebody else's source.

System audio on macOS requires **14.2 or later**. Screen capture on older supported macOS versions can provide picture without audio; Couch displays the actual captured capability. Including system audio sends the computer's audio mix, including when the picture is one window. It does not isolate that window's application audio. If permission was just changed in **System Settings → Privacy & Security → Screen & System Audio Recording** or **Microphone**, reopen the test app when macOS asks.

The publishing device uploads one encoded capture to Couch over its authenticated connection. Couch converts it to a live HLS stream, which uses the same playback pipeline as other live media. When sound plays on several devices, the existing Sendspin group distributes it against a shared clock; each picture follows that clock through the normal renderer. Adding receivers does not create another capture encoder on the publishing device.

Encoding, HLS segments and the shared playback buffer add delay between capture and output. That buffer lets receivers schedule the same sound together instead of independently playing each arriving packet. This is for watching or listening together; it is not a low-latency microphone monitor. Capture does not create a seekable recording. The player exposes controls according to the stream's reported capabilities, as it does for other live channels.

Use the normal HTTPS Couch address for capture and playback. No TURN relay is required.

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
