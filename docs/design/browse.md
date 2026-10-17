# Browse

## Search

Search (`/search`) leads with its display-size field. It searches after one
second without typing; Enter submits immediately. Its filters, From, What
(Video, Music, Live, Radio and Channels) and Length, follow the field: a rail
beside the results on wide screens, behind Filters on narrow ones. Music
includes Bandcamp albums and tracks and SoundCloud tracks. A pasted link opens
as a webpage or as direct media, with Open page for a source's own link. On the
TV the field says "Type with Remote on your phone", and Remote's
[Type on TV](remote.md#type-on-tv) fills it.

Before a query, Search lists its Sources as divided rows: shared inputs, then
YouTube, Twitch, RaiPlay, StreamingCommunity, 123MoviesFree, Bandcamp and
SoundCloud, video before music. Each row opens that source's own home
(`/collection?provider=…`). YouTube, Bandcamp and SoundCloud have no home page
of their own, so theirs is an Empty with a search field scoped to them. The
heading has no action, as Home's shelves have none: the tabs reach Settings →
Sources and This device → Sharing, which add sources, and Down from the field
meets the first source.

## Details

Item pages (`/item`: History, For later, a station, an Up next entry) and
collection pages (`/collection`: a source's home, a series, season, album,
channel, film or episode) open on one header, `DetailHeader`, laid out like
Home's hero: contained artwork at the left at its own aspect ratio (stacked
above it below `md`), the title at display size, one muted meta line, a
`DurationBar` when the length is known ("Resume at …" once partly watched),
the synopsis, then one row of verbs. A page without artwork has no artwork
column. The catalog has no media header and Card breaks Flat, so it is a plain
composition of Button and DropdownMenu, like Home's hero.

The row holds, in order: Play (Play all for a list; Resume, with From start
beside it, once partly watched), Queue (Queue all), Save or Saved, Play on
while another device can play it, then one "…" menu for the rest. Each verb is
one focus stop. The primary verb carries `data-page-first`, so the page starts
on it; while it is disabled, or without one, the first verb you can press does.
A header without verbs, such as a source's home, leaves the page to its first
tile or row, or to the scoped search field where a source has no home page of
its own, never to the breadcrumb. Seasons, episodes, tracks and nearby
items follow as divided MediaRows.

Details holds every verb for everything Home opens, where the item supports
them; a Home tile's menu holds the row of verbs, and reaches Details for the
"…" verbs ([MediaTile](#mediatile)):

- **History:** Resume or Play, From start, Queue, Save and Play on; "…" holds
  Remove from Continue. Save keeps the item's provider page in For later, and
  Saved takes it out; an item without a provider page has no Save.
- **For later:** Play, Queue and Play on; "…" holds Move up, Move down and
  Remove, with Undo. It is already saved, so it has no Save.
- **A station:** Play, Queue, Save or Saved (its favourite, the toggle its
  tiles' menus share) and Play on; "…" holds Open show page.
- **An Up next entry:** Play and Save.
- **A source's page:** Play, Play all or Resume, From start, Queue or Queue
  all, Save and Play on; "…" holds Play next.

## Live

Live (`/live`) is one page in three parts, each under a section heading, as
Home's shelves are:

- **On air:** a shelf of `MediaTile`s, the saved stations first, then the
  built-in ones. Each tile reads the station and its current show; the
  heading already says they're on air, so a tile doesn't repeat "Live". A
  show's `expiresAt` is when its data refreshes, not when it ends, so there
  is no "until" time. A tile plays its station. Home's
  Radio shelf builds the same list (`useOnAir`, with Home's recents first).
  The shelf waits for the shows, so no tile grows a line under the focus,
  then keeps its order while Live stays open, as Home's shelves do. Its first
  tile carries `data-page-first`. If the saved or built-in stations fail to
  load, "Couldn't load On air." follows it with Try again; shows that fail to
  load only leave the tiles without a show.
- **Stations:** every station, as the Radio browse was: its source choice
  (`radioSource`), count, Filter (`filter`) and pager (`page`).
- **Channels:** Live TV's channels (`group`, `channelPage`, `channelFilter`),
  only while a Live TV source has some. If the sources fail to load, "Couldn't
  load Live TV." stands in for them, with Try again.

Not yet: a programme grid, and any Core endpoint it would need; it waits
for a source that needs one. As a
section root Live carries no breadcrumb.

## Keep discovery context visible

Opened shows, seasons and albums retain
a contained cover and a short synopsis above their divided rows; a film or
episode shows its synopsis under its title, never an empty About. Episode
rows use their own descriptions when available; a show synopsis stays with
the collection instead of pretending to describe each episode. A partly
watched item's primary verb is Resume, with From start beside it. A series
offers Play or Resume of its next episode, and with one season its episodes
are on its own page. A detail page ends with its own content and never
appends the source's catalogue. Posters and album art stay uncropped. This
extends the existing shadcn Item-based MediaRow; no additional preview panel
or per-result request is needed.

Source results
pair artwork with available synopsis and episode metadata; collection
headers contain their artwork instead of cropping covers. A collection
without artwork shows a muted folder, not title initials.

## Details are destinations

Item details and provider collections have
their own URLs, resolved from stable item IDs or canonical provider URLs.
Refresh loads the same content; Back restores the previous page, filters,
scroll and focus. A provider search result's title opens its details; Play is
a separate, explicit action, including on phones. StreamingCommunity's
collections say Series or Season rather than List. Reuse PageHeader and existing media rows. Dialogs remain
reserved for focused tasks such as pairing and source setup.

## Library

Library (`/library`) holds what you keep, one section per `?tab=`: For later,
Channels & stations (saved channels, playlists and stations), Lists, and
Played. The sections sit in the section nav Library shares with Settings, a
rail on wide screens and a Select on phones: [Settings](settings.md#section-nav).

Played (`?tab=played`) lists History, newest first, as divided MediaRows with
their length bar ("Resume at …" once partly watched). Each row's one verb opens
its History Details, which holds the others and Remove from Continue with Undo;
the rows have no menu.
Removing from For later or Channels & stations says "Removed … from Library."

## MediaRow / MediaList

Thumbnail, title, meta and length bar, as one target on every screen: pressing
the row (its artwork too, for a pointer) does its main verb, Play for stations,
channels and live hits, else Open or Details. Live, Search and Library, and Up
next's compact rows. Its other verbs (Play, Play on, Play next, Queue, Save,
Move up, Move down, Remove, and Open where a live hit's press plays) are one list, `MediaRow`'s `menu`: the
row's one menu ([Menus](../design.md#menus)), behind a "…" at the end of the
main verb's line on every screen, centred on the row's text.

A row whose page holds every verb in its menu shows no "…" (`menuOnPage`),
though right-click, a long press and a held OK still open the menu from the
row: For later's rows (Details keeps Remove with Undo and Move up/down), Lists'
rows (a list's page holds Play, Play on and Queue) and search hits that open a
collection (whose page holds Save). Every other row keeps its "…": saved
channels and stations (a station's page holds no ordering or Remove), Live TV
(a channel has no page), stations, live hits and videos with Play next among
search hits, shared inputs, and Up next's entries, whose page holds only Play
and Save. A list's own entries have no main verb, so they keep Remove and
their drag handle on the row on every screen.

The menu is shadcn's Dropdown Menu, adjusted to Clock: a hairline border and
no shadow, `text-sm` items at `h-8` (44px under `touch:`) that invert when
highlighted.

A live hit uses Play only while it is enabled; otherwise it retains its
original Open destination, including during a pending Save. Busy actions
keep their existing disabled state.

## MediaTile

One `Button` wrapping `MediaArtwork` (contained; 2:3 for films
and series, 1:1 for stations and albums, 16:9 for videos and episodes), a
title and one meta line, plus a `DurationBar` on Continue. It is one focus
stop whose press does the item's main verb. The catalog has no media tile
and Card breaks Flat, so a tile is the smallest Button composition. `--tile-art`
sets its artwork's height (11rem), so the "…" finds the title's line.

Its other verbs are its one menu ([Menus](../design.md#menus)), behind a "…"
over the end of the title's first line, which leaves it room, with its dots
flush with the text. The "…" can't sit inside the tile's button, so it is a
sibling laid over the caption, the line's height so the tile grows no taller,
and it inverts with the focused caption; on touch a larger hit area makes its
44px target. On the TV it is no focus stop, unless the press is disabled (nothing
can play): then it is the tile's one stop, so its menu stays in reach. A tile's menu holds its Details'
verbs, with Details first where the press plays:

- **Continue** (press resumes): Details, From start, Queue, Play on. Its
  sibling Details button stays, so a remote reaches History's verbs without a
  held OK.
- **Played recently** (press opens Details): Resume or Play, From start,
  Queue, Play on.
- **For later** (press opens Details): Play, Queue, Play on.
- **A station** (Home's Radio and Live's On air; press plays): Details, Queue,
  Save or Saved, Play on. A station played from a link may be in no list, so
  its tile is where it can be saved.
- **An Up next entry** (press plays it now): its Up next row's verbs.
- **A source's poster** (press opens it): its search hit's verbs.

Shelves
(`Shelf`: Home's, and Live's On air) are plain overflow rows (`data-nav-row`):
Carousel's own arrow handling fights spatial navigation, and focus scrolls a
plain row into view. On air's tiles take the shelf's height, so a station
without a show stays level with the rest: a shorter tile's centre sits higher,
and Up from its neighbour would pick it before the tab bar.

## BrowsePagination

Collection and radio lists keep count and Filter in fixed
slots. Remote or multiple-page collections show Previous, "Page N of M" and
Next, disabled when they can't move. A complete local collection on one page
omits the inert pager, including a single season's episodes and a short list
of seasons; its count still identifies the content. The page Select's trigger is
borderless and transparent, in muted ink: it reads as the pager's
"Page N of M" text between two ghost icon buttons, as shadcn Pagination's
links do, and a bordered field there would be a panel inside the pager.

## ContentBreadcrumb

The path above a collection or item: the section the page belongs to (its
tab: [Shell](shell.md#sections)), then the source, then the collection. It replaces a Back control, so its
links are `text-sm`, the controls' size, rather than Mira's `text-xs`
caption size, and each is `min-h-11`, a 44px target on every screen.

## Play on targets in menus

Play on targets sit in a labelled group inside row menus, with device names that can wrap. A nested flyout left too little width on a 320–390px phone at larger interface sizes. Use the menu's standard Group and Label, and bound long menus to the available viewport height so keyboard and touch can reach every target. The separate inline Play on menu uses the same target rows.

What Play on offers and confirms: [Where it plays](where-it-plays.md#play-on).
