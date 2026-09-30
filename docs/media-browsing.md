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
Details offer the same breadcrumb. Nearby items use a small list with one title
and one link to the full list. Browser history restores the collection page and
scroll position.

Collection rows open details through their title; a small Play control stays
available, and secondary verbs use Couch's existing Dropdown Menu. The existing
Find results, action layout, and time ruler remain as they are. Use one compact
pager and omit unavailable directions rather than drawing disabled controls.

Use the official shadcn [Breadcrumb](https://ui.shadcn.com/docs/components/radix/breadcrumb)
and [Pagination](https://ui.shadcn.com/docs/components/radix/pagination), together
with Couch's existing Button, Input, Select, Collapsible, Dropdown Menu and media
rows. The only extra composition is the provider-aware breadcrumb and browsing
toolbar; the catalog has no media-domain equivalent. Provider cursors are
opaque and do not report totals, so pagination only links to pages whose cursors
are known; it never invents a last page. Full season and album lists can be paged
locally. Relationships come from provider catalogues, with a fallback for older
StreamingCommunity episodes whose saved season URL already identifies the series.

## Stack

1. Retain programme and series hierarchy in provider results and playback metadata.
2. Add collection breadcrumbs, direct item links, filtering and route-backed pages.
3. Expose collection links and nearby content from playback, saved items and radio.
