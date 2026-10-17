# Browsing around playback

Couch is a shared media library for the TV and its controllers. Search remains the
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
Search / provider / series / season

Artwork    Season title     Play all  …
           About

24 episodes             Filter       ‹ 2 / 4 ›
------------------------------------------------
Episode artwork   Name and length
------------------------------------------------
```

Library items open a full detail page, including inspection from playback and
Up next. Details offer the same breadcrumb; there is no item-detail dialog or
separate related-content sheet. Nearby items use four divided rows and a small
heading that links to the full list. Hide this section when there are no nearby
items. Browser history restores the collection page and scroll position.

Collection rows are one target that opens details; their other verbs, Play
included, wait in the row's menu ([Menus](design.md#menus)). The existing
Search results, action layout, and time ruler remain as they are. Use one compact
pager with Previous, "Page N of M" and Next in fixed slots, disabling unavailable directions.

Use the official shadcn [Breadcrumb](https://ui.shadcn.com/docs/components/radix/breadcrumb)
and [Pagination](https://ui.shadcn.com/docs/components/radix/pagination), together
with Couch's existing Button, Input, Select, Collapsible, Dropdown Menu
and media rows. The only extra composition is the provider-aware breadcrumb and browsing
toolbar; the catalog has no media-domain equivalent. Provider cursors are
opaque and do not report totals, so pagination only links to pages whose cursors
are known; it never invents a last page. Full season and album lists can be paged
locally. Relationships come from provider catalogues, with a fallback for older
StreamingCommunity episodes whose saved season URL already identifies the series.

## Live TV

Live lists Live TV's channels below its radio stations only once a Live TV
source has channels; there is no preset. They use the same title, toolbar and
divided rows as a collection:

```text
Live TV

305 channels      All groups   Filter       ‹ 2 / 13 ›
------------------------------------------------------
Logo   Channel name
       Now title · 21:00 Next title · Group
------------------------------------------------------
```

Rows are compact MediaRows with the channel logo as artwork. The meta line
carries what's on now and next from the XMLTV guide, and the group while no
group is picked. Pressing the row plays the channel; its menu (its "…", right-click,
a long press or a held OK) offers Play on and Queue.
The group Select, Filter and page live in the route (`/live?group=…&channelFilter=…&channelPage=…`),
so history restores them. A source without a guide still lists its channels.

## Shared sources

A device's live input uses the same Search source rows, search results and Play on
menu as other media. Configure capture in Settings → This device → Sharing.
Capture always belongs to the device running that form, including for paired users
without administrator access. It reuses the existing shadcn Select and Field controls.

Active inputs appear as rows in Search's Sources list and in search results, under
the Shared sources source filter and the Live kind filter. Playback uses the same Now
Playing page, now-playing bar, Playback settings, Up next and Where it plays controls
as TV and radio. The usual picture stage displays video; audio-only inputs use
the usual artwork stage. There is no separate live player or visualizer.

Transport controls depend on media capabilities. A live stream without a seek
window shows Live and disables Pause, while retry and Next use the ordinary
player actions. Captured entries are temporary, so they have no persistent
details page or Save for later action. Other items can still be queued, played
and saved while capture is active.

A small Stop sharing action stays available throughout browsing while local
capture is active. There is no separate capture panel on the Search landing page.
Every receiving device gets the input over WebRTC in the normal player. With
**In sync** on in Where it plays, the input reaches the normal player as HLS
instead; sound uses the existing Sendspin clock and pictures follow it, and that
shared delivery buffer adds delay between capture and output. See [live inputs](live-inputs.md) for
capture options, playback limits and physical synchronization checks.

## Stack

1. Retain programme and series hierarchy in provider results and playback metadata.
2. Add collection breadcrumbs, direct item links, filtering and route-backed pages.
3. Use full detail pages from playback and Up next, and keep nearby content,
   saved items and radio browsing compact.
