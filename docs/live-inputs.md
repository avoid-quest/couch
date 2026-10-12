# Share a live device

On each receiving device, pair with the same Couch and enable **Settings → General → Share audio** and, for a screen, **Share video**. These permissions let other devices use its outputs; capture still starts only on the sharing device.

On the publishing Mac, open **Find → Share this device**. Choose **System audio**, **Screen & audio**, or **Microphone**, then **Choose screen or window** for desktop capture and **Start sharing**. Allow the macOS permission prompts. Microphone uses the default input selected in macOS Sound settings, including an audio interface when it is the default.

Choose **Play on** beside the new live source to select the first receiver. Open **Where it plays** in the player or mini player, raise another device's level to add sound, and enable its **Picture** to add video. A browser may ask for **Tap to hear** on its own screen. The sharing Mac's sound stays off for system audio and screen capture to prevent recapturing its playback.

**Stop** stops the selected playback; **Stop sharing** ends capture and removes the source from every receiver. Sharing remains active while you browse, with a Stop sharing action in the header. Closing or reloading the publishing window, disconnecting it from Couch, or stopping capture through the OS also ends sharing. Another controller can play or stop reception but cannot request capture or end somebody else's source.

System audio on macOS requires **14.2 or later**. Screen capture on older supported macOS versions can provide picture without audio; Couch displays the actual captured capability. Screen & audio sends the selected picture and the computer's system audio mix, including when the picture is one window. It does not isolate that window's application audio. If permission was just changed in **System Settings → Privacy & Security → Screen & System Audio Recording** or **Microphone**, reopen the test app when macOS asks.

This first implementation sends WebRTC directly from the publisher to each selected device and is intended for a small group of two or three receivers on the same LAN. Sound and picture travel together per receiver. Independent devices can play at different times; this is not synchronized room audio or a synchronized video wall. Live inputs have no seek, pause backlog, playback speed, or subtitle controls.

## Packaged Mac check

Use a new packaged app for audio capture testing; launching Electron from Terminal or an IDE does not prove that the packaged app's macOS audio permission declarations work.

```sh
bun install --frozen-lockfile
bun run typecheck
bun run package --mac --dir --arm64
couch_live_data=$(mktemp -d "${TMPDIR%/}/couch-live.XXXXXX")
COUCH_DATA_DIR="$couch_live_data" COUCH_PORT=4510 \
  .artifacts/app/mac-arm64/Couch.app/Contents/MacOS/Couch \
  >"$couch_live_data/launcher.log" 2>&1 &
couch_live_pid=$!
```

For Intel, use `--x64` and `mac` in the bundle path. Run the bundle executable directly. The separate data directory also gives Chromium a separate profile and instance lock, so the installed Couch and its data remain untouched. Pair the receivers with this scratch Couch's address and code. Its application log is `$couch_live_data/logs/couch.log`.

Check system audio with music playing, screen & audio with a changing picture and sound, and microphone with speech or an audio interface signal. Confirm both receivers play, volumes and picture selection work, and Stop reception leaves capture active. Confirm Stop sharing, the OS stop-sharing control, and publisher disconnect each clear every receiver and release capture. Stop this scratch app by its recorded PID:

```sh
kill "$couch_live_pid"
```

Browser checks with a generated canvas and audio track can verify Couch's signaling, routing, rendering, autoplay recovery, and cleanup. They do not verify physical macOS capture, audio audibility, hardware encoding, or capture-to-output latency.
