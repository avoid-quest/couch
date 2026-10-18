# TV

## The TV has its own layout

A TV (`body.tv-presentation`, styled with the
`tv:` variant) keeps the sections, routes and model and recomposes them for
a remote at ten feet. The TV uses its own
composition: fewer focus stops, a quiet local-name header and controls revealed
over the picture. Desktop and phone keep their browsing and Couch-switch controls.
Home's hero and shelves: [Home](home.md). Search and Details: [Browse](browse.md).

Focus is
the only highlight; no hover style applies on the TV. The TV has no hover: under `.tv-presentation` the `hover` variant
never applies, so a stray pointer can't compete with focus.

Back closes an open
overlay, then leaves a detail page or Where it plays' overview for the page
that opened it with its focus restored, then takes any section to Home, where
Back does nothing. Opening
Up next changes the player URL without losing its opener. Settings' own OK
and Back: [Settings](settings.md#section-nav).

After every page change, focus is on the page's first control. When that control renders
after later ones (Home's hero waits for its data, Live's first On air tile for the shows, a collection's Play for its source), focus moves
to it as it appears, unless a key or pointer came first. Library starts on its rail's current section, and OK on
another section opens it and keeps the rail; Right reaches its rows. On Details the first control is the
primary verb, so OK plays, and Right walks the other verbs one stop each. The header holds the sections as centred tabs,
the TV's name at the left and the clock at the right, as plain text; the Couch choice lives in Settings → Couch
connection, and the TV has no Remote tab or Keyboard shortcuts. Layout per screen: [Shell](shell.md#header-and-section-nav).
Volume and every fader move 5 per press. Search's field says "Type with Remote on
your phone": a phone's Remote is the TV's text entry.

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
shelf, the hero's verbs, Details' verbs, a media row) reach the nearest row first, so Home's
shelves are walked one by one and never skipped for a farther control that
lines up. In their own row they reach only a control past them (a wrapped
line, Continue's Details), never a tile beside them whose caption is shorter
or taller. The TV's tab bar is not sticky: it scrolls away
with the page, as on Apple TV, so the page gets the screen. Up from a page's
first row reaches it on the current tab, and Down from it returns to the
page's first control. After a page change the first key starts at the page's first
control. Screens shown before the shell (the first-run chooser) bring the
same arrow navigation.

## The TV player answers a remote

A Remote's Info key opens the player from any page. With its controls hidden, OK shows them
on the first enabled transport slot, Up and Down show them on the timeline (or
that transport slot when there is no seekable timeline), and Left and Right seek
10 s and show the timeline (live media that can't seek only shows them). Back
hides the controls; with them hidden it leaves the player for the page that
opened it, and playback goes on in Home's hero and the now-playing bar.

Paused shows a large Pause glyph and "Paused", and the controls stay up until
Back hides them. Over a video, the top band shows and hides with the controls:
the title and subtitle at the top left, the clock and the end time at the top
right ([Player](player.md#controls-over-the-picture)). The TV's player has no breadcrumb, Couch switch, inline Details button or fullscreen;
Details is in the Playback sheet, and the tab bar is hidden while it is open
(the header takes the `hidden` attribute, since `tv:grid` would beat the class). From hidden controls, Stop for pausable media
is OK, Right, OK. Nonpausable radio/live starts on Stop, so it is OK, OK.
Home's hero uses that
same transport rather than maintaining separate Play/Pause, Stop and Next logic.
