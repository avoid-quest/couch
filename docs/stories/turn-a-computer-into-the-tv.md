# Turn a computer into the TV

Status: preview · Scenes: home

A computer sits under the TV. Couch fills the screen with a layout for the
remote or a game controller, plays through the right speakers, and phones become
its remote. With Steam on the same computer, the controller's Guide button
switches to games and back, and Couch keeps playing for the house.

## Journey

1. On the Couch computer: **Settings → TV → TV mode** → **Restart Couch**.
2. Arrows, **OK** and **Back** move around; held **OK** opens an item's menu.
   A game controller does the same: D-pad or left stick moves, the bottom face
   button (A, Cross) is **OK**, the right one (B, Circle) is **Back**.
3. **Screen**: **Try** a display → **Keep** (or it reverts after 20 seconds).
4. **Sound** → **Output**, **Test tone**, **Audio delay**; on Linux,
   **Bluetooth** → **Search** → **Connect** for a speaker.
5. A TV joining another Couch shows a code and QR code; an admin phone opens it,
   checks the digits and chooses **Pair**.
6. Phones use **Remote** to drive it.
7. With Steam running in the background, the Guide button (PS, Xbox) opens
   Steam Big Picture; the **Couch** tile in Steam comes back.

## Done when

- TV mode is reachable from the remote alone, or from a game controller alone:
  every page, menu and dialog.
- The controller moves Couch only while Couch is in front, never behind a game.
- Going to Steam and back needs only the controller, and doesn't stop Couch
  hosting or playing.
- The chosen display and sound output survive restarts.
- A TV pairs by approval from an admin phone, without typing on the TV.

## Demo

Needs: the HDMI display (`~/.local/bin/couch-hdmi`) and a phone. Content: Home,
a film and a station. For the controller and Steam: the Bazzite computer
(GNOME, Steam in the background) and a DualSense.

## Known issues

- **Output**, **Test tone** and Bluetooth need Linux with PulseAudio or
  PipeWire; on Mac and Windows, pair speakers in the system.
- Starting with the computer is set up only by the Debian appliance install
  ([native TV](../native-tv.md)).
