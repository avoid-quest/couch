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
so the tab, the back link and a refresh keep it. `/now` is the player. Where
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

**Touch** (`touch:`): the tabs move to a bottom tab bar (Home, Discover, Saved,
Remote while the Couch has a TV, Settings; lucide icons over labels), and the
top bar is the Couch switch then the search field. A narrow TV undoes
`touch:` with `tv:`. **The Mac window** puts its buttons and drag region in the
header (`[data-window-controls]`).

**Sharing.** While this device shares its screen or sound, the header shows
"Sharing screen" (or sound, or microphone) with Stop sharing; it shrinks to
one icon (lucide Radio) that opens a Popover on phones. It stays local to the
publishing device: another device's Remote can't use it.

## Search field

`HeaderSearch`: a shadcn `InputGroup` with a Search button, up to 16rem,
inverting on focus. `/` focuses it from any page; a fine pointer sees a `/`
hint. Typing stays local until Enter or Search submits; the first search opens
`/search?q=…`, later ones replace it. A Spinner replaces the Search icon while
sources answer.

- Empty and focused, it lists the last eight queries (`search-recents.ts`) as
  rows a remote can reach with Down.
- A source without a home (YouTube, Bandcamp, SoundCloud) scopes it to itself
  (`scopeSearch`): "Search YouTube", and the next query carries that source.
- On results, Enter plays the closest match when its press plays, else
  focuses it; Down reaches the first result. Keys typed outside a control on
  the results page continue the query.
- Off the TV, Esc clears it, then leaves it. On the TV a phone's Remote types
  into it ([Type on TV](remote.md#type-on-tv)).

## Couch switch

The Couch's name, muted, opening a Popover from the left: saved servers, This
computer in the app, another address and, on a host with sharing on, Pair a
device. It reuses Settings → This device's choice. After a switch:
[Where it plays](where-it-plays.md#switching-servers).

## Now-playing bar

`NowPlayingBar`, one row above the page (and the phone tab bar), shares the
player band's grid so nothing changes side as it grows into the band
([Player](player.md#the-band)): what plays at the left (artwork and title open
the player; below them its collection or station link, a status only when it
isn't plain playing or paused, and "on {device}" when it plays elsewhere),
Play/Pause, Stop and Next centred, and Volume, Where it plays and Up next at
the right. Its timeline is a slim line along its top edge, none for live media.
Phones keep Play/Pause and Where it plays.

It hides on the player, on Remote, and while Home's playing hero is on screen
(`html[data-hero-playing]`). With the phone tab bar it forms the footer, whose
height is `--bottom-bar`.

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
share it on the network. Pairing reuses that name. Unpaired browsers see only
the pairing page. The pairing dialog warns about Couch's self-signed
certificate and closes when a device pairs, with a toast naming it ("Phone
paired · admin").
