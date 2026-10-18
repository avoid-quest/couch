# TV

## The TV is driven by a remote

A TV (`body.tv-presentation`, styled with the `tv:` variant) has Couch's one
layout, the layout every screen takes ([Design](../design.md)): one focus stop
per row and tile, a quiet header, and controls revealed over the picture.
What the TV adds is for its remote, which has only arrows, OK and Back:

- spatial navigation, focus on page entry and Back, below;
- its own name alone in the header instead of the Couch switch,
  and no Remote tab or Keyboard shortcuts ([Shell](shell.md#header-and-section-nav));
- OK held on a media row or tile, which opens its one menu, as on Apple TV
  and Android TV; a short OK acts on release ([Menus](../design.md#menus)). A
  row's "…" is a stop Right reaches; a tile's is none, and shows in the
  focused tile's caption;
- no shelf scrollbars, Back buttons, fullscreen or the timeline's time under
  the pointer, which only a pointer or a window uses.

Home's hero and shelves: [Home](home.md). Discover, Search and Details: [Browse](browse.md).

Focus is
the only highlight; no hover style applies on the TV. The TV has no hover: under `.tv-presentation` the `hover` variant
never applies, so a stray pointer can't compete with focus. Focus inverts at once and fades only as it leaves, so a
held arrow moves it at every repeat and leaves a short trail ([Motion](../design.md#motion)).

Back closes an open
overlay, then leaves a detail page for the page
that opened it with its focus restored (Discover's Radio and Live TV pages
are left for Discover, on the heading that opened them), then takes any
section to Home, where
Back does nothing. Opening
Up next changes the player URL without losing its opener. Settings' own OK
and Back: [Settings](settings.md#section-nav).

After every page change, focus is on the page's first control. When that control renders
after later ones (Home's hero waits for its data, Discover's first Radio tile for the shows, a collection's Play for its source), focus moves
to it as it appears, unless a key or pointer came first. Saved starts on its rail's current section, and OK on
another section opens it and keeps the rail; Right reaches its rows. On Details the first control is the
primary verb, so OK plays, and Right walks the other verbs one stop each. The header's left holds the TV's name
as plain text; its Couch choice lives in Settings → Couch connection ([Shell](shell.md#header-and-section-nav)).
Volume and every fader move 5 per press. The header's search field is a stop
like any header control, on every page; the TV has no keyboard, so a phone's
Remote is its text entry ([Type on TV](remote.md#type-on-tv)). Typing there
keeps focus in the field, and Enter on TV goes on to the first result.

## See the TV in a browser

`isTvPresentation()` (`src/client/session/presentation.ts`) is the one answer
to "is this a TV?": the TV app's window, or a browser tab that opts in. Scratch
and development builds let a tab opt in, so browser checks and screenshots see
the TV. Release builds leave the override out.

```sh
COUCH_TV_OVERRIDE=1 bun run build
COUCH_DATA_DIR=/tmp/couch-tv COUCH_PORT=4782 node build/core.mjs
```

Open `http://localhost:4782/?tv=1` and pair. The tab stays a TV across reloads
until it closes or loads `?tv=0`; where the browser blocks session storage, only
a page loaded with `?tv=1` is a TV. The development server (`bun run dev`) needs
no flag: open `http://localhost:1420/?tv=1`. Core treats the tab as a TV, as it
treats the app's window: once the tab shares its speakers or screen, another
device's Remote drives it and types into it. Tabs on one origin are one device,
so open that Remote in another browser profile.

## Every journey step works with a remote

The TV has only arrows, Enter and
Back, so no control may keep them all: the arrows past a radio group's first
or last radio move on, and on the TV so do Up/Down across a horizontal slider,
Up/Down in a one-line field and every arrow on a closed select or menu button
(OK opens it).

A TV fader (Where it plays' faders, and every Volume, which
has the player's tools beside it) moves on with every arrow until
OK hands it the keys along it; OK, Back or leaving it ends that, as TV
equalisers do, and Where it plays' hint says so on the TV. Playback position
keeps Left/Right for seeking, and a seek's brief stall keeps the transport
enabled so focus stays where it was.

Spatial navigation places a
slider by its whole track, not its moving thumb, reaches the header and the
footer (the now-playing bar) only after the page's own controls, and keeps
focus clear of the footer. Up and Down from a row (`data-nav-row`: a Home
shelf, the hero's verbs, Details' verbs, a media row) reach the nearest row or
control first, so Home's and Discover's shelves and their headings are walked
one by one and never skipped for a farther control that lines up; the header
and the footer still come after the page's controls. This keeps the sideways
distance penalty, so a rail beside a list cannot take Up or Down from a nearer
row in that list. In their own row they
reach only a control past them and in line with them (a wrapped line,
Continue's Details under its tile, a device's Sync under its fader in Where it
plays), never a tile beside them whose caption is shorter or taller, nor a
device's Sync from its check. The header stays at the top while the page
scrolls under it, and scroll padding keeps the focus clear of it. Up from a
page's first row (past its heading, where that is a link) reaches it on the
current tab, and Down from it returns to the page's first control. Up again, past the top,
reaches a toast's action, such as Undo ([Design](../design.md), Messages). After a page change the first key starts at the page's first
control. Screens shown before the shell (the first-run chooser) bring the
same arrow navigation.

## The TV player answers a remote

A Remote's Info key opens the player from any page. With its controls hidden, OK shows them
on the first enabled transport slot, Up and Down show them on the timeline (or
that transport slot when there is no seekable timeline), and Left and Right seek
10 s and show the timeline (live media that can't seek only shows them). Back
hides the controls; with them hidden it leaves the player for the page that
opened it, and playback goes on in Home's hero and the now-playing bar.

Paused shows a large Pause glyph and "Paused" over a picture, and the controls stay up until
Back hides them. Over a video, the top band shows and hides with the controls
([Player](player.md#controls-over-the-picture)). The TV's player has none of
the pointer's Back arrow or the window's fullscreen; Details is in the Playback
sheet, and the tab bar is hidden while the player is open (the header takes
the `hidden` attribute). From hidden controls, Stop for pausable media
is OK, Right, OK. Nonpausable radio/live starts on Stop, so it is OK, OK.
Home's hero uses that
same transport rather than maintaining separate Play/Pause, Stop and Next logic.
