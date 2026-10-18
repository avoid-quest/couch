# Redesign brief

Couch is moving to a classic ten-foot media-centre structure while keeping
Clock's look (black ground, white ink, hairlines, focus by inversion, no
cards). This brief is the target for the `t3/redesign/*` stack. It is
temporary: each layer moves its decisions into the surface docs under
[`design/`](design.md#surfaces) as it lands, so those docs keep describing the
code, and deletes its section here. The last layer deletes this file.

Read [`design.md`](design.md) first; this brief changes structure, not tokens,
type or copy rules.

## Direction

- **Top shelf.** Home opens on one large item, then shelves of tiles, the way
  Apple TV and Infuse do. Every screen uses the same sections and the same
  component tree; the TV, the desktop window and phones differ in layout,
  not in which components they render.
- **A departures board.** Couch's organising idea stays time. The hero is the
  board's top line: its end time ("ends 21:42", "until 23:10") is the largest
  text after the title, in tabular figures. Spend boldness here and keep
  everything around it quiet.
- **Artwork as it comes.** Providers give thumbnails, not backdrops. Artwork is
  always contained at its own aspect ratio (2:3, 1:1, 16:9) on black. Never
  blur, stretch or crop it into a background.
- **Fewer exceptions.** A rule that needs an exception for one surface is a
  sign the structure is wrong. Prefer changing the structure.

## Browse

- **Live:** an "On air" shelf of saved and built-in stations, each with its
  show and "until" time, then every station (today's Radio browse). Then
  channels (today's Live TV browse), only when a Live TV source exists. No
  programme grid: that waits for a source that needs one.
- **Library:** For later, Saved, playlists and Played: today's Saved
  sections plus Played, with the rail on wide screens and the Select on
  phones.

## Player

- **Over a video:** with controls up, the title and subtitle sit at the top
  left and the clock and end time at the top right, over the existing scrim.
  The band keeps its order and auto-hide.
- **Audio:** Now playing keeps contained artwork beside Up next.
- **TV:** Info still opens the player. Everything in "The TV player answers a
  remote" holds.

## Where it plays

People must never wonder whether a word names a device, a group or a place.

- **Only devices have names.** A Playback has no name: Couch shows it by its
  artwork and title, and text refers to it by its title ("Playing avoid
  radio"). Couch never asks anyone to name or group anything. Never show the
  words zone, group, room, speaker or Playback.
- **One device, one row.** A device is listed once, under the Playback it
  serves, since Core lets a device serve one Playback at a time.
- **This device keeps its name.** Its status line starts with "This device".
- **The host is just a device.** The Couch and its host share one name. The
  Couch's name appears only where you choose which Couch to use (the Couch
  switch and Couch connection), never in Where it plays.
- **Hardware is not a device.** An HDMI display, a sound card or a Bluetooth
  speaker is part of its device. It is chosen in Settings → The Couch →
  Hardware and never listed beside devices.
- **One level for the whole Playback.** The band's Volume and the picker's top
  fader are one control. Each device's fader sits below it. No hidden level
  may silence sound: if a stored trim below 100 survives, fold it into the
  device levels or show it.
- **Show what you can't change.** Private and offline devices stay listed and
  dimmed, with disabled controls and a one-word status ("Private",
  "Offline"). No explanatory paragraphs: at most one hint line per surface.

**Picker** (the band's and the now-playing bar's Where it plays button, a
bottom Sheet):

```
[art] avoid radio            Playing
Volume  ───────────●──  72
─────────────────────────────────────
✓ Living room                ──●──  40
✓ Francesco's phone          ────●  60      This device
  Kitchen laptop             Playing Montalbano
  Anna's tablet              Offline
─────────────────────────────────────
Every device
```

- Pressing a row adds or removes that device, picture and sound together as
  its consent allows. Moving a busy device away from another Playback says so
  in its row first, as today.
- A row's "…" menu holds Picture, Mute and Only here.
- "Every device" opens the overview.

**Overview** (`/where-it-plays`): each Playback that plays somewhere, shown as
its artwork, title, status and end time, with its device rows below it. Then
"Not playing": free devices, each able to join the Playback you control.
Offline devices come last. Rows here also hold "Sync … ms earlier" while a
device plays in sync with others, and link to Settings → This device →
Sharing for consent.

## Deferred

- A Live TV programme grid, and any Core endpoint it would need.
- `apps/web`, the couch.avoid.quest site.
- Settings restructuring beyond fitting the new shell: #761 just settled its
  two owners.

## Layers

Each layer is one PR on the layer below. The title is the PR title and becomes
release notes ([ci.md](ci.md)).

| Branch | Title | Scope | Updates |
| --- | --- | --- | --- |
| `spec` | Describe Couch's redesigned interface | this brief; design docs split by surface | `design.md`, `design/`, `AGENTS.md` |
| `foundation` | Prepare the interface for its redesign | one presentation module; a TV presentation override for scratch and browser checks, unreachable in release builds; no visual change (landed) | `design/tv.md` |
| `shell` | Navigate Couch with tabs and a now-playing bar | Shell; new section paths with redirects; existing pages render inside them (landed) | `design/shell.md` |
| `home` | Open Home on what you'll most likely play next | Home (landed) | `design/home.md` |
| `browse` | Search everything and open each source from its own home | Search, source homes, details (landed) | `design/browse.md` |
| `live-library` | Find radio and channels in Live, and what you keep in Library | Live, Library | `design/browse.md` |
| `player` | Show the time and title over the playing picture | Player | `design/player.md` |
| `where-it-plays` | Choose where it plays from a simple list of devices | rules model and tests; picker | `design/where-it-plays.md` |
| `devices` | See every device and what it plays on one page | overview | `design/where-it-plays.md` |
| `remote` | Drive the TV from a classic remote on your phone | Remote; Settings fitted to the shell; delete this brief | `design/remote.md`, `design/settings.md` |

## Every layer

- **One tree.** Render one component tree per surface. Express TV and touch
  differences with the `tv:` and `touch:` variants. Keep a
  `tvPresentation` branch only where behaviour differs, such as focus stops
  or keys, and convert the branches in the files the layer rewrites.
- **shadcn first.** Reuse `src/client/components/ui`, and check the
  [catalog](https://ui.shadcn.com/docs/components) before building anything
  custom. Record the gap that justifies any custom component in its
  surface doc.
- **Keep the hooks.** The browser checks (`tests/tv-navigation.browser.ts`,
  `tests/tv-continue.browser.ts`) find elements through `data-*` attributes,
  `aria-label`s and paths. A layer that moves one updates those checks in the
  same layer.
- **Green before done.** These must pass on the layer's branch:
  - `bun run typecheck`;
  - `bun run build`;
  - `bun test` on every `tests/*.test.ts(x)`;
  - the `tests/*.integration.ts` files covering the layer's surface, run as
    [ci.md](ci.md) describes.
- **Seen on three screens.** Run a scratch Couch with its own
  `COUCH_DATA_DIR` and `COUCH_PORT`, and stop it by PID afterwards. Take
  before and after screenshots of the layer's surface at 1920×1080 in TV
  presentation ([in a browser](design/tv.md#see-the-tv-in-a-browser)),
  1440×900 on desktop and 390×844 on a phone.
- **Docs follow code.** Move the layer's decisions from this brief into its
  surface doc, and delete them here.
