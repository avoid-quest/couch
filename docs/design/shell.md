# Shell

## Sections

| Section | Path | Holds |
| --- | --- | --- |
| Home | `/` | one hero (what plays now, else what to continue, else what's on air), then shelves |
| Discover | `/discover` | what's on air, Live TV while a source has channels, a shelf from each source's own home, then the sources that start from a search ([Browse](browse.md#discover)) |
| Saved | `/saved` | For later, Channels & stations, Lists and Played (`?tab=`) |
| Remote | `/remote` | drives a TV; on non-TV devices while the Couch has one (`DeviceSummary.tv`, online or not) |
| Settings | `/settings` | the device's and the Couch's pages |

Search is no tab: it is the header's field, and its results are `/search?q=…`
([Browse](browse.md#search)). An empty query is Discover, so `/search` without
one opens `/discover`. Discover has two pages of its own, every station
(`/discover/radio`) and every Live TV channel (`/discover/live-tv`), which
its shelves' headings open.

`/item` and `/collection` belong to the section that opened them: their
URL carries it as `from` (`home`, `discover`, `search` or `saved`), so the tab,
the breadcrumb and a refresh keep it, and moving between details passes it
on. A row's or tile's link carries it too, so a new tab opens in the same
section. Without one, a page belongs to Discover, where the sources and the
stations are. `/now` is the player. Where it plays has no page: it is the
picker, a Sheet ([Where it plays](where-it-plays.md#the-picker)).
Earlier addresses redirect and keep their query, as `settingsAliases` does
for Settings: `/live` opens `/discover`; `/library` opens `/saved` on the
same tab; `/find` opens `/search`, and `/find?browse=radio` and
`/find?browse=live-tv` open Discover's Radio and Live TV pages; and
`/where-it-plays`, its former overview, opens Home. Core serves every path in
`src/shared/page-paths.ts`, the earlier ones included, so bookmarks reach
their redirects.

## Header and section nav

One header on every screen, on a three-column grid: at the left, the Couch
switch in muted ink (the TV names itself there instead,
as plain muted text, since it has no switch); in the middle, centred text
tabs (Home, Discover, Saved, then Remote while the Couch has a TV, then
Settings); at the right, Stop sharing while this device shares its screen or
sound (the player's top band keeps it:
[Player](player.md#stop-sharing-stays-on-screen)), then the search field,
then the clock. The current tab names the page, so section roots carry no
visible title of their own. The current tab is underlined; a focused tab
inverts, as every control does.

The header is sticky: it stays at the top on the page's solid ground while
the page scrolls under it, and the player hides it. It publishes its height
as `--top-bar` (`useTopBar`, as the footer publishes `--bottom-bar`), and the
page's scroll padding clears it by that and a rem, so a focused tile is never
under it. On the TV, Up from a page's first row still reaches it
([TV](tv.md#every-journey-step-works-with-a-remote)).

The Couch switch and the TV's plain name stand alone at the page gutter; the
header carries no brand mark.

**Search** is `HeaderSearch`: shadcn `InputGroup` with a lucide Search icon and
the placeholder "Search", up to 16rem wide. `/` focuses it from any page
(from the player, its page comes back first). Typing searches after a second
without typing, and Enter at once: the first search from another page opens
`/search?q=…`, later ones replace it, and focus stays in the field while
typing (Enter goes on to the results; Down reaches the page's first result).
Off the TV, Esc clears the field, which is Discover, then leaves it; the TV's
Back stays Back. On the results page, a key typed outside a control goes on
with the query (type-to-search), so letters and digits are no shortcuts
there. It is the TV's Search field too: a remote reaches it with arrows like
any other header control, and a phone's Remote types into it
([Type on TV](remote.md#type-on-tv)).

Input exceptions:

- **Keyboard:** the desktop puts Keyboard shortcuts (outside Remote) just
  before the clock; the TV, phones and Remote have none.
- **Touch** (`touch:`, phones and windows below 960px): the tabs move to a
  bottom tab bar for thumb reach (Home, Discover, Saved, Remote while the
  Couch has a TV, then Settings), each a lucide icon (House, Compass, Bookmark,
  Tv, Settings) over its label. Five equal-width tabs fit 390px; without a TV
  there are four. The top bar is a row: the Couch switch at the left, then
  the search field, which takes the room left (it fits 390px with a long
  name, which truncates). Settings is in the bottom bar; the clock is hidden. A narrow TV has no touch, so `tv:` undoes `touch:` and it keeps
  its grid, tabs and clock.
- **The Mac window:** its buttons and the region that drags it live in the
  header; the search field, like every control there, takes its clicks back
  (`[data-window-controls]` in `index.css`).

The header and the phone tab bar render the same `SectionTabs`.

## Couch switch

It sits where the TV names itself, muted like that name, and its Popover
opens from the left. The Popover reuses Settings → Couch connection's
choice: saved servers, the app's This computer option, and another address.
On the host with sharing on, it ends with Pair a device. It scrolls within
the available space and keeps the same flat, divided settings rows.

Where it plays after a switch: [Where it plays](where-it-plays.md#switching-servers).

## Now-playing bar

`NowPlayingBar` is one row above the page, and above the phone tab bar. Its
artwork and title ("Open player: …") open the player; the row underneath
names the radio or collection (a link), the status and, below `lg`, the time.
The bar then carries the band's controls in its order: Play/Pause, Stop and
Next, the timeline or "Live", Volume, Where it plays and Up next. Phones, for
their width and reach, keep Play/Pause and Where it plays; the player keeps
the rest. It
hides on the player and on Remote, and grows into the player band
(`couch-player-band`) and back.

The bar and the phone tab bar share the shell's footer, whose height is
`--bottom-bar`: scroll padding clears it, and the player band publishes its
own. Toasts sit at the top right ([Design](../design.md)). Transport details: [Player](player.md#the-player-is-one-tap-away).

## Browsing stays grounded

The header and scroll edges share the solid black page background. Native video alone clears
its full-screen ancestors so the picture can show through. A page fades in under the header as it
arrives, which the player doesn't: its band grows from the now-playing bar ([Motion](../design.md#motion)).

## A picture you start opens the player

When Play, Resume or Play on, from
any Device, starts an item with a picture on this Device, this Device opens
its player from whatever page it shows, so video never plays unseen. Up next
moving on, by itself or with Next, keeps the page, and so does audio-only
media (radio, music), which Home's hero and the now-playing bar carry. The
first sync after a reload keeps the requested page. Back on Home does
nothing; it never reopens the player.

## Keyboard control stays inside Couch

TanStack Hotkeys shares shortcuts
between the browser and desktop window; Electron global shortcuts would also
claim keys outside the app. The header's Keyboard shortcuts dialog is the
user-facing reference: shortcuts work in the player, and while browsing. Keep
transport shortcuts aligned with visible control capabilities, preserve
the results page's type-to-search, and let open panels, text entry, focused
controls and TV navigation own their keys. H and S open Home and Saved, `/`
focuses the header's search field.

Space and the player's arrows (`backgroundOnly`) act only when focus isn't on
a control: with nothing focused, or on a focus target with `tabindex="-1"`,
such as the player's picture, which holds focus when the player opens
([Player](player.md#the-picture-holds-the-keys)), or a page's heading. Off the
TV, arrows on the picture stay with its shortcuts and never move focus, even
where they can't act (live media can't seek).

## First run names the computer

The app asks "Where is your Couch?" (This
computer hosts it; Another Couch joins one, and this computer still plays),
then asks for its name once, with the random default shown, and whether to
share it on the network; Back returns to the choice. Pairing and later
servers reuse that name, in browsers too; a browser that switches to a new
Couch finds it filled in on the pairing form. Renaming and pairings later:
[Settings](settings.md#names-pairings-and-roles).

Unpaired browsers see only the pairing page: no sections
that would lead back to it. The pairing dialog warns that browsers flag
Couch's own certificate once, and closes itself when a device pairs, with a
toast that names it ("Phone paired · admin").
