# Settings

## Pages

One flat list (`src/shared/settings-pages.ts`):

| Page | Path | Holds |
| --- | --- | --- |
| This device | `/settings/device` | name, text size, Keep screen awake, online video quality, which Couch it shows, what it lets other devices use, Share screen or sound, Quit Couch (app) |
| Home & Discover | `/settings/home` | Home's shelves, then Discover's sections ("Only on this device.") |
| Devices & network | `/settings/devices` | pairing, devices and roles (the Couch's name is its host's row), Share on network, HTTP, network address, live relay |
| Playback | `/settings/playback` | the watching profile's preferences (Autoplay among them), Ask every device where a shared source plays |
| Sources | `/settings/sources` | source pages (Live TV, Radio playlists, StreamingCommunity under ‹ Sources), AirPlay, Hidden |
| Sound | `/settings/sound` | output, test and delay, Bluetooth (where Couch controls the system's sound) |
| TV | `/settings/display` | TV mode, Start on boot, Screen, text size (where the Couch is or can be a TV) |
| Updates | `/settings/updates` | this app's updates, or the Couch apps an admin updates (where there is an updater) |

Settings opens on This device. Earlier paths (`/settings/device/…`,
`/settings/couch/…` and older) redirect through `settingsAliases`. The player's
gear opens the player's own Playback Sheet, not this page.

Home & Discover lists each section with a Switch and Move up/down (no drag),
saved per device, each list with Reset to default. A Move that reaches an end
returns focus to the row's Switch.

## Section nav

Saved and Settings share one section nav: a rail on wide screens (left rule
and quiet background on the current entry, no heading) and a Select on
phones. The selected entry names the page, so pages keep only an `sr-only`
h1; a source's own page shows its title under "‹ Sources". Rows stack label
and control until their column has room for both.

On the TV, Settings starts on the rail's current entry; OK opens a page and
focuses its first enabled control; Back from the content returns to the rail
(a source page first returns to Sources), then Home. Entering Devices &
network focuses Pair a device when available.

## Who can change what

Every paired device opens every page. Rows that need an admin stay, saying
"Only an admin can change this.", and Core enforces it. A device's own name,
consent and capture, Quit Couch and the host's first-admin code stay local.
The host's This device says its speakers and screen are shared while Share on
network is on.

This device owns its name, which is also the name of a Couch it hosts; an
admin renames another host from its row in Devices & network. First run and
pairing: [Shell](shell.md#first-run-and-pairing).
