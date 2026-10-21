# Settings

## Pages

Two owners (`src/shared/settings-pages.ts`): what changes only the device in
hand, and the Couch everyone shares, its hardware included:

| Page | Owner | Path | Holds |
| --- | --- | --- | --- |
| General | This device | `/settings/device` | name, text size, Keep screen awake, online video quality, which Couch it shows, what it lets other devices use, Share screen or sound, Quit Couch (app) |
| Home & Discover | This device | `/settings/device/home` | Home's shelves, then Discover's sections |
| Updates | This device | `/settings/device/updates` | this app's updates and logs (a desktop app that doesn't run the Couch) |
| Devices & network | Couch | `/settings/couch/devices` | pairing, devices and roles (the Couch's name is its host's row), Share on network, HTTP, network address, live relay |
| Playback | Couch | `/settings/couch/playback` | the watching profile's preferences (Autoplay among them), Ask every device where a shared source plays |
| Sources | Couch | `/settings/couch/sources` | source pages (Live TV, Radio playlists, StreamingCommunity under Sources), AirPlay, Hidden |
| Sound | Couch | `/settings/couch/sound` | output, test and delay, Bluetooth (where Couch controls the system's sound) |
| TV | Couch | `/settings/couch/tv` | TV mode, Start on boot, Screen, text size (where the Couch is or can be a TV) |
| Updates | Couch | `/settings/couch/updates` | the Couch apps an admin updates (where there is an updater) |

Wide screens and the TV open Settings on General. The stack's flat paths
(`/settings/home`, `/settings/devices`, `/settings/sound`, …) and main's older
ones redirect through `settingsAliases`. The player's gear opens the player's
own Playback menu, not this page.

Home & Discover lists each section with a Switch and Move up/down (no drag),
saved per device, each list with Reset to default. A Move that reaches an end
returns focus to the row's Switch.

## Section nav

The rail has one group per owner, each a heading over a muted line: **This
device** over this device's name, then the Couch's own name over a dot and
Connected, Reconnecting or Offline, with "admin" when this device is one. The
current entry has a left rule and a quiet background. A page this device can't
change at all (Sound, TV and the Couch's Updates for a non-admin) ends in a
small lock, and still opens and shows its values. On the host the two groups
are one, headed by the Couch's name over "This computer runs it" (or "This TV
runs it").

The selected entry names the page, so pages keep an `sr-only` h1 from `md` up.
Below `md`, `/settings` is the rail as divided rows, and each page leads with
its owner as a breadcrumb ("This device ›" or "{Couch} ›") above a visible
title; Back goes up to the list. A source's own page shows "Sources ›" above
its title at every width. Rows stack label and control until their column has
room for both.

On the TV, Settings starts on the rail's current entry; OK opens a page and
focuses its first enabled control; Back from the content returns to the rail
(a source page first returns to Sources), then Home. Entering Devices &
network focuses Pair a device when available.

## Who can change what

Every paired device opens every page. Rows that need an admin stay, saying
"Only an admin can change this.", and Core enforces it. A device's own name,
consent and capture, Quit Couch and the host's first-admin code stay local.
The host's General says its speakers and screen are shared while Share on
network is on.

This device owns its name, which is also the name of a Couch it hosts; an
admin renames another host from its row in Devices & network. First run and
pairing: [Shell](shell.md#first-run-and-pairing).
