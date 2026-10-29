# Couch design system

Couch is one app on three kinds of screen: the TV (a remote), a desktop window
(mouse and keyboard) and phones (touch). It is a dark living room lit by what
plays. Every picture is an object you could hold (a sleeve, a poster, a logo,
a video's frame), shown whole and crisp in a room painted with its own colours.
Type is set large and whole, in one display face at one width, stepping down in
size as a title grows. Home and every Details page open
on a [Stage](#stage), the one bold thing, and what plays floats over every page
but the player and Remote in a capsule of tinted [glass](#glass).

Everything on screen comes from one model: **Devices**, the **Playback** each
one serves, and **Where it plays**, a Playback's Devices with their picture and
sound. A Device running Couch's TV presentation is a **TV**; other Devices get
a **Remote** for it.

The [use-case and capability contract](audio-video-use-cases.md) separates source,
acquisition environment and playback behavior. Native capture is currently
Mac-only and wired to local desktop Live publication; that coupling is an
implementation limit, not a product rule.

Share separates **Screen**, **Window**, **System audio** and **Audio input** from
playback behavior. Audio input offers **Relaxed / Live** on the Couch computer;
browser input sharing keeps relaxed playback. A live audience gets **Join/Leave**
and its own volume; programme and queue controls remain with ordinary playback.
The host chooses Live's playback buffer and codec when sharing. Native inputs
also have a capture buffer and, on inputs with more than two channels, a stereo
pair or mono channel choice in Share and the running share's panel
([Share](design/share.md#live-audio)). Listeners use the unmodified
[Sendspin browser player](live-audio.md); the player shows **Waiting for audio…**,
**Listening**, reconnect status or the actual source/output error.
On macOS, desktop listeners request a smaller Chromium audio buffer for lower Live
output latency; Linux and Windows keep their default buffer
([Timing](live-audio.md#timing)).
Capture errors remain visible until sharing ends or restarts.
The sharing panel polls connection routes only for WebRTC shares; PCM shares
use Core's listener state.
Live's host panel keeps settings in place while loading, reports save failures
inline, and announces capture restarts. Buffer edits validate before sharing
starts; closing Share returns keyboard focus to its opener.

The mixer's **Compressor** belongs to the Playback and runs before device volume.
It is off by default. **Advanced** opens six draft controls with Apply and Reset
to default; see [Where it plays](design/where-it-plays.md#compressor).

**One layout.** The TV's layout is Couch's layout on every screen, rendered as
one component tree. Screens differ only where input demands it (a pointer,
touch reach, typing, the window), through the `tv:` and `touch:` variants and,
where keys or focus differ, a `tvPresentation` branch. Phones keep a bottom tab
bar for thumb reach.

## Principles

- **Show the whole picture.** Artwork keeps its true shape everywhere. On the
  Stage and in the player a picture (a video's frame, a square cover, a
  poster, an avatar, a logo on its own ground) is an **object** that stands
  whole at a generous size with a shadow under it, never a backdrop: a
  thumbnail's own lettering is part of the picture, not a ghost beside the
  title, and nothing ends in a hard edge; a logo on nothing
  (a vector, see-through edges) is a **mark** that stands whole without one.
  Nothing is cropped into a band, and white artwork stays white
  ([Stage](#stage)).
- **The room takes the picture's colour** ([Room](#room)). Behind a Stage and
  the player's Now playing, the room is painted with two colours read from the
  artwork, with a fine grain, and the now-playing bar's glass takes its tone.
  Colour from the artwork is the only colour besides danger's red.
- **Set the words whole.** Titles wrap and their type adapts to their length
  rather than ellipsing where there is room: the Stage's and the player's
  titles, Home's rows, tiles and captions. Text truncates only where space is
  truly scarce (a phone's bar, the line over a video, a breadcrumb's long
  names), with the
  whole text on hover and focus.
- **Depth means something.** What floats casts a shadow: the bar, an object
  on the Stage, the player's artwork, Up next summoned over the room. Pages,
  rows, tiles and shadcn's menus are flat: no Cards or bordered
  panels, open typography, whitespace and divided rows. A tile is a picture
  and a caption, with no fill, outline or links around it.
- **One primary target per item, one menu.** Pressing a row or tile does its
  main verb; its other verbs are its one menu ([Menus](#menus)). Where it
  leads (its channel, album, series, season, station, source) is the last
  verbs of that menu, "Go to Phony", and visible links where the item has the
  room: the Stage, the player and the now-playing bar. Never nested in the
  target.
- **Say each thing once.** The bar holds the transport, so Home's Stage
  doesn't repeat it while something plays. The player's Now playing is calm
  (artwork, title, where it comes from) and Info at the top right, aligned with
  fullscreen below, shows the rest in place;
  Up next is summoned from its button, never parked beside the artwork
  ([Player](design/player.md#calm-and-info)).
- **Real content only.** Browse pages show what a source returns; Couch picks
  nothing. Home's sources are built from what the Couch saved.
- **Content leads, time supports.** Title and artwork lead; runtime, progress
  and end times are small muted metadata. Live media that can't seek has no
  seek timeline. Radio may show broadcast progress from an XMLTV programme
  window, with its local times and remaining minutes ([Radio](design/browse.md#radio-and-live-tv)).
- **Undo, not confirm**, for shared actions; destructive admin actions confirm
  inline or in an AlertDialog.
- **Disabled keeps its place.** A control that can't act stays in its slot at
  half ink (`disabled:opacity-50`); nothing shrinks or moves.

## Room

`artwork-light.ts` reads a 16×16 copy of the artwork, once per address. Core
fetches the picture for the read (`/api/artwork`, raster pictures only), since
most artwork hosts don't let a page read theirs; artwork it can't read gives
no colour, and the picture on screen is never touched. A read that failed
(Core out of reach) is tried again the next time the artwork shows. It picks
the picture's strongest hue and a second one at least 60° from it (a picture
with hardly any colour gives its grey; black and white give none), and learns
whether the picture's edge is see-through (a logo on nothing).

Devices reading the same new picture share Core's download as well as its
completed cache. Leaving a page cancels only that reader; Core cancels the
download when its last reader leaves. Failed reads can be retried immediately.

Each colour is set to a luminance, keeping its hue, so ink keeps 7:1 over it:

| Colour | Luminance at most | Use |
| --- | --- | --- |
| `room` (first) | .022 | the room under the copy: muted ink (`#bdbdbd`) keeps 7.8:1 or more, measured |
| `deep` (second) | .01 | the room's second pool and its fall to black |
| `a` (backlight) | .07 | the light pooled behind the picture, never behind copy; a hovered tile's glow |
| `tone` | .03 | the now-playing bar's glass |

The **room** (`.room`) lies behind a Stage and the player's Now playing: the
first colour pools behind the picture (mixed with the backlight at its heart),
the second falls from the top corner, then black, with a static grain tile at
6% so the dark has a surface and the gradients don't band. Without colour (a
white cover, a black-and-white logo) the room is a neutral graphite. The
colours are registered custom properties, so when the artwork changes they
cross-fade over 600 ms; reduced motion swaps them at once. Everything is
painted once: no blurred copy of the picture, nothing animated.

Video keeps black letterbox bars in windowed, fullscreen and TV playback; no
artwork light is painted behind its picture. Its control bands use neutral
black scrims for legibility. Audio and browsing keep their artwork-lit rooms.
A hovered or focused tile or row glows under its picture in its first colour
(`useItemLight`).

## Glass

The now-playing bar is a capsule of glass floating over the page
(`.bar-glass`): `rounded` 1.25rem (1rem on phones), inset from the window's
edges so its content lines up with the page's gutter, with a deep shadow under
it and a 1px highlight along its top. Its backdrop is blurred (28px),
saturated (1.5) and halved in brightness, and the playing artwork's `tone`
lies over it at 80% (`#1c1c1e`, `--tone`'s initial value, without one). Over pure white behind
it, its white ink keeps 10.4:1 and its muted ink (white 80%) 7.3:1 for every
hue, measured. The tone cross-fades over 600 ms when what plays changes. It is
the one backdrop filter on a page (Up next, summoned over the player's room,
is the other, on the player). Toasts and the header's sharing capsule float in
the same family, on its solid surface and shadow (`--float-shadow`) without
the filter. The sharing capsule has its own row below navigation and search;
its name, viewers and Stop never displace those primary controls ([Shell](design/shell.md#header)).
Share sits immediately before search, which fills the row to the right page
gutter. Keyboard shortcuts is in the Couch popover. Windows/Linux captions have
only their native-height area above that row, over the Stage.

## Stage

`Stage` (`components/Stage.tsx`) opens Home (the hero) and every Details page
(`DetailHeader`). It reaches up under the header and out to the window's
edges, in its picture's [room](#room), which fades into the page's black at
its foot. The picture stands whole at the right at its own proportions, read
once it loads (`useArtRatio`; its kind's shape until then). Loaded proportions
are shared with the bar and player, so revisiting artwork starts at its known
shape without a second layout:

- **Object**, any picture, a wide frame too (a video's 16:9): as tall as the
  stage allows under the header (`--object-h`) and no wider than 40vw
  (`--object-w`), `rounded-sm`, with its shadow (`--object-shadow`); a
  channel's avatar stays a square frame with a circular mask, even when its
  source is non-square or transparent. A picture that loads cold settles into place
  (.75rem, 450 ms) as it fades in. Never a backdrop: no fade can know where a
  thumbnail's lettering sits, so a backdrop ghosts it beside the title and
  ends in a hard edge.
- **Mark**, a vector or a picture with see-through edges: whole, without a
  shadow or a corner, which would outline its box.

The copy sits at the bottom left in the room left of the picture (at most
46rem, less the picture's width and a gap): the trail, the title at display
size ([Type](#type)), one muted meta line ending in its links, progress, the
verbs, the synopsis. Nothing of it lies over the picture. The header is
see-through while the page is at its top and black once it scrolls, including
Windows/Linux desktop windows ([Shell](design/shell.md#header)).

- **Heights.** Home `min(39.375vw, 70vh)`; Details `min(33vw, 60vh)`. A
  Details page with nothing under its stage fills the window above the bar
  and centres its copy and picture in it (from `md`); its skeleton keeps the
  regular height. Below `md` the picture
  leads the column at the top, centred above the copy (at most 72vw, 22rem or
  46vh tall); a wide one spans the column.
- **7:1, measured.** The copy and the header sit only on the room, where it is
  at most luminance .022.
- **Without artwork** (or when it doesn't load) the room stands alone, in its
  graphite: the title is already set large, so no cover in type repeats it.

## Brand mark

The mark is the avoid.quest disc and horizontal cuts with the lower half
shifted right. Desktop icons use the black tile in
`packaging/icons/icon.svg`; the macOS tray uses a template silhouette; the PWA
maskable icon keeps it inside the safe circle. In the app, `CouchMark` sets it
in the current ink: before the Couch's name in the header (filled while
connected, hollow while not), before the TV's own name, and on the pairing and
first-run screens, where it stands whole at the right as a Stage's mark would
([Shell](design/shell.md#first-run-and-pairing)).

## Tokens

Tokens live in `:root` in `src/client/index.css` (one dark theme). Use the
Tailwind names, never hex values in components.

| Token | Value | Use |
| --- | --- | --- |
| `background` | `#000` | page, header, sheets |
| `foreground` / `primary` | `#fff` | ink, the primary button, focus |
| `secondary` | white 10% | a chip's or a filled control's ground; a rail's current page |
| `fill-hover` | white 16% | that ground under a pointer |
| `muted` | `#171717` | loading artwork, skeletons, the search field |
| `muted-foreground` | `#bdbdbd` (white 85% in the player's bands, 80% on the bar) | metadata: 7:1 over any room |
| `accent` | white 10% / `#fff` | a menu's, Select's or the palette's row under the pointer |
| `bar` | `#1c1c1e` | the now-playing bar's glass where the artwork gives no tone ([Glass](#glass)) |
| `border` | white 14% | hairlines and row dividers |
| `input` | white 16% | the edge of fields and outline toggles |
| `radius` | `.5rem` | shadcn's base; Couch's own scale follows |
| `--object-shadow` | two soft black shadows | what stands in a room: an object on the Stage, the player's artwork |
| `--grain` | a static noise tile | the room's surface, at 6% |

Couch's scales are Tailwind theme tokens (the `@theme` block "Couch's scales"
in `index.css`), and `cn` (`lib/utils.ts`) knows them, so `text-meta` merges
as a size and `h-control` as a height.

| Scale | Steps | Use |
| --- | --- | --- |
| Radius | `sm` .25rem, `md` .5rem, `lg` .75rem, `xl` 1rem | what you press or type into is a capsule (`rounded-full`): buttons of every size, inputs, Select triggers, input groups, toggles, tabs, chips, the search field, Switch, a slider's thumb and track, progress; a tile's picture and a menu's or the palette's row `rounded-md`; a row's thumbnail `rounded-sm`; the bar's `rounded-md`; a surface that opens over the page (menus, popovers, the palette, Select content, dialogs, Up next over the picture) `rounded-lg`; the now-playing bar 1.25rem (1rem on phones) |
| Control height | `control-sm` 1.75rem, `control` 2rem, `control-lg` 2.75rem, `field` 3rem | `size="sm"`; the default; the Stage's verbs (`size="lg"`); the header's search field. `touch:` raises each to 44px |
| Type | `caption` .75rem, `meta` .8125rem, `body` .9375rem, `title` 1.125rem, `heading` 1.25rem, `page` 2.25rem | [Type](#type) |
| Spacing | `caption` .125rem, `stack` .75rem, `item` 1rem, `section` 3.5rem | inside a caption; a heading to its content; between items; between sections |

**Focus inverts** the focused control to white with black ink, and the TV's
highlight is the same. White controls (slider, Switch, Checkbox,
RadioGroupItem) take a 2px foreground outline instead. Media is the exception:
a focused tile keeps its caption and rings its picture in white (2px, offset
3px), lit in its own colour, and the TV thickens the ring to 4px while it lifts
the tile 5% ([TV](design/tv.md)); a focused row's text inverts. A text link's
inversion reaches a little past its words (a shadow, so nothing moves).

Content navigation restores the exact opener in its page or the now-playing
bar, even when both link to the same destination and the page loads later.
While an opener is missing, the returning page's first control is provisional;
the exact opener takes over if it loads before the user chooses or navigates.
When Home's Play becomes the playing title, lost focus follows it; a control
the user moved to while playback started keeps its focus.
When Stop removes the focused bar or its portalled panel, lost focus returns
to the same page's primary control, waiting up to 15 seconds if it is loading.
Any key, pointer press, focus choice or navigation ends that recovery.

**One hover language.** A pointer brightens; only the keys invert. Media
lights up: a pointer over a tile or a row makes its picture glow in its own
first colour (`--item-light`, read the first time a pointer or focus reaches
it; faint white until then) at once, and brings its meta line up to white; its
"…" appears with it, also at once (fading the glow or the "…" would repaint, or
start an animation, under every row a scroll passes under the pointer).
Everything else brightens: ink comes up to
white (a ghost control or a toggle rests at 80% white and a press dims it to
60%), a fill steps up one notch (`secondary` to `fill-hover`; the white button
to 85%), and an outline's edge comes up. One whose panel is open
(`aria-expanded`) stays lit. Ink never turns dark under a pointer, and nothing
tints, dims, scales or moves under it; the bar's artwork keeps its ink, and a
text link's ink and underline come up to white. A press dims a tile's picture
to 80%. A press on the transport (Play, Pause, Stop, Next) scales its glyph to 90%
and lets it spring back ([Motion](#motion)). Whatever a press acts on shows the hand, sliders
included (the arrow while disabled). Never on the TV, which lifts its focus
instead. The header's tabs mark the current section with a short white rule
under its name.

In menus, Selects and the palette the row under the pointer takes a quiet fill
(`accent`) with its ink unchanged, and only the row the keys reach inverts. A
Radix menu's or Select's row inverts only under `html[data-keyboard]` (Radix
focuses the pointer's row, which Chromium calls `:focus-visible`); the
palette's rows only while its list lacks `data-pointer`, which `HeaderSearch`
sets as a mouse moves over it and a key removes.

## Type

`html` font size is `clamp(16px, 1.25vw, 24px)`, so rem sizes scale every
screen alike. Two faces, clearly apart:

- **Mona Sans** (display, `font-display`, `@fontsource-variable/mona-sans` with its width axis):
  a warm grotesque with width (75–125%) and weight axes. It sets the Stage's and the player's titles
  (`.display-title`, weight 680 to 760), page titles and the headings of shelves,
  lists and sections, including Settings, dialogs and sheets (`font-heading`, normal width, semibold). `index.html` preloads its latin
  file.
- **Inter Tight** (everything else, including the desktop header): regular, but
  for the bar's title (medium); metadata small, muted and tabular. `index.html`
  preloads its latin file too.

A display title is always Mona Sans at its normal width (100%), so short and
long titles read in one voice; condensed below about 92% it reads as another,
cheaper face. Its length (`titleLength`) steps its size and, a little, its
weight down, and a long title wraps to more lines instead, set whole, never
clipped. Its size is also capped so its longest word fits its column
(`titleFit`: `--word` characters at `--glyph` .7em, a lowercase character's
width measured on real titles, against the column's `cqi`), so a word never
breaks; a longer all-caps word may.

| Length | Weight, leading | Home | Details | Now playing | Phones (Home, Details, Now playing) |
| --- | --- | --- | --- | --- | --- |
| up to 14 characters | 760, .94 | 5rem | 4.5rem | 5.5rem | 3rem, 2.75rem, 3.25rem |
| up to 26 | 740, .96 | 4rem | 3.5rem | 4.25rem | 2.375rem, 2.25rem, 2.5rem |
| up to 44 | 700, 1 | 3.125rem | 2.75rem | 3.25rem | 1.875rem, 1.875rem, 2rem |
| longer | 680, 1.04 | 2.5rem | 2.25rem | 2.5rem | 1.625rem, 1.625rem, 1.625rem |

| Role | Classes |
| --- | --- |
| Stage and Now playing title | `.display-title` (above), leading .94 to 1.04 |
| The player's title over a video | `text-3xl` semibold, two lines, then the whole title on hover |
| Page title (`PageHeader`) | `text-page font-semibold` in Mona Sans |
| Heading of a shelf, a list or a section (`ShelfHeading`, `SettingsSection`) | `text-heading font-semibold` in Mona Sans |
| Dialog and sheet title | `font-heading text-lg font-semibold` in Mona Sans |
| The bar's title, the palette's query row | `text-title font-medium`; the bar's stays on one line with ellipsis, its full title in the tooltip and accessible name |
| Item title (tiles, rows), settings label, the search palette's rows | `text-body`, wrapped whole |
| Up next's start times (a board line) | `text-base font-light tabular-nums` |
| Controls | `text-sm` (the Stage's verbs `text-body`) |
| Metadata | `text-meta text-muted-foreground`, wrapped whole |
| Caption | `text-caption text-muted-foreground` |

The page gutter is `px-(--gutter)` (`clamp(1rem, 4vw, 3rem)`); the shell gives
the one top offset (`pt-8`), and a page's sections are `gap-section` apart.
Two-column pages (Saved, Settings) use a `12rem` rail and `gap-12`. Controls
are capsules, `h-control text-sm`; `touch:` (phones and windows narrower than
960px) raises them to 44px. Playback icon controls (transport, Volume, Where
it plays, Up next, Playback, fullscreen, Open player, Back, a Sheet's Close)
are one ghost `icon-lg` button with a 1.25rem glyph and a 44px target. The
transport's filled glyphs use opaque ink and fade as a whole at 80% opacity
(100% on hover or keyboard focus, 60% on press). Opacity eases over 150 ms;
keyboard focus lights it at once and reduced motion skips the transition.
Translucent fill and stroke must not overlap into a bright contour. This follows CSS
[`opacity`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/opacity),
which composites the element and its contents together.
The player's band and the now-playing bar share `--player-target`, which grows to
2.25rem. At a row's end they pull back (`-ml-2.5`/`-mr-2.5`) so the glyph lines
up with the text. So does the verb that starts a header's second line on a phone, under the
full-width primary (`verbRow`).

## Motion

Motion answers what people do and what plays; nothing performs on its own.
One easing (`ease-out`, the default for every `transition-*` in `index.css`)
and three durations: 150 ms for what answers a control, 200 ms for what
arrives, 600 ms for colour that follows what plays.

- Colour changes (hover, selection, the tab underline) ease both ways.
- Focus inversion arrives at once and fades out, so a held arrow never passes
  through grey.
- A press on the transport, in the bar and the band, scales its glyph to 90%
  over 150 ms and springs back as it lifts, so Play and Pause feel struck.
- Menus and popovers grow from the button that opened them (a zoom from 90%,
  its origin at the trigger's centre: an arrow that draws nothing gives Radix
  the point), and leave at once so focus is back before the next key. Up next
  over the picture, or summoned over the player's room, grows from its button
  the same way. Dialogs use shadcn's short fade and zoom. Sheets fade and rise
  (200 ms).
- Routes appear immediately with cached content; artwork fades only on a cold
  load, and a Stage's object settles .75rem into place as it does (450 ms);
  the player's bands fade together with the subtitles they lift.
- Opening the player fades it in over 160 ms; Back fades the restored bar in
  over the same interval. Only opacity animates, with no route snapshots or
  shared-element capture. The transport keeps its familiar positions in both
  layouts. Reduced motion presents them immediately. The measured navigation
  costs and frame budget are in [Preview performance](preview-performance.md).
- When what plays changes, the room's colours and the bar's tone cross-fade
  over 600 ms ([Room](#room)). Reduced motion swaps them at once.
- Media lights up at once: its glow is a shadow, and nothing animates
  `box-shadow`; only the focus ring around it eases (150 ms).
- No scroll entrances, staggers or scaling tiles (but the TV's lifted focus),
  nothing animates `filter`, and no loops but the loading indicators (Spinner,
  Skeleton) and the **level**, three bars that rise and fall while sound comes out
  (`Level`). It says the player's state, not the sound's loudness: it moves
  only while what plays is playing, and lies flat while paused, buffering or
  loading, as short thin bars that can't be read as a "…". It sits on the playing item's artwork (a black square in its
  bottom-left corner, only while sound comes out, since a paused chip read as a "…") wherever it is listed, in place of a playing track's
  number, and beside each device in Where it plays whose sound is in. The now-playing bar has no level:
  Play/Pause already communicates its state. Its bars move by transforms only, in
  steps, about eight a second, from one clock for every level on the page (`Level`): a continuous animation would have
  the browser draw every frame for as long as anything plays. Reduced motion holds them still at three heights while it plays.
- New motion is `motion-safe:`; reduced motion stills everything.

## Components

shadcn components live in `src/client/components/ui` and are owned by Couch.
Changes from the Mira defaults: capsule `text-sm` controls at `h-control`
([Tokens](#tokens)), a flat left-rule `Alert`, a left-aligned borderless
`Empty`, no shadows but the floating surfaces' (`--float-shadow`: the bar,
toasts), a 1.25rem glyph in `icon-lg`, Select items that reserve
room for their check, and ghost buttons that rest at 80% white ink and
brighten rather than tint. Check the
[catalog](https://ui.shadcn.com/docs/components) before building anything
custom.

`Command` (cmdk) was added for the header search's palette
([Shell](design/shell.md#search-field)): a field that scopes a search and
suggests as you type needs a listbox the focus never leaves, which a menu or a
Popover over a field can't give a remote typing into it. Couch's copy has no
surface of its own (the header search gives it the menus' ground under the
field, or the screen's), `min-h-control` rows at `rounded-md` (44px on
touch), headings as the menus' labels, and a row the keys select that inverts
as focus does, at once, while the row under a pointer takes the menus' quiet
fill ([Tokens](#tokens)). The field is Couch's own input as the combobox, not
`CommandInput`, so the TV's Type on TV and the `#media-search` hooks keep it.

Shared building blocks in `src/client/components`:

- `PageHeader`: a page's h1 with an optional back button or breadcrumb and
  actions; `hidden` keeps an `sr-only` h1 where the tab or rail already names
  the page. `ContentBreadcrumb` is a content page's real path, up to its
  parent ([Browse](design/browse.md#breadcrumbs)).
- `SettingsRow` / `SettingsSection`: label and control on divided rows.
- `Stage`, `StageTitle`, `titleLength` and `titleFit` ([Stage](#stage), [Type](#type)); `useArtRatio` (`MediaArtwork.tsx`) reads a picture's own proportions.
- `Onboarding`: first run's and pairing's screen, a Stage without artwork with
  optional Back and step capsules; `wide` gives settings rows the full width ([Shell](design/shell.md#first-run-and-pairing)).
- `Shelf` and `MediaTile`; `MediaRow` / `MediaList`; `MediaArtwork`
  ([Browse](design/browse.md#rows-and-tiles)). Artwork keeps its true shape,
  one per kind of item (`artShape`: 2:3 posters for films and series, 16:9 for
  videos and streams, squares for music and stations, circles for channels);
  a shelf or a list takes its majority shape
  ([Artwork shapes](design/browse.md#artwork-shapes)). `mediaCaption` and
  `metaLine` give captions one rhythm: an episode leads with its series, and
  meta parts are joined by commas; `withoutUrls` takes bare addresses out of
  descriptions.
- `DetailHeader`: an item or collection page's header, a Stage with the
  trail inside it ([Browse](design/browse.md#details)), with `SaveToggle` (Save as a bookmark
  that fills, fixed width) and `Description` (three lines, then More), which
  Search's closest match uses too.
- `ContentFilters` (`FilterBar`, `FilterChoice`, `FilterSelect`, `FilterInput`)
  and `BrowsePagination` ([Browse](design/browse.md#filters-and-pages));
  Search's own `SearchFilters` ([Browse](design/browse.md#search)).
- `ContentLink` / `MediaContext`: relationship links with Back and focus
  restoration; `useRelatedMenu` gives the same relationships as a tile's or a
  row's "Go to …" verbs.
- `PlaybackTransport`, `PlaybackTimeline`, `VolumeButton`
  ([Player](design/player.md)). The dedicated `PlaybackSeekBar` uses Video.js Slider
  primitives with Couch styling. Pointer motion leaves the track, chapter cues
  and playback labels alone.
  `PlaybackThumbnail` uses standalone Video.js thumbnails for optional provider
  grids and timed cues, including on remote controllers. The selected cue is
  memoized; failed images can recover and cue gaps keep timestamps. Couch keeps
  transport and clocks, with one seek on release and cumulative keyboard edits.
  Touch drags and keyboard drafts share the preview. shadcn keeps volume, faders
  and the surrounding menus.
- `RadioRecognition`: the player's manual **Identify song** icon beside Info,
  cancellation and a dismissible, clickable `RadioRecognitionItem` below the
  station line, before Info's programme details. The shared item links directly
  to Couch Search with artist/title in the Audio scope and is also used by
  Saved → Identified songs, which displays album and requester too. Core keeps
  completed lookups with time, station, programme when known and requester;
  clearing the player leaves history intact. Saved favorites queued by stream
  URL resolve to their station ID too; Cancel and Clear restore trigger focus.
- `playbackStatus`: one status vocabulary for Home, the player, the
  now-playing bar, Remote and Up next. Its `quiet` states (Playing, Paused,
  Ready to play) are left to the Play/Pause glyph, so status lines show only
  loading, problems and the end.
- `RowMenu` (`useItemMenu`, `ItemMenu`): an item's one menu.

Custom compositions, and the gap each fills: `MediaTile`, `MediaRow`, `Stage`
and `DetailHeader` (the catalog has no media tile or header, and Cards are what Couch avoids);
`Shelf` as a plain overflow row (Carousel's arrow handling fights spatial
navigation); the timeline's hover readout (Slider has none); the Remote's pad
(no direction pad); toasts on sonner's `unstyled` option (its default surface
is bordered); Search's kind and source lines, `SearchFilters`, on Toggle
Group and Button (a Select or tabs offer fixed choices; Search offers only what
its results hold, as it finds them).

### Messages

Available updates show a small **Update ready** link in the header, with a count
for several devices. It opens the viewer's single [Updates page](design/settings.md#updates),
where device status, release notes and actions live together. Nothing adds a banner
or pushes Home's artwork down. Successful checks and updates finish with a brief
toast and clear their saved results automatically; failures stay visible for retry.

- **Toast** (sonner): errors, Undo, Queue confirmation and unexpected outcomes.
  Every toast is one of `src/client/toasts.ts`'s kinds (`failed`, `undo`,
  `queued`, `playing-on`, `notice`, `tap-to-hear`, `sharing`), each with a fixed duration
  and at most one action; a repeat updates the one showing. Routine actions,
  and playback activity from other devices, stay quiet. A new item or
  controlled device retires old Queue and Undo feedback; switching Couch
  clears all. Toasts float like the bar ([Glass](#glass)): its solid
  surface (`bar`, `rounded-xl`) and shadow, without a backdrop filter. They hug
  their words, an error leading with its red icon and the action beside them
  as a small white capsule, two at most: top right below the header (or the
  player's top band), and on phones at the bottom, just above the footer or the
  player's band, so they never cover the artwork at the top. A toast never takes focus:
  Up from the top of the page reaches the newest one's action, and any other
  key returns. The TV ignores pointer hover on them.
- A refused media request shows its HTTP status. **Try again** requests a fresh
  stream; a 403 alone does not claim that the video requires age verification or sign-in.
  YouTube stays loading until its selected formats pass a downloadability check,
  including after **Try again**. On Devices using native H.264 playback, YouTube
  prefers HLS picture and original sound when available, preserving the selected
  quality and audio instead of taking the first dubbed track from the master
  playlist. Original-language HTTPS audio takes priority over a dubbed HLS rendition.
  Bandcamp selects browser-compatible MP3, AAC, FLAC or WAV audio, retaining
  supported lossless formats while excluding ALAC and AIFF downloads.
- **System notification**: only the desktop app's "Couch X is ready" when an
  update has downloaded, since it installs on quit.
- **Alert** for a persistent problem on the page (destructive, with Try again
  in `AlertAction`), when the problem is the page (a source's own home);
  sources that didn't answer beside others that did (Search, a Details page's
  neighbours) are one muted line at the end, `SourcesUnanswered`; **Empty** for empty states; a `Spinner` status line for
  work in progress.
- An outgoing Search page keeps its query and filters while the destination
  loads; a page change does not start an empty search in the background.
- **Dialog** for short tasks (pairing, source setup), **AlertDialog** for
  confirmations, **Popover** for the player's menus and panels over the picture,
  the Couch switch and Where it plays on desktop, **Sheet** for longer panels
  (Where it plays on phones and the TV).

Portalled surfaces and their backdrops share `z-50`, above the page and its bars.
Later portals cover earlier ones: a confirmation covers the Couch switch that
opened it, and a menu or Select opened inside a dialog or sheet stays above it.
Keep this order across overlay types rather than giving one type a higher layer.

Dialogs and confirmations stay within the viewport with a 1rem gutter at the
client's interface size; long content scrolls inside the dialog. A caller's
smaller height uses `--dialog-max-height` (Keyboard shortcuts requests `85dvh`),
so it keeps the shared zoom-aware viewport cap.

## Menus

One item, one menu: a controlled shadcn Dropdown Menu fed one verb list
(`useItemMenu` / `ItemMenu` in `RowMenu.tsx`), opened in one place whatever
opened it.

| Input | Opens the menu |
| --- | --- |
| Pointer | The "…", shown while the pointer is over its tile or row or focus is in it; right-click |
| Touch | The "…"; a 500 ms long press |
| Keyboard | The "…" (a Tab stop); the menu key or Shift+F10 on the item |
| TV remote | OK held 500 ms (a short OK acts on release); Right to a row's "…" |
| Remote section | OK held on the pad, sent as a held OK |

Keyboard and remote land on the first verb; Esc and Back return focus to the
opener. A verb that removes its item leaves focus on the neighbour.

## Copy

Sentence case, short, no filler: say what happened and what to do next. A
line of parts (a caption, Details' meta, a device's status, Where it plays'
counts) joins them with commas, never middle dots (`metaLine`).
Shared strings live in `src/client/copy.ts` (`Try again`, `Only an admin can
change this.`, `Offline. Reconnecting to {name}…`). Couch's own words: a
device's name (or "This device"), Where it plays, Move here, Play on {name},
Remote, Share on network, admin, Up next (the list) and Queue (the verb),
Save / Saved. Verbs are the same everywhere: Play, Pause, Stop,
Next, Play next, Queue, Save, Open, Resume, From start, Remove, Hide.

## Surfaces

- [Shell](design/shell.md): sections and paths, the header and search, tab
  bars, the Couch switch, the now-playing bar, keyboard, first run.
- [Home](design/home.md): the hero, your own rows and the sources.
- [Browse](design/browse.md): Search, Radio and Live TV, Hide, Details, Saved,
  rows and tiles, filters and pages, breadcrumbs.
  Captions remove confirmed type/category overlaps while keeping compound genres
  and creator names; channel Details preserves chosen Saved names and canonical identity.
- [Player](design/player.md): the picture, scrims, the band, settings, Up next,
  status.
- [Where it plays](design/where-it-plays.md): the mixer and Play on.
- [Share](design/share.md): sharing this device's screen or sound, the
  capsule while it runs.
- [TV](design/tv.md): what the TV adds for its remote.
- [Remote](design/remote.md): the Remote section and Type on TV.
- [Settings](design/settings.md): its pages and section nav. Network sharing
  chooses Ethernet before Wi-Fi automatically, without requiring network flags.
  AirPlay's admin controls, including open confirmations and retries, wait for
  the Couch to reconnect.

[123MoviesFree](123moviesfree.md) keeps the selected film or episode while
trying one supported advertised Server 2 stream if its direct manifest is
unavailable. Playback uses the same controls and language preference; the
fallback's own subtitle tracks take precedence when available.
When a source offers external subtitle files, HLS does not add automatic in-band
captions beside them; the subtitle selection and Off control all visible text.
Browser playback reports only changed player state and advancing position ticks;
subtitle initialization keeps the connection stable even with 16 tracks.

`apps/web` (the couch.avoid.quest site) keeps its own pages; its structure and
words follow [the website notes](product/website.md) and [voice](product/voice.md).
Download uses flat rows per channel, with explicit **Mac (Apple Silicon)**
(macOS 14+) and **Mac (Intel)** (macOS 13+) choices. Each row appears only when
that channel has its installer; it carries the architecture, minimum OS and
first-open instructions. Browser platform detection can bring Apple Silicon
first on a Mac, but never infers the CPU from its user agent.
On Intel macOS 13–14, a TV channel needing mpv reports the compatible-install
requirement only when no suitable local copy is available; other media is unaffected.

It tracks page views and installer clicks through a same-origin Umami proxy;
the [website notes](product/website.md#analytics) describe the download counters.

## Changing a surface

- Keep the hooks the browser checks use (`tests/tv-navigation.browser.ts`,
  `tests/tv-continue.browser.ts` find elements by `data-*`, `aria-label` and
  paths); a change that moves one updates those checks.
- Look at the change on a scratch Couch at 1920×1080 as a TV (the
  [TV override](design/tv.md#see-the-tv-in-a-browser)), 1440×900 on desktop
  and 390×844 on a phone.
- Cold loads use shadcn Skeleton in the destination's geometry, outside the
  focus order. Refreshes keep current data on screen; metadata is never shared
  across connections.
- Equivalent session snapshots reuse provider collections' derived hits and
  actions. Changes to their data, visibility, playback availability or action
  inputs update them, including the current profile, credentials and Play on
  destination (`tests/collection-rendering.browser.ts`).
- A surface's doc changes with its code.
