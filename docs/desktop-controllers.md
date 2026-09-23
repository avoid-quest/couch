# Control Couch from Mac or Windows

Open the playback computer's address in a browser. The published Debian TV owns
playback, its media folders and the shared queue. You do not need Bun, Rust,
Docker or a native Couch package on the controller computer.

## Connect

1. Connect your computer to the playback computer's network. A fresh TV shows
   its address and pairing QR on **Claim and name**. On a configured TV, open
   **Pair a remote** in the header or **Settings > Connections > Pair a remote**.
   Both show a QR with the current six-digit code. Scan it or type the shown
   address into your browser, including any port.
2. Give this browser a name, such as **Living room Mac** or **Windows laptop**,
   and enter the TV's six-digit pairing code.
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
another player. Folder paths refer to the playback computer, including any NAS
shares mounted there. Your laptop's files do not become available by entering
their paths in a remote.

## Native Mac development app

The [native Mac source workflow](usage.md#native-mac-development) runs one app
with **This computer** and **Another Couch** modes. This computer owns a local
Bun host and trusted Settings access, but local Mac playback is still
unavailable. Another Couch opens the selected host's UI in a separate window;
it uses that host's paired role and does not run a local player or share the
Mac's files. The trusted local window keeps device selection and **Update this
app** access even if the selected host is offline. That control checks this
installation; source builds have no published Mac update to install. A paired
Administrator's **Settings > Updates** applies to the selected host. A
Controller cannot install that host's updates.

The app remembers the selected device. If it is unreachable, use **Retry**, check
its address or choose **Use this computer**; Couch does not switch hosts or start
playback on its own. Close keeps the app running. On Mac, reopen it from the
Dock or **Show Couch** in the app menu; **Quit Couch** ends the app and its owned
local host after any interruption confirmation. This source workflow is not a
published Mac installer or proof of native Mac playback.

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

The shortcut opens the TV's current app. The Debian TV must be running and
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

The [8 September browser checks](qualification/desktop-controllers-171.md) used
Safari and its website app against a loopback fixture. Later
[Mac source-app checks](qualification/desktop-461/README.md) exercised local and
remote mode, roles and client size; [window checks](qualification/desktop-464/README.md)
covered Close, reopen and Quit. Those checks do not qualify a downloaded Mac
installer, local Mac playback or Windows. The Mac-to-installed-TV physical
journey remains a separate acceptance check.
