# TV

A TV (`body.tv-presentation`, styled with `tv:`) has Couch's one layout. What
it adds is for a remote with only arrows, OK and Back:

- spatial navigation, with focus on page entry and Back restored;
- its own name in the header instead of the Couch switch, a small clock, and
  no Remote tab or Keyboard shortcuts;
- OK held 500 ms on a row or tile opens its menu; a short OK acts on release
  ([Menus](../design.md#menus));
- no hover (the `hover` variant never applies), shelf scrollbars, Back arrows,
  fullscreen or pointer time readout. Toasts ignore a parked pointer.

Focus inversion is the highlight for controls; a focused tile rings its
picture in white and lights it in its own colour, its meta line coming up to
white. Remote input makes focus visible even after a pointer was used. From the
sofa a thin ring is too faint, so a focused tile also lifts (scale 1.05, easing
over 150 ms unless reduced motion is on), its "…" with it, and its ring
thickens to .25rem. Each shelf takes its own line, so Up and Down always go
shelf to shelf. A shelf's padding and the tile's scroll margin keep the
lifted tile clear of the clip and the screen's edge.

## Pairing

An unpaired TV shows its code, six digits as large as the screen allows, and
a QR of `https://<LAN address>/pair/tv?code=…` beside it. A phone or computer
paired with this Couch as an admin scans it (or opens `/pair/tv` and types the
code), sees "Pair {TV}?" and the code to check, and chooses Pair or Cancel. The
TV polls every 2 s and pairs by itself; Pair's toast names it ("Living room
paired"). A controller is told only an admin can pair a TV. **Enter a code
instead** keeps the old form for the host's code; Back or **Scan with a phone
instead** returns to the QR.

## See the TV in a browser

`isTvPresentation()` (`src/client/session/presentation.ts`) answers "is this a
TV?": the TV app's window, or a tab that opts in. Scratch and development
builds allow the opt-in; release builds don't.

```sh
COUCH_TV_OVERRIDE=1 bun run build
COUCH_DATA_DIR=/tmp/couch-tv COUCH_PORT=4782 node build/core.mjs
```

Open `http://localhost:4782/?tv=1` and pair (with `bun run dev`,
`http://localhost:1420/?tv=1`, no flag). The tab stays a TV across reloads
until `?tv=0`. Core treats it as a TV, so once it shares its speakers or screen
another device's Remote drives it; tabs on one origin are one device, so open
that Remote in another browser profile.

## Remote navigation

- **Page entry.** After a page change focus goes to the page's first control
  (`data-page-first`); when that renders late (Home's hero or its first
  section, a collection's Play) focus moves to it as it appears, unless a key
  or pointer came first. On Details it is the primary verb.
- **Back** closes an overlay, then leaves a sub-page for its opener with focus
  restored (Radio and Live TV return to Home's heading), then takes any
  section to Home, where it does nothing. Esc and BrowserBack do the same.
- **Arrows.** Left and Right stay on a visual line and stop at its edge. Up and
  Down from a row (`data-nav-row`: a shelf, the hero's or Details' verbs, a
  media row) reach the nearest row first, so shelves and their headings are
  walked one by one. The header and the footer (now-playing bar) come only
  after the page's controls; Up from the first row reaches the current tab, and
  Up again a toast's action. In Saved and Settings, Right from the rail enters
  the content and Left returns to the selected entry.
- **Controls that would trap arrows don't.** Arrows past a radio group's ends,
  Up/Down across a horizontal slider or one-line field, and every arrow on a
  closed select move on. A fader takes Left/Right only after OK, until OK or
  Back (5 per press). Where it plays' rows are the exception: Left/Right move
  their level at once ([Where it plays](where-it-plays.md#on-a-tv)).
- **Text.** The header's search field is a stop like any other; OK opens its
  palette full screen and Back closes it ([Shell](shell.md#search-field)). The
  TV has no keyboard, so a phone's Remote types ([Type on TV](remote.md#type-on-tv)).

## The TV player

A TV receiving Play starts focused on the picture, so the bands hide after
4 s. With them hidden: OK shows them on the first enabled transport slot, Up
and Down on the timeline, Left and Right seek 10 s. Back hides them; with them
hidden it leaves the player for its opener. A paused picture keeps them up.
Stop is OK, Right, OK for pausable media and OK, OK for radio and live. Details
is in the Playback gear's menu. The gear ends the TV's tools: the TV has no
fullscreen, so the band leaves its slot empty, and an empty slot is no stop
for the remote. A Remote's Info key opens
the player from any page.
