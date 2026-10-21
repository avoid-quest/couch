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

One header groups the Couch identity and section navigation at the left, with
search and sharing controls at the right. A quiet bottom divider separates it
from content. Desktop and phone omit the clock; TV retains a small clock.
Discover, Saved, Settings and Remote carry clear page titles. Home leads with
its media hero. The current tab is underlined; a focused tab
inverts, as every control does.

While sharing, the search keeps at least 11rem and the right column can take
space from the left, moving the tabs only as much as needed. Below `xl`,
the sharing status gives up "Sharing screen" (or sound) before the search
gives up that width. On a phone (below `sm`) the status is one icon control,
lucide Radio (a broadcast: one glyph for screen, system audio and microphone,
where ScreenShare would misname sound; Couch draws no other live glyph, as
Live is a word), labelled and titled "Sharing screen · Show sharing controls" (or
"Sharing system audio", "Sharing microphone"), so a pointer's hover and a
screen reader read the state. Touch has no hover, so pressing it opens a
Popover with the status and Stop sharing, its one action; on a phone a stray
tap beside the search then never ends sharing for every receiver. Below `sm`
the search also keeps no minimum: it gives way to the icon so the Couch name
at the left stays readable. Without sharing, the columns and search keep their
usual widths. The sharing control and its popover stay local to the publishing
device: a TV’s own remote can use them; another device’s Remote cannot.

Below `lg`, a TV keeps the name, search, sharing control and clock on the first
row and centres its tabs on a second row. Search keeps 11rem so Largest text
and a narrow TV do not collapse its input or overlap the clock.

The header is sticky: it stays at the top on the page's solid ground while
the page scrolls under it, and the player hides it. It publishes its height
as `--top-bar` (`useTopBar`, as the footer publishes `--bottom-bar`), and the
page's scroll padding clears it by that and a rem, so a focused tile is never
under it. On the TV, Up from a page's first row still reaches it
([TV](tv.md#every-journey-step-works-with-a-remote)).

**Search** is `HeaderSearch`: shadcn `InputGroup` at the tabs' `text-base`,
with a muted lucide Search submit button and "Search" placeholder, up to 16rem wide.
It uses a quiet filled background so search is easy to find. Focus inverts
the field to white with black ink and caret, including on TV.
A fine pointer on a wide layout sees shadcn `Kbd`'s `/` hint while it is empty and unfocused
(off the TV). A Spinner replaces the Search button's icon while the submitted
query's sources answer. The button keeps its accessible name and remains usable.
The Search and clear buttons have 44px touch targets. The field never changes
width on focus, so the surrounding header stays still. `/` focuses it from any page
(from the player, its page comes back first). Typing, pasting, type-to-search and
remote text edits stay local until Enter or Search submits. IME confirmation
only commits text; a subsequent Enter submits it. Editing never changes the
route, starts provider requests or records a recent query. Route navigation
restores the route's query in the field.

Empty and focused, the field lists the last eight queries submitted through it on
this Couch (`search-recents.ts`, per installation, like radio recents) as
divided rows under it, inside the header so a remote reaches them: Down walks
them, Up returns to the field, a press searches at once. A source without a
home of its own (Discover's YouTube, Bandcamp and SoundCloud) scopes the field
to itself (`scopeSearch`): its placeholder reads "Search YouTube" and the
next query carries that source, so there is one search field, never two. On
a results page, Enter in the field plays the closest match when its press plays (a station,
a live stream); otherwise it moves focus to it. Search with an unchanged query
only moves focus to the result, including when the button is activated with a keyboard.
The first search from another page opens
`/search?q=…`, later ones replace it, and focus stays in the field while
typing (Enter or Search goes on to the results; Down reaches the page's first result).
Off the TV, Esc clears the field, which is Discover, then leaves it; the TV's
Back stays Back. On the results page, a key typed outside a control goes on
with the query (type-to-search), so letters and digits are no shortcuts
there. It is the TV's Search field too: a remote reaches it with arrows like
any other header control, and a phone's Remote types into it
([Type on TV](remote.md#type-on-tv)).

Input exceptions:

- **Keyboard:** the desktop puts Keyboard shortcuts (outside Remote) at
  the end of the header’s right group; the TV, phones and Remote have none.
- **Touch** (`touch:`, phones and windows below 960px): the tabs move to a
  bottom tab bar for thumb reach (Home, Discover, Saved, Remote while the
  Couch has a TV, then Settings), each a lucide icon (House, Compass, Bookmark,
  Tv, Settings) over its label. Five equal-width tabs fit 390px; without a TV
  there are four. The current tab's rule sits at the bar's top edge, where
  the bar meets the page. The top bar is a row: the Couch switch at the left, then
  the search field, which takes the room left (it fits 390px with a long
  name, which truncates); phones show no clock. A narrow TV has no touch, so
  `tv:` undoes `touch:` and it keeps its grid, tabs and clock.
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
names the radio (a link to Discover's every station, as Home's Radio shelf
heading is) or collection (a link), the status and, below `lg`, the time.
The bar then carries the band's controls in its order: Play/Pause, Stop and
Next, the timeline or "Live", Volume, Where it plays and Up next. Phones, for
their width and reach, keep Play/Pause and Where it plays; the player keeps
the rest. It
hides on the player and on Remote, and grows into the player band
(`couch-player-band`) and back.
The bar follows the presented route, so each transition snapshot contains
only the bar or the player band, even while the URL is already changing.

The bar and the phone tab bar share the shell's footer, whose height is
`--bottom-bar`: scroll padding clears it, and the player band publishes its
own. Toasts sit at the top right ([Design](../design.md)). Transport details: [Player](player.md#the-player-is-one-tap-away).

## Browsing stays grounded

The header and scroll edges share the solid black page background. Native video alone clears
its full-screen ancestors so the picture can show through. Pages appear immediately under the header, preserving cached content. The player's band grows from the now-playing bar ([Motion](../design.md#motion)).

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

Native text commands stay native: prose can be selected and copied; fields
keep cut, paste, select all, undo, redo and modified caret/selection keys.
Buttons and media actions retain their intentional nonselectable labels and
touch/TV hold menus. Shift+arrows and arrows in editable text or native media
controls never move spatial focus; selected prose keeps its arrow keys too.
Search uses plain Down to enter results, leaving modified Down in the field.

Desktop history is separate from the TV's contextual Back: the app's History
menu uses Chromium's history (including router entries), with Cmd+[ / Cmd+]
on macOS and Alt+Left / Alt+Right on Windows/Linux. Mouse back/forward commands
use that history too. BrowserBack stays native off the TV; Esc keeps Couch's
panel/page behavior. All desktop platforms have Electron's native Edit menu.
Off the TV, horizontal overscroll stays enabled for browser back/forward gestures, while
vertical overscroll stays suppressed. The Mac app supports both Electron's discrete
three-finger swipe and two-finger horizontal scrolling. Electron's documented
[`swipe`](https://www.electronjs.org/docs/latest/api/browser-window#event-swipe-macos)
only covers three fingers; its documented input events expose the scroll's end,
but no history action or deltas. A small Mac-only preload adapter combines DOM
wheel deltas with `gestureScrollEnd`, as
[t3code's desktop window](https://github.com/pingdotgg/t3code/blob/main/apps/desktop/src/window/DesktopWindow.ts)
does for gesture completion. A horizontal movement of at least 100px and more
than twice the vertical movement traverses native history once, on completion.
Modified gestures (including pinch), forms, sliders, native media and horizontal
scroll containers keep their gesture, including at scroll edges. The listener is
passive; browser gestures and TV remote navigation keep their existing handling.

An explicit Couch or mode change clears native history only after its destination
loads successfully, so Back cannot return to the previous Couch. Failed loads
retain history, as do reloads and subsequent router navigation.

Interaction regression: build `tests/desktop-interactions.browser.ts` with
`bun build --target browser --format iife`, evaluate it in a paired scratch
desktop, then run `window.runDesktopInteractionsRegression()`. Native menu,
swipe and mouse-command dispatch and connection boundaries are covered by
`tests/desktop-navigation.test.ts`; `tests/preload-history.test.ts` checks the real
preload's two-finger logic with synthetic input. Physical macOS gestures, their
momentum/event ordering and OS clipboard accelerators require platform checks.

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
