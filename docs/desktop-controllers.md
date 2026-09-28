# Control Couch from Mac or Windows

Open the playback computer's address in a browser. The selected Couch owns
playback and the shared queue. You do not need Node, Bun, Rust,
Docker or a native Couch package on the controller computer.

## Connect

1. Connect your computer to the playback computer's network. On a fresh TV,
   choose **This computer**, allow remote control and open **Settings >
   Connections > Pair a remote**. If you kept the TV private, turn on **Allow
   remote control** there first. A configured TV also has **Pair a remote** in
   the header. Scan its QR or type the shown address into your browser, including
   any port.
2. Give this browser a name, such as **Living room Mac** or **Windows laptop**,
   and enter the TV's six-digit pairing code. On a fresh TV, claim Administrator
   access in this browser's **Settings > Connections** using the separate
   one-use code shown on the TV's Connections page.
3. Open **Now** for current playback and **Up next**. Use its search field or
   **Find** for a title, link, provider catalog or configured source. **Play**
   starts now; **Up next** adds without starting. **Saved** holds lists and
   favorites. Closing your browser leaves playback running on the TV.

Use the address shown by your TV, not `couch.avoid.quest`, which is the project
website. A loopback address such as `127.0.0.1` reaches your own computer. For
another computer, use the advertised LAN address or the configured hostname.

Pairing grants Controller access. The first remote can claim Administrator
access with the separate setup code on the TV; a current Administrator can
promote later remotes in **Settings > Connections**. A browser does not become
another player.

## Native desktop app

The Couch app for macOS, Windows and Linux runs in **This computer** (Full) or
**Another Couch** (Client) mode. This computer runs a local Core with trusted
Settings access. Another Couch keeps the local Core stopped and loads that Couch's
own page, which pairs like a browser and keeps its pairing.

The app remembers the chosen mode and addresses. If the other Couch is
unreachable, the app keeps trying and offers **Try again** or **Use this
computer**; it never switches on its own. Closing the window keeps Couch running
(minimized on Linux); reopen it from the tray, the Dock or by starting it again.
**Quit Couch** in the tray or app menu stops the app and its Core. See the
[current architecture](architecture.md).

## Keep a shortcut

A bookmark to the TV's address works on either platform. For a separate window,
the browsers also provide their own website-app installation:

- On macOS Sonoma 14 or later, open the TV address in Safari and choose **File >
  Add to Dock**. Name it **Couch**. Open it from the Dock or Spotlight and pair
  there if prompted. Safari web apps keep their own website data. See
  [Apple's web app guide](https://support.apple.com/en-us/104996).
- On Windows, open the TV address in Microsoft Edge and choose **Settings and
  more > More tools > Apps > Install this site as an app**. Open the app and
  pair if prompted. In `edge://apps`, its **Details** page can pin it to Start or
  the taskbar. See [Microsoft's app guide](https://support.microsoft.com/en-us/edge/install-manage-or-uninstall-apps-in-microsoft-edge).

The shortcut opens the TV's current app. The selected Couch must be running and
reachable. Browser installation does not provide offline playback.

## Reconnect

Reopen the same address in the same browser profile or installed web app to
reuse its pairing. Private browsing, another profile, cleared website data or
a changed address can require pairing again.

The client retries when the TV or network returns; the header shows connection
status and the playback computer's address. If Couch rejects the saved pairing,
the pairing form appears. Get a current QR or code from the TV and pair again.
An Administrator can remove an old device in **Settings > Connections > Devices**.
Pairing again does not delete the TV's media or queue.

For a configured HTTPS address, the computer must trust the deployment's
certificate. Follow the administrator's [named-origin setup](lan-origin.md)
and use its advertised address consistently.
