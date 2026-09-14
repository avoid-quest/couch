# Control your TV from Mac or Windows

Couch's Mac and Windows clients control the existing Ubuntu TV. Open the TV's
address in a browser. The TV owns playback, its media folders and the shared
queue. You do not need Bun, Rust, Docker or a native Couch package on the
controller computer.

## Connect

1. Connect your computer to the TV's network. A fresh TV shows its address and
   pairing QR on **Claim and name**. On a configured TV, open **Pair a remote**
   for the address/code or **Settings > Connections** for the QR. Type the
   address into your browser, including any port.
2. Give this browser a name, such as **Living room Mac** or **Windows laptop**,
   and enter the TV's six-digit pairing code.
3. Open **Search** for a title or link, or **Library** for provider catalogs and
   configured sources. **Play** starts now; **Up next** adds without starting.
   Closing your browser leaves playback running on the TV.

Use the address shown by your TV, not `couch.avoid.quest`, which is the project
website. A loopback address such as `127.0.0.1` reaches your own computer. For
another computer, use the advertised LAN address or the configured hostname.

Pairing grants ordinary controller access. It does not grant administrator
access or turn the computer into another TV player. Media-folder paths refer to
the Ubuntu TV, including any NAS shares mounted there. Your laptop's files do
not become available to the TV by entering their paths.

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

The shortcut opens the TV's current app. The Ubuntu TV must be running and
reachable. Browser installation does not provide offline playback.

## Reconnect

Reopen the same address in the same browser profile or installed web app to
reuse its pairing. Private browsing, another profile, cleared website data or
a changed address can require pairing again.

**Settings > Connections** shows the TV address, connection status and this
remote's authority. Use **Reconnect** after the TV or network returns. Use
**Pair again** when you need a new pairing. That action forgets this browser's
credential; an administrator can revoke an old remote on the TV through
**Connections > Paired remotes**. Neither action deletes the TV's media or queue.

For a configured HTTPS address, the computer must trust the deployment's
certificate. Follow the administrator's [named-origin setup](lan-origin.md)
and use its advertised address consistently.

## Qualification

The owner selected this controller scope on
[8 September 2026](https://github.com/avoid-quest/couch/issues/171#issuecomment-5581948822).
The completed Mac checks used Safari and its website app against a loopback
fixture. They cover pairing, app installation, empty-library browsing and
reconnect. The Mac-to-installed-TV journey, including LAN access, populated
Search, playback commands and physical playback, remains pending. Windows/Edge
verification was deferred; native Mac/Windows playback and a separate server
were not delivered.
See [desktop controller qualification](qualification/desktop-controllers-171.md)
for the tested platforms and outstanding acceptance.
