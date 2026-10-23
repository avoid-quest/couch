# Settings

## Pages

Two owners (`src/shared/settings-pages.ts`): what changes only the device in
hand, and the Couch everyone shares, its hardware included:

| Page | Owner | Path | Holds |
| --- | --- | --- | --- |
| General | This device | `/settings/device` | name, text size, Keep screen awake, online video quality, Show Share in the header, Connection (which Couch it shows), what it lets other devices use, Quit Couch (app) |
| Home | This device | `/settings/device/home` | Home's sections, one list |
| Updates | This device | `/settings/device/updates` | this app's updates and logs (a desktop app that doesn't run the Couch) |
| Devices & network | Couch | `/settings/couch/devices` | pairing, devices and roles (the Couch's name is its host's row), Share on network, HTTP, network address, live relay |
| Playback | Couch | `/settings/couch/playback` | the watching profile's preferences: Autoplay, Audio language, Subtitles (Off or a language, one row), Speed (the player's speeds, `playbackSpeeds`); Ask every device where a shared source plays |
| Sources | Couch | `/settings/couch/sources` | source pages (Live TV, Radio playlists, StreamingCommunity under Sources), AirPlay (hidden off Linux; one muted line when this build or computer lacks the receiver), Hidden |
| Sound | Couch | `/settings/couch/sound` | output, test and delay, Bluetooth (where Couch controls the system's sound) |
| TV | Couch | `/settings/couch/tv` | TV mode, Start on boot, Screen, text size (where the Couch is or can be a TV) |
| Updates | Couch | `/settings/couch/updates` | the Couch apps an admin updates (where there is an updater) |

Wide screens and the TV open Settings on General. Earlier paths
(`/settings/home`, `/settings/devices`, `/settings/sound`,
`/settings/couch/general|network|bluetooth|display`,
`/settings/device/general|connection|viewing|sharing|discover`, …) redirect
through `settingsAliases`; the old `/settings/updates` opens this app's own
updater on an app connected to another Couch. The player's gear opens the player's
own Playback menu, not this page.

Online video quality offers Best, 1080p, 720p and 480p: Auto plays 1080p, so
it is the 1080p choice. Sharing this device's screen or sound starts from the
header's Share ([Share](share.md)); its picture quality is chosen there each
time, so Settings keeps no default. Show Share in the header is off on a TV
until chosen; while off, its row offers Share screen or sound.

Home lists each of Home's sections ([Home](home.md#sections)) as a Switch
beside its name, with Move up/down at the row's end (no drag), saved per
device; the page names the list, which has no heading of its own, and it ends
in an outline Reset to default. `/settings/device/discover` opens it. A Move
that reaches an end returns focus to the row's Switch.

## Rows

`SettingsRow` sets a label beside its control once the column has room. A
one-line label centres on the control's line, and every control starts on the
column's edge: an input, Select or Switch at it, a ghost button's text pulled
back to it, and a choice's label on it with its check hung in the gutter. When
the row stacks, a choice's check sits on the label's edge instead.

## Devices

Each device leads with a glyph where its kind is known: a TV (Core says so, or
this browser saw it as one), the computer or TV that runs the Couch, this
device (phone or computer by its pointer); any other is a phone-or-computer
glyph. An offline device is muted and says when it was seen, relatively ("Seen
10 min ago", "Seen yesterday", "Seen Tuesday", "Seen Oct 3"). An offline device
that shares its name with one online or seen since is an older duplicate (the
same screen paired again): it says so and offers only Forget, and with two or
more a last row offers Forget all. Forget asks first in an AlertDialog.

## Section nav

The rail has one group per owner, each a heading over a muted line: **This
device** over this device's name, then the Couch's own name over a dot and
Connected, Reconnecting or Offline, with "admin" when this device is one. The
current entry is white ink on a `secondary` capsule; a pointer only brings
another entry's ink up. A page this device can't change at all (Sound, TV and the Couch's Updates for a non-admin) ends in a
small lock, and still opens and shows its values. On the host the two groups
are one, headed by the Couch's name over "This computer runs it" (or "This TV
runs it").

The selected entry names the page, so pages keep an `sr-only` h1 from `md` up.
Below `md`, `/settings` is the rail as divided rows, and each page leads with
its owner as a breadcrumb ("This device" or "{Couch}") above a visible title;
Back goes up to the list. A source's own page shows "Sources" above its title
at every width. Rows stack label and control until their column has
room for both.

On wide screens the rail stays in view below the header while a long page
scrolls.

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
