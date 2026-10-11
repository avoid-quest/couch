# Control Couch from Mac or Windows

Open the playback computer's address in a browser. The selected Couch owns
playback and the shared queue. You do not need Node, Bun, Rust,
Docker or a native Couch package on the controller computer.

## Connect

1. Connect your computer to the playback computer's network. On the TV, choose
   **This computer**, open **Settings > Devices**, turn on **Share on network**
   if it is off and choose **Pair a device**. Scan its QR or type the shown
   address into your browser, including any port.
2. Give this browser a name, such as **Living room Mac** or **Windows laptop**,
   and enter the TV's six-digit pairing code. The first device you pair becomes
   the admin.
3. **Home** shows current playback and **Up next**. Use **Find** for a title,
   link, provider catalog or configured source. **Play** starts now; **Queue**
   in its **…** menu adds to Up next. **Saved** holds lists and favorites, and
   **Settings** the rest. Closing your browser leaves playback running on the
   TV.

Use the address shown by your TV, not `couch.avoid.quest`, which is the project
website. A loopback address such as `127.0.0.1` reaches your own computer. For
another computer, use the advertised LAN address or the configured hostname.

Pairing grants Controller access, except for the first device, which becomes
the admin. If no paired device is admin later, the TV's **Settings > Devices**
shows a one-use code; enter it under **Admin code** in this browser's
**Settings > Devices** and choose **Become admin**. An admin can make later
devices admin with **Make admin** in **Settings > Devices**. A browser does not become
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
**Quit Couch** in **Settings → General**, the tray or the app menu stops the app
and its Core. On Linux and Windows, **File → Quit Couch** and **Ctrl+Q** also work
when the system tray is unavailable or the page cannot load. See the
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
An Administrator can remove an old device in **Settings > Devices**.
Pairing again does not delete the TV's media or queue.

Couch serves the LAN over HTTPS with its own self-signed certificate, so a
browser shows a certificate warning the first time; choose to continue to the
address shown on the TV. Chrome then registers no service worker and offers no
install for that address, because the certificate is not trusted. The Couch app
in Client mode trusts the certificate it saw when that Couch was chosen and
shows no warning. Use the advertised address consistently
([named-origin setup](lan-origin.md)).
