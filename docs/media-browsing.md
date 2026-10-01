# Browsing around playback

Couch is a shared media library for the TV and its controllers. Find remains the
cross-source search. Opening a collection should make its place in the library
clear, keep its browsing position, and offer named destinations during playback.

## Design

Reuse the existing palette: black ground `#000000`, white ink `#ffffff`, muted
ink `#a3a3a3`, secondary surface `#171717`, popover `#0a0a0a`. Keep Inter Tight
for titles, body and controls. Artwork supplies the colour.

The breadcrumb is the navigation. Do not add a separate Back row or repeat the
same destinations below the title. Keep the existing 24px title scale, small
artwork beside the title even on phones, and divided media rows. Descriptions
are optional disclosure content rather than a large block above the list.

```text
Find / provider / series / season

Artwork    Season title     Play all  …
           About

24 episodes             Filter       ‹ 2 / 4 ›
------------------------------------------------
Episode artwork   Name and length       Play  …
------------------------------------------------
```

Playback keeps named series, season, album or radio destinations visible once.
Every item opens a full detail page, including inspection from playback and
Up next. Details offer the same breadcrumb; there is no item-detail dialog or
separate related-content sheet. Nearby items use four divided rows and a small
heading that links to the full list. Hide this section when there are no nearby
items. Browser history restores the collection page and scroll position.

Collection rows open details through their title; a small Play control stays
available, and secondary verbs use Couch's existing Dropdown Menu. The existing
Find results, action layout, and time ruler remain as they are. Use one compact
pager with Previous, "Page N of M" and Next in fixed slots, disabling unavailable directions.

Use the official shadcn [Breadcrumb](https://ui.shadcn.com/docs/components/radix/breadcrumb)
and [Pagination](https://ui.shadcn.com/docs/components/radix/pagination), together
with Couch's existing Button, Input, Select, Collapsible, Dropdown Menu and media
rows. The only extra composition is the provider-aware breadcrumb and browsing
toolbar; the catalog has no media-domain equivalent. Provider cursors are
opaque and do not report totals, so pagination only links to pages whose cursors
are known; it never invents a last page. Full season and album lists can be paged
locally. Relationships come from provider catalogues, with a fallback for older
StreamingCommunity episodes whose saved season URL already identifies the series.

## Live TV

Find > Browse lists Live TV only once a Live TV source has channels; there is
no preset. Its page uses the same breadcrumb (Find / Live TV), title, toolbar
and divided rows as a collection:

```text
Find / Live TV

Live TV

305 channels      All groups   Filter       ‹ 2 / 13 ›
------------------------------------------------------
Logo   Channel name                             ▷  …
       Now title · 21:00 Next title · Group
------------------------------------------------------
```

Rows are compact MediaRows with the channel logo as artwork. The meta line
carries what's on now and next from the XMLTV guide, and the group while no
group is picked. Play plays the channel; the menu offers Play on and Queue.
The group Select, Filter and page live in the route (`/find?browse=live-tv`),
so history restores them. A source without a guide still lists its channels.

## Stack

1. Retain programme and series hierarchy in provider results and playback metadata.
2. Add collection breadcrumbs, direct item links, filtering and route-backed pages.
3. Use full detail pages from playback and Up next, and keep nearby content,
   saved items and radio browsing compact.
