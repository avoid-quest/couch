# Control Couch from Mac or Windows

## In a browser

Open the address the TV shows (not `couch.avoid.quest`, the project website),
continue past the certificate warning once, name the browser and enter the TV's
six-digit pairing code ([Connect a phone](usage.md#connect-a-phone)). Nothing
needs installing; closing the browser leaves playback running.

Reopen the same address in the same browser profile to reuse its pairing. Private
browsing, another profile, cleared website data or a changed address pair again.
Pairing again replaces that device's token and grants Controller access, even if
it was admin.

For a separate window: Safari's **File > Add to Dock** on macOS 14+, or Edge's
**Apps > Install this site as an app** on Windows. Chrome offers no install over
the self-signed certificate.

## The desktop app

The Couch app runs in **This computer** (Full) or **Another Couch** (Client)
mode. In Client mode the local Core stays stopped and the window loads the other
Couch's own page, which pairs like a browser and pins its certificate, so no
warning shows. If that Couch is unreachable, the app keeps trying and offers
**Try again** or **Use this computer**; it never switches on its own.

Closing the window keeps Couch running (in the tray; minimized on Linux).
**Quit Couch** in **Settings → This device**, the tray or the app menu stops the
app and its Core; on Linux and Windows **Ctrl+Q** works too.
