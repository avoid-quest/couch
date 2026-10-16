# Shell

## Sections

| Section | Path | Holds |
| --- | --- | --- |
| Home | `/` | one hero (what plays now, else what to continue, else what's on air), then shelves |
| Live | `/live` | stations on air, then every station, then Live TV channels once a Live TV source has some |
| Search | `/search` | the search field, results and sources |
| Library | `/library` | For later, Channels & stations, Lists and Played (`?tab=`) |
| Settings | `/settings` | the device's and the Couch's pages |
| Remote | `/remote` | drives a TV; on non-TV devices while the Couch has one (`DeviceSummary.tv`, online or not) |

`/item` and `/collection` belong to Search, `/now` is the player, and
`/where-it-plays` is Where it plays' overview, which opens from the picker
and is not a tab ([Where it plays](where-it-plays.md#the-overview)).
Earlier addresses redirect and keep their query, as `settingsAliases` does
for Settings: `/find` opens `/search`, `/find?browse=radio` and
`/find?browse=live-tv` open `/live`, and `/saved` opens `/library` on the
same tab. Core serves every path in `src/shared/page-paths.ts`, the earlier
ones included, so bookmarks reach their redirects.

Radio and Live TV share Live's address, so Live TV's page and filter are
`channelPage` and `channelFilter`, and each keeps the other's place.

## Header and section nav

One set of tabs, laid out per screen:

- **TV:** centred text tabs (Home, Live, Search, Library, Settings), the TV's
  name at the left in muted ink, the clock at the right. The tab bar scrolls
  away with the page: [TV](tv.md#every-journey-step-works-with-a-remote).
- **Desktop and wide browsers:** tabs at the left (Home, Live, Search,
  Library, then Remote while the Couch has a TV, then Settings); the Couch
  switch, Keyboard shortcuts (outside Remote) and the clock at the right. The
  header stays sticky.
- **Phones** (`touch:`, below 960px): a compact top bar with the page title,
  the Couch switch and a Settings gear (`aria-label="Settings"`), and a bottom
  tab bar with Home, Live, Search, Library, and Remote while the Couch has a
  TV, each a lucide icon (House, Radio, Search, Library, Tv) over its label.
  A page whose own heading repeats the title hides it on phones.

The current tab is underlined; a focused tab inverts, as every control does.
The header and the phone tab bar render the same `SectionTabs`; `tv:`
undoes `touch:` so a narrow TV keeps the TV layout. The player's header
carries the Couch switch too.

## Couch switch

The Popover reuses Settings → Couch connection's
choice: saved servers, the app's This computer option, and another address.
On the host with sharing on, it ends with Pair a device. It scrolls within
the available space and keeps the same flat, divided settings rows.

Where it plays after a switch: [Where it plays](where-it-plays.md#switching-servers).

## Now-playing bar

`NowPlayingBar` is one row above the page, and above the phone tab bar. Its
artwork and title ("Open player: …") open the player; the row underneath
names the radio or collection (a link), the status and, below `lg`, the time.
The TV and desktop then carry the band's controls in its order: Play/Pause,
Stop and Next, the timeline or "Live", Volume, Where it plays and Up next.
Phones keep Play/Pause and Where it plays; the player keeps the rest. It
hides on the player, on Remote and on Where it plays' overview, which shows
the same Playback, and grows into the player band (`couch-player-band`) and
back.

The bar and the phone tab bar share the shell's footer, whose height is
`--bottom-bar`: toasts and scroll padding clear it, and the player band
publishes its own. Transport details: [Player](player.md#the-player-is-one-tap-away).

## Browsing stays grounded

The sticky header and scroll edges share the
solid black page background on desktop and web. Native video alone clears
its full-screen ancestors so the picture can show through.

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
user-facing reference. Keep transport shortcuts aligned with visible control
capabilities, preserve Search's type-to-search, and let open panels, text entry,
focused controls and TV navigation own their keys.

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
