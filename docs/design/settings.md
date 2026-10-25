# Settings

Playback settings show only actions Core and the current adapter support.
Live audio has no programme speed, content delay or queue settings. Audio delay
is available only for Direct separate-audio playback; output synchronization
correction remains distinct. Share's input choice is **Audio input**, with
**Live audio** additionally available on the Couch computer.

## Pages

Two owners (`src/shared/settings-pages.ts`): what changes only the device in
hand, and the Couch everyone shares, its hardware included:

| Page | Owner | Path | Holds |
| --- | --- | --- | --- |
| General | This device | `/settings/device` | name, text size, Keep screen awake, online video quality, Show Share in the header, advanced Live audio output buffering, Connection (which Couch it shows), what it lets other devices use, Quit Couch (app) |
| Home | This device | `/settings/device/home` | Home's sections, one list |
| Updates | This device | `/settings/device/updates` | this app's updates and logs, only for a non-admin in the desktop app |
| Devices & network | Couch | `/settings/couch/devices` | pairing, devices and roles (the Couch's name is its host's row), Share on network, HTTP, network address, live relay |
| Playback | Couch | `/settings/couch/playback` | the watching profile's preferences: Autoplay, Audio language, Subtitles (Off or a language, one row), Speed (the player's speeds, `playbackSpeeds`); Ask every device where a shared source plays; advanced Live audio scheduling lead |
| Sources | Couch | `/settings/couch/sources` | source pages (Live TV, Radio playlists, StreamingCommunity under Sources), AirPlay (hidden off Linux; one muted line when this build or computer lacks the receiver), Hidden |
| Sound | Couch | `/settings/couch/sound` | output, test and delay, Bluetooth (where Couch controls the system's sound) |
| TV | Couch | `/settings/couch/tv` | TV mode, Start on boot, Screen, text size (where the Couch is or can be a TV) |
| Updates | Couch | `/settings/couch/updates` | all apps this admin can update, including this app; replaces the device entry |

Wide screens and the TV open Settings on General. Earlier paths
(`/settings/home`, `/settings/devices`, `/settings/sound`,
`/settings/couch/general|network|bluetooth|display`,
`/settings/device/general|connection|viewing|sharing|discover`, …) redirect
through `settingsAliases`; `/settings/updates` opens the viewer's single Updates
page. Old Updates addresses and role changes redirect to the applicable page.
The player's gear opens the player's
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

## Updates

There is one Updates entry: admins see every app they can update, including their
own; other desktop users see only their app. A browser without admin has none.
The header's **Update ready** link opens this page, without a separate dialog.

Flat settings rows lead with device names, installed and offered versions, and
**Up to date**, **Update ready**, download progress or a failure. A single ready
device gets **Update {name}** with no selection step. Several ready devices start
selected and use **Update N devices**; current devices have no inert checkboxes.
Media tools occupy one row with versions and status, including system-managed
copies and an operator's yt-dlp hold. **Check for updates** checks every app and
maintains the media tools; there is no separate tools action.

**What’s new** appears when an app has an update. It loads on demand and shows the
selected device's changes through its offered version, however many releases it
skipped. It previews the newest five changes
from at most three releases, each cut to 140 characters; **Read all N changes**,
beside "Changes since", shows every change in that range in full and **Show fewer
changes** returns to the preview, both without moving the focus. Older releases
expand separately. Stable and Preview have separate histories; each release keeps
its version, date and a link to GitHub. Missing notes never block an update.

The summary, the playback confirmation and the Update and Check buttons stay at
the bottom of the screen while long notes scroll beneath them: above the footer in
Settings. A remote's Down reaches them after the notes and rows, and focus in the
notes stops above them.

Updating checks the server's media tools, updates connected apps, then the server,
then this app. This device appears only once. A browser has no app installer of its
own. An older server without tool maintenance says so while still allowing its
app to update.

Progress survives a reload or restart. A device is Updated only after its running
version is confirmed; a failure stops the remaining restarts. The main Update
button retries the apps still ready; Check retries failed tool maintenance.
Success clears its saved batch automatically and shows one six-second toast:
**Updated {name}**, **Updated N devices**, or **Media tools updated**. A manual check
with nothing new says **Everything is up to date**. Legacy successful results are
retired quietly on startup. Failures remain on their rows until checked or retried.
If an older server cannot check media tools, the success toast says they weren’t
checked. Losing admin stops the remaining restarts instead of leaving progress
spinning indefinitely.
Restart intent expires after 30 minutes, so an old page cannot restart devices
hours later. When playback or sharing would stop,
the action confirms inline as **Stop playback and update**; tools-only maintenance
does not ask to stop playback. Each app has its own channel row below the device
status, with no device picker. TV automatic-update results stay with the device,
and local logs remain available.

## Rows

`SettingsRow` sets a label beside its control once the column has room. A
one-line label centres on the control's line, and every control starts on the
column's edge: an input, Select or Switch at it, a ghost button's text pulled
back to it, and a choice's label on it with its check hung in the gutter. When
the row stacks, a choice's check sits on the label's edge instead.

Section headings use the same Mona Sans as the rest of Couch. A status or an
admin restriction belongs to its row, rather than a heading with no controls.
Screen and text-size previews put Keep/Revert in a row with a politely announced
countdown; Default is already one of the text-size choices. Relay checks and saves give
temporary toasts; connection state stays beside the relay's switch.
Sound tests, AirPlay and relay state changes keep polite announcements in their
row descriptions. An unavailable test explains why before any older result.
Test and Stop reuse the output's button so focus stays through a sound test;
tests started elsewhere leave the viewer's focus alone.

Each item keeps its main verb visible (Switch, Connect, Refresh). Secondary
verbs share the same **…** menu as media rows: role changes, Edit, Forget and
Remove. A sole action stays visible. Confirmations open after the menu closes,
and Cancel returns to its opener. Source forms and their portalled menus and
confirmations stay local to the device using them.

Sources opens each subpage from its whole row, with a chevron. Live TV Edit
focuses and scrolls to the Name field in the form. Bluetooth uses one section;
addresses appear only to distinguish devices with the same name.

## Devices

Each device leads with a glyph where its kind is known: a TV (Core says so, or
this browser saw it as one), the computer or TV that runs the Couch, this
device (phone or computer by its pointer); any other is a phone-or-computer
glyph. An offline device is muted and says when it was seen, relatively ("Seen
10 min ago", "Seen yesterday", "Seen Tuesday", "Seen Oct 3"). An offline device
that shares its name with one online or seen since is an older duplicate (the
same screen paired again): it says so and offers only Forget, and with two or
more a last row offers Forget all. Forget asks first in an AlertDialog.
Other devices keep Make/Remove admin and Forget in their **…** menu.

Pair a device reuses first run's QR and grouped six-digit code. The main address
and its connection guidance sit beside it, or below it on a phone. Other
addresses expand only when needed. Close and Back return to Pair a device;
a newly paired device closes it automatically and shows a toast.

## Section nav

The rail has one group per owner, each a heading over a muted line: **This
device** over this device's name, then the Couch's own name over a dot and
Connected, Reconnecting or Offline, with "admin" when this device is one. The
current entry is white ink on a `secondary` capsule; a pointer only brings
another entry's ink up. A page this device can't change at all (Sound and TV) ends in a
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

Every paired device opens the shared settings pages; Updates is the exception,
showing only apps this viewer can update. Rows that need an admin stay, saying
"Only an admin can change this.", and Core enforces it. A device's own name,
consent and capture, Quit Couch and the host's first-admin code stay local.
The host's General says its speakers and screen are shared while Share on
network is on.

This device owns its name, which is also the name of a Couch it hosts; an
admin renames another host from its row in Devices & network. First run and
pairing: [Shell](shell.md#first-run-and-pairing).

## Advanced audio

Couch → Playback offers an administrator-only **Live audio scheduling lead**
Select: 45, 50, 55, 75, 95 (unchanged default), 150 and 250 ms. Core persists it and
snapshots it for each newly published Live source. Capture deadlines, receiver
admission and positive sync-correction validation share that source's budget;
25 ms remains reserved for capture/encoding/transport at 75 ms and above. The
explicit 45/50/55 ms presets reserve 8 ms, leaving 37/42/47 ms for the receiver,
as in the native-capture comparisons; slower capture needs a longer preset.
A lower lead can miss deadlines and is not a physical-latency guarantee. Saving does not retime
an active source. Relaxed sharing retains its one-second capture lead.

This device → General offers **Live browser output buffering**: Automatic
(browser default), 128, 256, 512 and 1024 frames, with equivalent milliseconds
at 48 kHz. This requests `AudioContext.latencyHint`, not an exact hardware buffer.
The browser may choose differently. It is saved in this browser's local storage
for this Couch origin and read when the next Live player is created. Leave and
rejoin to apply; saving never rebuilds an active player. Larger preferences can
need more host scheduling lead. Storage failures are visible and invalid saved
values fall back to Automatic. Neither dropdown reports electrical latency.

Linux desktop builds containing the native playback helper also show **Live audio
output**: Browser (default) or Native · system output. Native applies only to
audio-only Live sessions; video and relaxed playback retain the browser path.
Its **Native output buffering** Select requests 20 (default), 30, 40, 60 or 100 ms
from Pulse. It is a stream request, not a hardware buffer setting. The output
uses stereo PCM16 at 48 kHz with bounded automatic clock correction; hardware
volumes, rate, routing and daemon settings stay under the system's control.
These preferences apply on leaving and rejoining. Unsupported/failed native
preparation is reported, never silently replaced by a second browser receiver.
Native playback reuses this origin's paired Device identity and current receiver
token. Changing sync correction during playback, a stream reset, lost timing or
an output failure requires leaving and rejoining. No physical qualification is
implied by the dropdown or its buffering value.

On the host desktop, This device → General also offers **Live audio capture
sample rate**: Automatic, 44.1 kHz and 48 kHz. For browser inputs, Automatic keeps
the existing ideal 48 kHz request.
Explicit choices require that delivered rate and check the first timestamped
capture frame before publication. A browser that ignores the constraint fails
visibly; an older desktop helper that cannot verify it also fails. The share
panel reports the observed capture rate, channels and first block size. These
are delivered-frame facts, not proof of the hardware clock or allocation.
The preference is local to this browser/host and applies on the next Live share.
Ordinary Audio input sharing, screens, music and video playback are unaffected.
Couch still normalizes scheduled capture/network audio to 48 kHz.

When the native Mac helper is available, Live audio also lists inputs marked
**Native**. For these inputs, an explicit sample rate requests a real CoreAudio
device rate and verifies its readback; Automatic keeps the current rate. A rate
change can affect other apps using that device. **Native input buffer** appears
only when native inputs are available: 128, 256 (default), 512 and 1024 frames.
It applies on the next share. The sharing panel reports requested and observed
native buffer sizes separately; it does not call the request an effective size.
The backend and rate setter still require hardware qualification.

The MediaStream/Web Audio path does not expose a writable sound-card buffer.
Capture `latency` and output `latencyHint` remain browser preferences, not hardware
frame counts. Ordinary Audio input sharing does not use the native helper.
See the [capture constraints specification](https://www.w3.org/TR/mediacapture-streams/#constrainable-properties)
and [Web Audio latency options](https://www.w3.org/TR/webaudio-1.1/#dom-audiocontextoptions-latencyhint).
