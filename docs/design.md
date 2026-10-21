# Couch design system

Couch is one app on three kinds of screen: the TV (a remote), a desktop window
(mouse and keyboard) and phones (touch). It looks media-led: black ground,
white ink, contained artwork, open typography and quiet dividers. The picture
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
  panels, shadows, gradients or blur; only the player's bands shade a picture,
  with a scrim.
- **One primary target per item, one menu.** Pressing a row or tile does its
  main verb; its other verbs are its one menu ([Menus](#menus)). Related
  channels, albums, series and stations are separate visible links, never
  nested in the target.
- **Real content only.** Browse pages show what a source returns; Couch picks
  nothing. Discover is built from what the Couch saved.
- **Content leads, time supports.** Title and artwork lead; runtime, progress
  and end times are small muted metadata. Live media shows no time and no
  label.
- **Colour only for danger.** Destructive red is the only colour.
- **Undo, not confirm**, for shared actions; destructive admin actions confirm
  inline or in an AlertDialog.
- **Disabled keeps its place.** A control that can't act stays in its slot at
  half ink (`disabled:opacity-50`); nothing shrinks or moves.

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
| `background` | `#000` | page, bars, sheets |
| `foreground` / `primary` | `#fff` | text, bars, primary button |
| `muted` / `secondary` | `#171717` | inputs, artwork placeholders |
| `muted-foreground` | `#a3a3a3` (white 85% in the player's bands) | metadata |
| `border` | white 16% | hairlines and row dividers |
| `accent` | `#fff` / `#000` | menu highlight (inverts like focus) |
| `radius` | `.25rem` | controls |

**Focus inverts** the focused control to white with black ink; it is the only
focus treatment, and the TV's only highlight. White controls (slider, Switch,
Checkbox, RadioGroupItem) take a 2px foreground outline instead; a tile's
caption inverts and its artwork takes a thin outline.

**Hover** is a white tint, never on the TV. A ghost button whose panel is open
(`aria-expanded`: Volume, Where it plays, Up next, Playback) keeps the tint.

## Scale

`html` font size is `clamp(16px, 1.25vw, 24px)`, so rem sizes scale every
screen alike. Inter Tight throughout; titles semibold with tight tracking,
metadata small, muted and tabular.

| Role | Classes |
| --- | --- |
| Hero, Now playing, Details | `text-3xl`–`text-5xl font-semibold tracking-tight` |
| Page title (`PageHeader`) | `text-3xl font-semibold tracking-tight` |
| Shelf title | `text-xl font-semibold tracking-tight` |
| Row title, settings label | `text-base` (media rows add `font-medium`) |
| Up next's start times (a board line) | `text-base font-light tabular-nums` |
| Body, controls, metadata | `text-sm` (metadata `text-muted-foreground`) |
| Caption | `text-xs text-muted-foreground` |

The page gutter is `px-(--gutter)` (`clamp(1rem, 4vw, 3rem)`); the shell gives
the one top offset (`pt-8`). Two-column pages (Saved, Settings) use a `12rem`
rail and `gap-12`. Controls are `h-8 text-sm`; `touch:` (phones and windows
narrower than 960px) raises them to 44px. Playback icon controls (transport,
Volume, Where it plays, Up next, Playback, fullscreen, Back, a Sheet's Close)
are one ghost `icon-lg` button with a 1.25rem glyph and a 44px target; at a
row's end they pull back (`-ml-2.5`/`-mr-2.5`) so the glyph lines up with the
text.

## Motion

Things ease; nothing performs. One easing (`ease-out`, the default for every
`transition-*` in `index.css`) and two durations: 150 ms for what answers a
control, 200 ms for what arrives.

- Colour changes (hover, selection, the tab underline) ease both ways.
- Focus inversion arrives at once and fades out, so a held arrow never passes
  through grey.
- Menus, popovers and dialogs use shadcn's short fade and zoom in, and leave at
  once so focus is back before the next key. Sheets fade and rise (200 ms).
- Routes appear immediately with cached content; artwork fades only on a cold
  load; the player's bands fade together with the subtitles they lift.
- The now-playing bar grows into the player band with a view transition
  (`couch-player-band`, 320 ms).
- No scroll entrances, staggers, springs or scaling tiles. New motion is
  `motion-safe:`; reduced motion stills everything.

## Components

shadcn components live in `src/client/components/ui` and are owned by Couch.
Changes from the Mira defaults: `text-sm` controls at `h-8`, a flat left-rule
`Alert`, a left-aligned borderless `Empty`, no shadows, a 1.25rem glyph in
`icon-lg`, Select items that reserve room for their check, and the open-state
hover tint on ghost buttons. Check the
[catalog](https://ui.shadcn.com/docs/components) before building anything
custom.

`Command` (cmdk) was added for the header search's palette
([Shell](design/shell.md#search-field)): a field that scopes a search and
suggests as you type needs a listbox the focus never leaves, which a menu or a
Popover over a field can't give a remote typing into it. Couch's copy has no
surface of its own (the header draws it), `h-8 text-sm` rows (44px on touch),
headings as the menus' labels, and a selected row that inverts like a menu's
highlight, at once. The field is Couch's own input as the combobox, not
`CommandInput`, so the TV's Type on TV and the `#media-search` hooks keep it.

Shared building blocks in `src/client/components`:

- `PageHeader`: a page's h1 with an optional back button or breadcrumb and
  actions; `hidden` keeps an `sr-only` h1 where the tab or rail already names
  the page. `ContentBreadcrumb` is a content page's trail of ancestors.
- `SettingsRow` / `SettingsSection`: label and control on divided rows.
- `Shelf` and `MediaTile`; `MediaRow` / `MediaList`; `MediaArtwork`
  ([Browse](design/browse.md#rows-and-tiles)).
- `DetailHeader`: an item or collection page's header
  ([Browse](design/browse.md#details)).
- `ContentFilters` (`FilterBar`, `FilterChoice`, `FilterSelect`, `FilterInput`)
  and `BrowsePagination` ([Browse](design/browse.md#filters-and-pages));
  Search's own `SearchFilters` ([Browse](design/browse.md#search)).
- `ContentLink` / `MediaContext`: relationship links with Back and focus
  restoration.
- `PlaybackTransport`, `PlaybackTimeline`, `VolumeButton`
  ([Player](design/player.md)).
- `playbackStatus`: one status vocabulary for Home, the player, the
  now-playing bar, Remote and Up next. Its `quiet` states (Playing, Paused,
  Ready to play) are left to the Play/Pause glyph, so status lines show only
  loading, problems and the end.
- `RowMenu` (`useItemMenu`, `ItemMenu`): an item's one menu.

Custom compositions, and the gap each fills: `MediaTile`, `MediaRow` and
`DetailHeader` (the catalog has no media tile or header, and Card isn't flat);
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
  clears all. Toasts are flat rows with Alert's left rule, top right below the
  header (or the player's top band), two at most. A toast never takes focus:
  Up from the top of the page reaches the newest one's action, and any other
  key returns. The TV ignores pointer hover on them.
- **System notification**: only the desktop app's "Couch X is ready" when an
  update has downloaded, since it installs on quit.
- **Alert** for a persistent problem on the page (destructive, with Try again
  in `AlertAction`); **Empty** for empty states; a `Spinner` status line for
  work in progress.
- **Dialog** for short tasks (pairing, source setup), **AlertDialog** for
  confirmations, **Sheet** for player panels, **Popover** for the Couch switch
  and Where it plays on desktop.

## Menus

One item, one menu: a controlled shadcn Dropdown Menu fed one verb list
(`useItemMenu` / `ItemMenu` in `RowMenu.tsx`), opened in one place whatever
opened it.

| Input | Opens the menu |
| --- | --- |
| Pointer | The "…" (always shown); right-click |
| Touch | The "…"; a 500 ms long press |
| Keyboard | The "…" (a Tab stop); the menu key or Shift+F10 on the item |
| TV remote | OK held 500 ms (a short OK acts on release); Right to a row's "…" |
| Remote section | OK held on the pad, sent as a held OK |

Keyboard and remote land on the first verb; Esc and Back return focus to the
opener. A verb that removes its item leaves focus on the neighbour.

## Copy

Sentence case, short, no filler: say what happened and what to do next.
Shared strings live in `src/client/copy.ts` (`Try again`, `Only an admin can
change this.`, `Offline. Reconnecting to {name}…`). Couch's own words: a
device's name (or "This device"), Where it plays, Move here, Play on {name},
Remote, Share on network, admin, Up next (the list) and Queue (the verb),
Save / Saved, Discover. Verbs are the same everywhere: Play, Pause, Stop,
Next, Play next, Queue, Save, Open, Resume, From start, Remove, Hide.

## Surfaces

- [Shell](design/shell.md): sections and paths, the header and search, tab
  bars, the Couch switch, the now-playing bar, keyboard, first run.
- [Home](design/home.md): the hero and shelves.
- [Browse](design/browse.md): Search, Discover, Hide, Details, Saved, rows and
  tiles, filters and pages, breadcrumbs.
- [Player](design/player.md): the band, transport, timeline, Up next.
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
