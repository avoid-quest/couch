# Turn a computer into the TV

Status: preview · Scenes: home

A computer sits under the TV. Couch fills the screen with a layout for the
remote, plays through the right speakers, and phones become its remote.

## Journey

1. On the Couch computer: **Settings → TV → TV mode** → **Restart Couch**.
2. Arrows, **OK** and **Back** move around; held **OK** opens an item's menu.
3. **Screen**: **Try** a display → **Keep** (or it reverts after 20 seconds).
4. **Sound** → **Output**, **Test tone**, **Audio delay**; on Linux,
   **Bluetooth** → **Search** → **Connect** for a speaker.
5. A TV joining another Couch shows a code and QR code; an admin phone opens it,
   checks the digits and chooses **Pair**.
6. Phones use **Remote** to drive it.

## Done when

- TV mode is reachable from the remote alone: every page, menu and dialog.
- The chosen display and sound output survive restarts.
- A TV pairs by approval from an admin phone, without typing on the TV.

## Demo

Needs: the HDMI display (`~/.local/bin/couch-hdmi`) and a phone. Content: Home,
a film and a station.

## Known issues

- A TV waiting for approval stays on **Getting a code…**; **Enter a code
  instead** works.
- **Output**, **Test tone** and Bluetooth need Linux with PulseAudio or
  PipeWire; on Mac and Windows, pair speakers in the system.
- Starting with the computer is set up only by the Debian appliance install
  ([native TV](../native-tv.md)).
