# Browsing around playback

Couch is a shared media library for the TV and its controllers. Find remains the
cross-source search. Opening a collection should make its place in the library
clear, keep its browsing position, and offer named destinations during playback.

## Design

Reuse the existing palette: black ground `#000000`, white ink `#ffffff`, muted
ink `#a3a3a3`, secondary surface `#171717`, popover `#0a0a0a`. Keep Inter Tight
for titles, body and controls. Artwork supplies the colour.

The content title is the anchor. Align copy and controls to the left, leave room
around artwork, and use divided media rows rather than enclosing panels.

```text
Back       Find / provider / series / season

Artwork    Season title
           Description
           Play all   Queue all   Save

Episodes                         Filter this list
Previous    Page 2    Next
------------------------------------------------
Episode artwork   Name and length   Play / Queue
------------------------------------------------
Previous    Page 2    Next
```

Playback keeps named series, season, album or radio destinations visible. Details
offer the same path, so navigation does not depend on remembering where playback
started. Browser history restores the collection page and scroll position.

The initial idea reused the search time ruler for collections. That hides the
sequence of episodes and tracks, so collection browsing instead uses ordinary
lengths and numbered pages. The find-results ruler remains as it is.

Use the official shadcn [Breadcrumb](https://ui.shadcn.com/docs/components/radix/breadcrumb)
and [Pagination](https://ui.shadcn.com/docs/components/radix/pagination), together
with Couch's existing Button, Input, Select and media rows. Provider cursors are
opaque and do not report totals, so pagination only links to pages whose cursors
are known; it never invents a last page. Full season and album lists can be paged
locally. Relationships come from provider catalogues, with a fallback for older
StreamingCommunity episodes whose saved season URL already identifies the series.

## Stack

1. Retain programme and series hierarchy in provider results and playback metadata.
2. Add collection breadcrumbs, direct item links, filtering and route-backed pages.
3. Expose collection links and nearby content from playback, saved items and radio.
