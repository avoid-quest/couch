# Shell

## Sections

| Section | Path | Holds |
| --- | --- | --- |
| Home | `/` | one hero, then shelves ([Home](home.md)) |
| Discover | `/discover` | shared sources, Radio, Live TV, each source's saved channels and series, Sources ([Browse](browse.md#discover)) |
| Saved | `/saved` | For later, Channels & stations, Lists, Played (`?tab=`) |
| Remote | `/remote` | drives a TV; on other devices while the Couch has one |
| Settings | `/settings` | [Settings](settings.md) |

Search is the header's field; its results are `/search?q=…`, and `/search`
without a query opens Discover. Discover's own pages are `/discover/radio` and
`/discover/live-tv`. `/item` and `/collection` keep the section that opened
them in `from` (`home`, `discover`, `search`, `saved`; Discover by default),
so the tab, the breadcrumb and a refresh keep it. `/now` is the player. Where
it plays has no page.

Earlier addresses redirect with their query: `/live` → `/discover`,
`/library` → `/saved`, `/find` → `/search` (its `browse=radio|live-tv` →
Discover's pages), `/where-it-plays` → `/`, and old Settings paths through
`settingsAliases`. Core serves every path in `src/shared/page-paths.ts`.

Tab pages (Home, Discover, Saved, Settings, Remote) have no visible title: the
current tab names them, and an `sr-only` h1 remains. Sub-pages carry one back
link above their h1 ([Browse](browse.md#back-links)).

## Header

One sticky row: the Couch switch (or, on a TV, its own name) and the section
tabs at the left; search, the sharing control and, on desktop, Keyboard
shortcuts at the right; the TV adds a small clock. The current tab is
underlined. The header publishes its height as `--top-bar` so scroll padding
keeps focus clear of it. Below `lg` a TV centres its tabs on a second row.

Its geometry holds from page to page: the search field fills the right column
(up to 22rem with Keyboard shortcuts), tokens or not, and on Remote, whose keys
drive the TV, Keyboard shortcuts keeps its slot unseen. Remote shows while the
Couch has a TV, on or off.

**Offline**, the mark is hollow, and the right cluster says "Reconnecting…"
with a Spinner before the search, as sharing does (the Spinner alone on a
phone); the shell's `sr-only` status and the Couch switch's name carry it for
screen readers. Nothing pushes the page down. Only the app pointed at another
Couch keeps a line under the header, for its Try again and Use this computer.
An updated Couch and a player error keep their line too.

**Touch** (`touch:`): the tabs move to a bottom tab bar (Home, Discover, Saved,
Remote while the Couch has a TV, Settings; lucide icons over labels), and the
top bar is the Couch switch then the search field. A narrow TV undoes
`touch:` with `tv:`. **The Mac window** puts its buttons and drag region in the
header (`[data-window-controls]`). Unpaired there is no header (see First run
and pairing).

**Sharing.** While this device shares its screen or sound, the header shows
"Sharing screen" (or sound, or microphone) with Stop sharing; it shrinks to
one icon (lucide Radio) that opens a Popover on phones. It stays local to the
publishing device: another device's Remote can't use it.

## Search field

`HeaderSearch`: a shadcn `InputGroup` with a Search button, filling the
header's right column, and a shadcn `Command` (cmdk) palette under it. `/`
focuses it from any page; a fine pointer sees a `/` hint. Focused, it inverts;
while the palette is open the field keeps a white edge instead and the
palette's selected row is the one white thing (focus stays in the field; the
row is its `aria-activedescendant`).

**Where it opens.** On a desktop the palette is the field's own list: 4px
under it, at its left edge and width, on the menus' ground (`bg-popover`,
rounded, no border or shadow), so the eye stays where the typing is. On a phone
it fills the screen under the header, the field takes the whole row and Cancel
closes it.
On the TV it fills the screen too: OK on the field opens it (arrows pass a
closed field, which is a plain field to the remote), a phone's Remote types
into it ([Type on TV](remote.md#type-on-tv)), and the typed query reads large
in its first row.

**Empty**, it lists Search in (the kinds, as a wrapping line of chips that
Left and Right move along), Recent searches (the last six of eight,
`search-recents.ts`) and Continue (recently played, with artwork). The sources
aren't listed, since Discover has them; typing a source's name offers it. On
the TV they are columns the arrows cross (Up/Down within, Left/Right between).
Nothing is selected until an arrow, so Enter still submits.

**Typing** selects the query row, a verb rather than a second field: "Search
“jazz”", or "Search “jazz” in Music" when scoped. Then it suggests only what
the client already holds, once typing pauses (`useDebouncedValue`, 120 ms):
the scopes the text names, matching recent searches, then up to three each of
Saved, Played and Stations, each with its artwork over where it comes from,
read from the react-query caches (for later, saved channels and series,
history, favourite and recent stations, the avoid radio list). It never asks a
source or Core; the full search runs on the results page. A scope narrows the
suggestions (stations only for radio, a source only its own titles).

**Tokens.** A kind and a source become tokens in the field: choose one in the
palette (choosing it again removes it), or type its name or short form (`film`,
`live`, `yt`, `bc`) and press Tab; Backspace in an empty field removes the
last; a press on a token removes it. Choices never combine into something
impossible (`chooseScope`: a kind keeps a source only if that source can return
it). On the results page the tokens are the URL's kind and source, both ways
([Browse](browse.md#search)); elsewhere they wait for the next query. A source
without a home (YouTube, Bandcamp, SoundCloud) scopes the field to itself
(`scopeSearch`) and opens it.

**Enter** does the selected row: the query opens `/search?q=…` with its scope
(the first search pushes, later ones replace); a recent search runs again; a
saved or played title opens its Details; a station plays; a pasted link's
first row plays it ("Open page" and "Choose how to play" follow), then the
field empties and lets go. Until the page's title resolves, a played link is
named by its address ("youtube.com/watch?v=…"). Every submission closes the
palette, and a page that changes under it (a played link opening the player)
closes it too. A Spinner replaces the Search icon while sources answer.

- On results, Enter on the unchanged query plays the closest match when its
  press plays, else focuses it. Keys typed outside a control on the results
  page continue the query.
- Off the TV, Esc in the open palette clears the field, then closes the
  palette and leaves it; after a search, with the palette closed, it just
  leaves the field. On the TV, Back closes the palette, then stays Back.

## Couch switch

The Couch's name, muted, opening a Popover from the left: saved servers, This
computer in the app, another address and, on a host with sharing on, Pair a
device. It reuses Settings → This device's choice. After a switch:
[Where it plays](where-it-plays.md#switching-servers).

## Now-playing bar

`NowPlayingBar`, one row above the page (and the phone tab bar), is the
player's band made small: it shares the band's grid, controls and sizes, so
nothing changes side as it grows into the band
([Player](player.md#the-band-and-the-now-playing-bar)).

- **At the left, what plays,** as compact as a mini-player's (YouTube Music,
  Spotify and Apple Music run about 56–64px): a 2.5rem artwork, with the
  [level](../design.md#motion) at its bottom-left corner, and two tight lines, so the bar is as tall as its 44px controls plus its padding: 61px on
  phones, 64px at 1440 wide. The title is the control across its whole line,
  with the artwork a pointer target for it. Under the title, one line that
  doesn't wrap: "on {device}" in the ink when it plays elsewhere, then its
  collection or station link (a station's only under its show, since without
  one the title is the station), then a status only when it isn't plain
  playing or paused. A station shows its show's title and photo while it has
  a show, else its name and logo, as its tile and the player do. Those links sit outside the title's button and drop their row
  height here, keeping a 24px hit area that doesn't push the line apart. The
  player says where it plays the same way (`PlaysOn`).
- **In the middle, Play/Pause, Stop and Next,** at the same x as the band's.
- **At the right, Volume, Where it plays, Up next and the Playback gear,**
  the band's own tools at the band's x, then **Open player** (ChevronUp, a
  mini-player's expand arrow) in the slot where the band has fullscreen. The
  gear opens the player's Playback menu above the bar, for whatever plays.
  Their panels open as the band's do: above the bar, ending at the gutter
  ([Player](player.md#the-picture)). Up next is disabled, "Nothing queued",
  while it has nothing to show.
- Every control is the band's ghost icon at `--player-target` (44px, 54px at
  1920 wide) with the same 1.25rem glyph.
- Its timeline is a slim line along its top edge that thickens under a
  pointer, none for live media.
- Phones (below `sm`, the band's own phone breakpoint) keep Play/Pause and
  Open player, at fullscreen's x: a minimized player needs no mixer, and the
  player has it.

Opening the player is a view transition: the bar grows into the band
(`couch-player-band`), and each shared control glides to its place in the band
under its own name rather than cross-fading, and Open player glides into
fullscreen's slot. On wide screens they are already in place; on phones
Play/Pause glides to the band's left. The thumbnail travels into the player's
artwork or picture (`couch-art`); the title and its line fade out at once
rather than stretch over the band's timeline, and fade back in once the band
has shrunk into the bar.

It hides on the player, on Remote, and while Home's playing hero is on screen
(`html[data-hero-playing]`). With the phone tab bar it forms the footer, whose
height is `--bottom-bar`. The footer is fixed, and the shell keeps that height
free below the page. It isn't sticky: Chromium centres a focused control that
sits inside the page's scroll padding, which the footer itself fills, so focus
on a sticky footer's control (from Tab, or focus moved by script) scrolled
the page beneath by hundreds of pixels. The page stays still as the bar opens
a panel and as Stop takes the bar away.

## A picture you start opens the player

When Play, Resume or Play on, from any device, starts something with a picture
on this device, it opens its player, so video never plays unseen. Up next
moving on, and audio-only media, keep the page. The first sync after a reload
keeps the requested page.

## Keyboard

TanStack Hotkeys, inside the app only; the header's Keyboard shortcuts dialog
lists them: K/Space play or pause, J/L seek 10 s, 0–9 jump, M mute, C
subtitles, F fullscreen, Shift+N play next, H/S Home and Saved, `/` Search,
`,` Settings, P/Q player and Up next, Esc close or back, `?` the list. Space and
the player's arrows act only when focus isn't on a control (or is on a
`tabindex="-1"` target such as the player's picture). Open panels, text
fields and TV navigation own their keys; fields keep native editing keys.

Desktop history is the browser's: the app's History menu, Cmd+[ / Cmd+] (macOS)
or Alt+Left / Alt+Right, mouse back and forward, and horizontal swipes. The Mac
preload turns a completed two-finger horizontal scroll (≥100px, more than twice
the vertical) into one history step, as
[t3code](https://github.com/pingdotgg/t3code/blob/main/apps/desktop/src/window/DesktopWindow.ts)
does; forms, sliders, media and horizontal scrollers keep their gestures. A
Couch or mode switch clears history once the destination loads.

Checks: `tests/desktop-interactions.browser.ts` (build with
`bun build --target browser --format iife`, run
`window.runDesktopInteractionsRegression()` in a paired scratch desktop),
`tests/desktop-navigation.test.ts` and `tests/preload-history.test.ts`.

## First run and pairing

The app asks "Where is your Couch?" (This computer hosts it; Another Couch
joins one), then the computer's name, with a random default, and whether to
share it on the network. Pairing reuses that name. Unpaired, every device sees
only the pairing page, with no header: centred in the window, its mark and
"Pair with Couch" the only brand, and in the Mac app the whole window drags by
it. The app, or a browser that has known another Couch, gets one line under the
description, the address then Change, which opens the Couch switch; a TV picks
its Couch in Settings once paired. A TV shows a code and a QR instead, which an
admin's phone approves ([TV](tv.md#pairing)). The pairing dialog warns about Couch's self-signed
certificate and closes when a device pairs, with a toast naming it ("Phone
paired · admin").
