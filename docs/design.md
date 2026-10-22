# Couch design system

Couch is one app on three kinds of screen: the TV (a remote), a desktop window
(mouse and keyboard) and phones (touch). It is a dark living room whose only
light is the picture: black ground, white ink, artwork shown as pictures, never
in boxes, and type used large. Home and every Details page open on a
[Stage](#stage), the one bold thing; everything else is quiet. The picture
brings the colour.

Everything on screen comes from one model: **Devices**, the **Playback** each
one serves, and **Where it plays**, a Playback's Devices with their picture and
sound. A Device running Couch's TV presentation is a **TV**; other Devices get
a **Remote** for it.

**One layout.** The TV's layout is Couch's layout on every screen, rendered as
one component tree. Screens differ only where input demands it (a pointer,
touch reach, typing, the window), through the `tv:` and `touch:` variants and,
where keys or focus differ, a `tvPresentation` branch. Phones keep a bottom tab
bar for thumb reach.

## Principles

- **Flat.** Open typography, whitespace and divided rows. No Cards, bordered
  panels, shadows, gradients or blur; only scrims shade a picture (the
  player's bands, the Stage's top and its dissolve), and what opens over a
  picture is one translucent black. A tile is a picture and a caption: no fill,
  outline or links around it.
- **The artwork lights the room**, the one exception to Flat
  ([Light](#light)). Behind the large artwork (the Stage, the player's Now
  playing, a video's letterbox) its own two colours glow and fall to black; a
  hovered or focused tile or row glows in its own colour. It is light, never
  chrome: no surface, border or control takes its colour (the now-playing bar
  is a solid surface of its own), ink stays white and controls black and
  white.
- **One primary target per item, one menu.** Pressing a row or tile does its
  main verb; its other verbs are its one menu ([Menus](#menus)). Where it
  leads (its channel, album, series, season, station, source) is the last
  verbs of that menu, "Go to Phony", and visible links where the item has the
  room: the Stage, the player and the now-playing bar. Never nested in the
  target.
- **Real content only.** Browse pages show what a source returns; Couch picks
  nothing. Home's sources are built from what the Couch saved.
- **Content leads, time supports.** Title and artwork lead; runtime, progress
  and end times are small muted metadata. Live media shows no time and no
  label.
- **Colour only for danger.** Destructive red is the only colour.
- **Undo, not confirm**, for shared actions; destructive admin actions confirm
  inline or in an AlertDialog.
- **Disabled keeps its place.** A control that can't act stays in its slot at
  half ink (`disabled:opacity-50`); nothing shrinks or moves.

## Light

`AmbientLight` reads two colours from the artwork on screen: a 16×16 copy,
once per address (`artwork-light.ts`). Core fetches the picture for the read
(`/api/artwork`, raster pictures only), since most artwork hosts don't let a
page read theirs; artwork it can't read gives no light, and the picture on
screen is never touched. A picture's answer is kept per address; a read that
failed (Core out of reach) is tried again the next time the artwork shows. The first colour is a **backlight** that hugs the
picture's edges and is gone 3rem out; the second a **haze**, three pictures
wide. Both lie under the page's content and never move or size anything.

- **7:1 at the brightest.** The backlight is at most luminance 0.07, so white
  ink over it keeps 7:1; only titles come that close to artwork. The haze, which
  may lie under any text, is at most 0.004, so muted ink keeps 7:1 over it
  with room for the backlight's last trace.
- **The letterbox** is lit around the contained picture, as YouTube's ambient
  mode: the item's artwork gives the colours, painted once, so a playing video
  costs nothing per frame and a cross-origin video lights too.
- **Tiles and rows** take the first colour alone, at the backlight's
  brightness: a hovered or focused tile's or row's glow under its picture
  (`useItemLight`). The Stage paints its own light inside its mask
  ([Stage](#stage)).
- **Not light:** a gradient wash on a page, colour on a surface, a blurred
  copy of the picture, or light without artwork behind it.

## Stage

`Stage` (`components/Stage.tsx`) opens Home (the hero) and every Details page
(`DetailHeader`). It reaches up under the header and out to the window's edges.
The picture stands at the right at the stage's height and its shape (a poster
cropped to 4:5), and dissolves leftwards and downwards (a mask in the window's
coordinates: nothing of it shows left of 40vw, all of it right of 66vw) into
its own light, its first colour at the picture's heart and its second around
it, and then the black room; a narrow picture also softens its own left edge.
A logo or a channel's circle stands whole, contained, in that light. The copy
sits at the bottom left, at most 38vw wide, in the dark: the trail, the title
at display size, one muted meta line and its links, progress, the verbs, the
synopsis. A scrim holds the header's ink at 7:1 over the picture, and the
header is see-through while the page is at its top and black once it scrolls.

- **Heights.** Home `min(39.375vw, 70vh)`; Details `min(33vw, 60vh)`. Below
  `md` the picture spans the column at the top (a frame cropped to 4:3, a
  poster 4:5), fades downwards, and the copy starts over its foot.
- **7:1, measured.** Over the brightest picture each run of copy keeps 7:1 (the
  muted ink 8.3:1 at 1440, 7.5:1 at 390), as does the header's ink.
- **Not a backdrop.** No blur, no copy of the picture, no gradient where no
  picture is; a page without artwork gets the room's black and its cover in
  type.

## Brand mark

The mark is the avoid.quest disc and horizontal cuts with the lower half
shifted right. Desktop icons use the black tile in
`packaging/icons/icon.svg`; the macOS tray uses a template silhouette; the PWA
maskable icon keeps it inside the safe circle. In the app, `CouchMark` sets it
in the current ink: before the Couch's name in the header (filled while
connected, hollow while not), before the TV's own name, and on the pairing and
first-run screens.

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
| `muted-foreground` | `#a3a3a3` (white 85% in the player's bands, 72% on the bar) | metadata |
| `accent` | white 10% / `#fff` | a menu's, Select's or the palette's row under the pointer |
| `bar` | `#141414` | the now-playing bar's surface |
| `border` | white 14% | hairlines and row dividers |
| `input` | white 16% | the edge of fields and outline toggles |
| `radius` | `.5rem` | shadcn's base; Couch's own scale follows |

Couch's scales are Tailwind theme tokens (the `@theme` block "Couch's scales"
in `index.css`), and `cn` (`lib/utils.ts`) knows them, so `text-meta` merges
as a size and `h-control` as a height.

| Scale | Steps | Use |
| --- | --- | --- |
| Radius | `xs` .125rem, `sm` .25rem, `md` .5rem, `lg` .75rem, `xl` 1rem | what you press or type into is a capsule (`rounded-full`): buttons of every size, inputs, Select triggers, input groups, toggles, tabs, chips, the search field, Switch, a slider's thumb and track, progress; a tile's picture and a menu's or the palette's row `rounded-md`; a row's and the bar's thumbnail `rounded-sm`; a surface that opens over the page (menus, popovers, the palette, Select content, dialogs, Up next over the picture) `rounded-lg` |
| Control height | `control-sm` 1.75rem, `control` 2rem, `control-lg` 2.75rem, `field` 3rem | `size="sm"`; the default; the Stage's verbs (`size="lg"`); the header's search field. `touch:` raises each to 44px |
| Type | `caption` .75rem, `meta` .8125rem, `body` .9375rem, `title` 1.125rem, `heading` 1.25rem, `page` 2.25rem | [Scale](#scale) |
| Spacing | `caption` .125rem, `stack` .75rem, `item` 1rem, `section` 3.5rem | inside a caption; a heading to its content; between items; between sections |

**Focus inverts** the focused control to white with black ink, and the TV's
highlight is the same. White controls (slider, Switch, Checkbox,
RadioGroupItem) take a 2px foreground outline instead. Media is the exception:
a focused tile keeps its caption and rings its picture in white (2px, offset
3px), lit in its own colour, and the TV thickens the ring to 4px while it lifts
the tile 5% ([TV](design/tv.md)); a focused row's text inverts. A text link's
inversion reaches a little past its words (a shadow, so nothing moves).

**One hover language.** A pointer brightens; only the keys invert. Media
lights up: a pointer over a tile or a row makes its picture glow in its own
first colour (`--item-light`, read the first time a pointer or focus reaches
it; faint white until then) and brings its meta line up to white, over
300 ms; its "…" appears with it. Everything else brightens: ink comes up to
white (a ghost control or a toggle rests at 80% white and a press dims it to
60%), a fill steps up one notch (`secondary` to `fill-hover`; the white button
to 85%), and an outline's edge comes up. One whose panel is open
(`aria-expanded`) stays lit. Ink never turns dark under a pointer, and nothing
tints, dims, scales or moves: a press doesn't nudge, and links and the bar's
artwork keep their ink. Whatever a press acts on shows the hand, sliders
included (the arrow while disabled). Never on the TV, which lifts its focus
instead. The header's tabs mark the current section with a short white rule
under its name.

In menus, Selects and the palette the row under the pointer takes a quiet fill
(`accent`) with its ink unchanged, and only the row the keys reach inverts. A
Radix menu's or Select's row inverts only under `html[data-keyboard]` (Radix
focuses the pointer's row, which Chromium calls `:focus-visible`); the
palette's rows only while its list lacks `data-pointer`, which `HeaderSearch`
sets as a mouse moves over it and a key removes.

## Scale

`html` font size is `clamp(16px, 1.25vw, 24px)`, so rem sizes scale every
screen alike. Inter Tight throughout, regular but for headings and display
sizes (semibold) and the bar's title (medium); metadata small, muted and
tabular. `index.html` preloads its latin file, so the first paint is already
in it.

| Role | Classes |
| --- | --- |
| Stage title (`StageTitle`) | 4.5rem, 3.75rem past 22 characters, 3rem past 44 (Details 3.75rem / 2.75rem; phones 2.5rem to 1.75rem), semibold, leading .95, tracking −.035em |
| Now playing (audio), player title | `text-6xl` / `text-3xl` semibold, tight tracking |
| Page title (`PageHeader`) | `text-page font-semibold` (tracking −.025em) |
| Heading of a shelf, a list or a section (`ShelfHeading`) | `text-heading font-semibold` (tracking −.015em) |
| The bar's title, the palette's query row | `text-title font-medium` |
| Item title (tiles, rows), settings label, the search palette's rows | `text-body`, tiles and rows two lines |
| Up next's start times (a board line) | `text-base font-light tabular-nums` |
| Controls | `text-sm` (the Stage's verbs `text-body`) |
| Metadata | `text-meta text-muted-foreground` |
| Caption | `text-caption text-muted-foreground` |

The page gutter is `px-(--gutter)` (`clamp(1rem, 4vw, 3rem)`); the shell gives
the one top offset (`pt-8`), and a page's sections are `gap-section` apart.
Two-column pages (Saved, Settings) use a `12rem` rail and `gap-12`. Controls
are capsules, `h-control text-sm`; `touch:` (phones and windows narrower than
960px) raises them to 44px. Playback icon controls (transport, Volume, Where
it plays, Up next, Playback, fullscreen, Open player, Back, a Sheet's Close)
are one ghost `icon-lg` button with a 1.25rem glyph and a 44px target. The
player's band and the now-playing bar share `--player-target`, which grows to
2.25rem. At a row's end they pull back (`-ml-2.5`/`-mr-2.5`) so the glyph lines
up with the text. So does the verb that starts a header's second line on a phone, under the
full-width primary (`verbRow`).

## Motion

Things ease; nothing performs. One easing (`ease-out`, the default for every
`transition-*` in `index.css`) and two durations: 150 ms for what answers a
control, 200 ms for what arrives.

- Colour changes (hover, selection, the tab underline) ease both ways.
- Focus inversion arrives at once and fades out, so a held arrow never passes
  through grey.
- Menus and popovers grow from the button that opened them (a zoom from 90%,
  its origin at the trigger's centre: an arrow that draws nothing gives Radix
  the point), and leave at once so focus is back before the next key. Up next
  over the picture grows from its button the same way. Dialogs use shadcn's
  short fade and zoom. Sheets fade and rise (200 ms).
- Routes appear immediately with cached content; artwork fades only on a cold
  load; the player's bands fade together with the subtitles they lift.
- One spatial story for what plays: the now-playing bar grows into the player
  band with a view transition (`couch-player-band`, 320 ms), and the artwork
  travels with it (`couch-art`, 280 ms, ease-out): the bar's thumbnail becomes
  the player's artwork or its picture, and after Play on a Details page (the
  `couch-play` transition type) that page's artwork does. Only one element
  holds the name at a time. The bar's title and its line fade out at once
  rather than stretch over the band's timeline (`couch-bar-title`). These
  are view transitions, so they are composited snapshots, and reduced motion
  skips them.
- The light cross-fades over 600 ms when the artwork changes, the one slow
  move ([Light](#light)). Reduced motion swaps it at once, still lit.
- Media lights up over 300 ms (its glow, ease-out) and the Stage's light fades
  in with its picture; reduced motion lands both at once.
- No scroll entrances, staggers, springs or scaling tiles (but the TV's lifted
  focus), and no loops but one:
  the **level**, three bars that rise and fall while sound comes out
  (`Level`). It says the player's state, not the sound's loudness: it moves
  only while what plays is playing, and lies flat while paused, buffering or
  loading, as short thin bars that can't be read as a "…". It sits on the playing item's artwork (a black square in its
  bottom-left corner, only while sound comes out, since a paused chip read as a "…") wherever it is listed, in place of a playing track's
  number, after the now-playing bar's title while sound comes out, so the title never shifts (never on
  its thumbnail, where a corner chip read as a "…"; paused, the bar's Play
  glyph says so) and beside each device in Where it plays whose sound is in. Its bars move by transforms only. Reduced motion
  holds them still at three heights while it plays.
- New motion is `motion-safe:`; reduced motion stills everything.

## Components

shadcn components live in `src/client/components/ui` and are owned by Couch.
Changes from the Mira defaults: capsule `text-sm` controls at `h-control`
([Tokens](#tokens)), a flat left-rule `Alert`, a left-aligned borderless
`Empty`, no shadows, a 1.25rem glyph in `icon-lg`, Select items that reserve
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
  the page. `ContentBreadcrumb` is a content page's trail of ancestors.
- `SettingsRow` / `SettingsSection`: label and control on divided rows.
- `Stage` and `StageTitle` ([Stage](#stage)).
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
  ([Player](design/player.md)).
- `playbackStatus`: one status vocabulary for Home, the player, the
  now-playing bar, Remote and Up next. Its `quiet` states (Playing, Paused,
  Ready to play) are left to the Play/Pause glyph, so status lines show only
  loading, problems and the end.
- `RowMenu` (`useItemMenu`, `ItemMenu`): an item's one menu.

Custom compositions, and the gap each fills: `MediaTile`, `MediaRow`, `Stage`
and `DetailHeader` (the catalog has no media tile or header, and Card isn't flat);
`Shelf` as a plain overflow row (Carousel's arrow handling fights spatial
navigation); the timeline's hover readout (Slider has none); the Remote's pad
(no direction pad); toasts on sonner's `unstyled` option (its default surface
is bordered); release notes with `react-markdown` (GFM, no raw HTML; no
Markdown renderer); Search's kind and source lines, `SearchFilters`, on Toggle
Group and Button (a Select or tabs offer fixed choices; Search offers only what
its results hold, as it finds them).

### Messages

- **Toast** (sonner): errors, Undo, Queue confirmation and unexpected outcomes.
  Every toast is one of `src/client/toasts.ts`'s kinds (`failed`, `undo`,
  `queued`, `playing-on`, `notice`, `tap-to-hear`), each with a fixed duration
  and at most one action; a repeat updates the one showing. Routine actions,
  and playback activity from other devices, stay quiet. A new item or
  controlled device retires old Queue and Undo feedback; switching Couch
  clears all. Toasts are flat rows with Alert's left rule that hug their words,
  the action beside them, two at most: top right below the header (or the
  player's top band), and on phones at the bottom, just above the footer or the
  player's band, so they never cover the artwork at the top. A toast never takes focus:
  Up from the top of the page reaches the newest one's action, and any other
  key returns. The TV ignores pointer hover on them.
- **System notification**: only the desktop app's "Couch X is ready" when an
  update has downloaded, since it installs on quit.
- **Alert** for a persistent problem on the page (destructive, with Try again
  in `AlertAction`), when the problem is the page (a source's own home);
  sources that didn't answer beside others that did (Search, a Details page's
  neighbours) are one muted line at the end, `SourcesUnanswered`; **Empty** for empty states; a `Spinner` status line for
  work in progress.
- **Dialog** for short tasks (pairing, source setup), **AlertDialog** for
  confirmations, **Popover** for the player's menus and panels over the picture,
  the Couch switch and Where it plays on desktop, **Sheet** for longer panels
  (Where it plays on phones and the TV).

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
- [Player](design/player.md): the picture, scrims, the band, settings, Up next,
  status.
- [Where it plays](design/where-it-plays.md): the mixer and Play on.
- [TV](design/tv.md): what the TV adds for its remote.
- [Remote](design/remote.md): the Remote section and Type on TV.
- [Settings](design/settings.md): its pages and section nav.

`apps/web` (the couch.avoid.quest site) keeps its own pages.

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
- A surface's doc changes with its code.
