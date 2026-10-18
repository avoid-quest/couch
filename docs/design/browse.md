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
of their own, so theirs is an Empty with a search field scoped to them. Add
source sits at the heading's right; the TV hides it, as Home hides its shelves'
actions: its tab bar reaches Settings, and Down from the field meets the first
source.

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
on it; while it is disabled, or without one, the first verb you can press does. Seasons, episodes, tracks and nearby
items follow as divided MediaRows.

Home's tiles do one verb, so Details holds the others for everything Home
opens, where the item supports them:

- **History:** Resume or Play, From start, Queue, Save and Play on; "…" holds
  Remove from Continue. Save keeps the item's provider page in For later, and
  Saved takes it out; an item without a provider page has no Save.
- **For later:** Play, Queue and Play on; "…" holds Remove, with Undo, and on
  the TV Move up and Move down. It is already saved, so it has no Save.
- **A station:** Play, Queue, Save (a saved station) and Play on; "…" holds
  Open show page.
- **An Up next entry:** Play and Save.
- **A source's page:** Play, Play all or Resume, From start, Queue or Queue
  all, Save and Play on; "…" holds Play next.

## Live

Live (`/live`) shows the Radio browse (its sources, `radioSource`, `page` and
`filter`), then Live TV's channels (`group`, `channelPage`, `channelFilter`)
once a Live TV source has some. As section roots they carry no breadcrumb.

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

Library (`/library`) holds Saved's tabs (`?tab=`), in the section nav it shares
with Settings: [Settings](settings.md#section-nav).

## MediaRow / MediaList

Thumbnail, title, meta, length bar, one main verb
and actions revealed on hover or focus. Live, Search and Library. Every media
row ends with the same verbs (`BrowseActions`): a filled ▷ for Play, then one
"…" menu with Play on, Queue, Save and its other verbs.
On the TV a row is one focus stop: OK does its main verb (Play for stations,
channels and episodes, else Open), and its other verbs wait on its page.

For later's Details keeps Remove with Undo and Move up/down. Rows whose
destination does not hold every operation keep their existing Options and
ordering controls: saved channels/stations, Live TV, and search hits without
complete details actions. These exceptions preserve reachable operations
without adding destinations solely for a menu.

A live hit uses Play only while it is enabled; otherwise it retains its
original Open destination, including during a pending Save. Busy actions
keep their existing disabled state.

## MediaTile

One `Button` wrapping `MediaArtwork` (contained; 2:3 for films
and series, 1:1 for stations and albums, 16:9 for videos and episodes), a
title and one meta line, plus a `DurationBar` on Continue. It is one focus
stop whose press does the item's main verb. The catalog has no media tile
and Card breaks Flat, so a tile is the smallest Button composition. Shelves
(Home's) are plain overflow rows (`data-nav-row`):
Carousel's own arrow handling fights spatial navigation, and focus scrolls a
plain row into view.

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

The path above a collection or item (Search, then
the source, then the collection; a station's starts at Live). It replaces a Back control, so its
links are `text-sm`, the controls' size, rather than Mira's `text-xs`
caption size, and each is `min-h-11`, a 44px target on every screen.

The player's compact trail of the same links: [Player](player.md#player-header).

## Play on targets in menus

Play on targets sit in a labelled group inside search result menus, with device names that can wrap. A nested flyout left too little width on a 320–390px phone at larger interface sizes. Use the standard dropdown Group and Label, and bound long menus to the available viewport height so keyboard and touch can reach every target. The separate inline Play on menu uses the same target rows.

What Play on offers and confirms: [Where it plays](where-it-plays.md#play-on).
