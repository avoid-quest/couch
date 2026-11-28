# Design

Couch is one app on three kinds of screen: the TV (a remote), a desktop window
(mouse and keyboard) and phones (touch). It is a dark living room lit by what
plays: playing lights the room from the picture's own colours, paused dims it,
and once nothing plays the light goes out. **One layout**: the TV's layout is Couch's layout everywhere, one
component tree. Screens differ only where input demands it, through the `tv:`
and `touch:` variants and, where keys or focus differ, a `tvPresentation`
branch. Phones keep a bottom tab bar for thumb reach.

## Principles

- **Use shadcn components** (`src/client/components/ui`, owned by Couch). Check
  the [catalog](https://ui.shadcn.com/docs/components) before building anything
  custom.
- **Flat.** Pages, rows, tiles and menus have no Cards or bordered panels: open
  typography, whitespace and divided rows. A tile is a picture and a caption.
  Only what floats casts a shadow: Now playing, toasts, an object on the Stage,
  Up next over the picture.
- **Show only what people need.** No filler copy, no headers or labels that
  repeat the screen, nothing said twice (Now playing holds the transport, so
  nothing else repeats it while something plays).
- **Show the whole picture.** Artwork keeps its true shape, never cropped into a
  band or used as a backdrop.
- **Real content only.** Browse pages show what a source returns; Couch picks
  nothing.
- **One primary target per item, one menu.** Pressing a row or tile does its main
  verb; its other verbs live in its one menu (`useItemMenu` / `ItemMenu`,
  opened by "…", right-click, long press, the menu key or OK held on a TV).
- **Undo, not confirm**, for shared actions; destructive admin actions confirm in
  an AlertDialog.
- **Disabled keeps its place**: half ink (`disabled:opacity-50`), nothing moves.

## Room, surfaces and stage

- **Room** (`RoomLight.tsx`, `.room`, `artwork-light.ts`): every screen stands in
  one warm dark room (`#110f13`) with a static grain. What plays lights it, a
  video too: two colours read from its picture (via `/api/artwork`) as a lamp
  by the player and a spill from the bottom left, at full strength while it
  plays, dimmed while paused, out once nothing plays. With nothing playing, the
  picture a page leads with (a Stage, `useRoomLead`) lights it a little.
  Search's results and a pasted list's page stand in the room too, lit by the
  top or focused item, neutral without artwork. So does a source's own page
  (`sections/find/Room.tsx`, `SourceRooms.tsx`): its name set large, its own
  doors (the Browse line's), its lead, then its lists as Shelves, while the
  header's field wears the source as a token. The header and the phone's tabs
  paint the same room (`.room-ground`), so it runs
  on under them. The full player throws the picture itself, blurred, on its
  wall; the full video player stays black. Artwork colour is the only colour
  besides danger's red. Artwork Core can't read (an SVG logo) gives no light.
- **Now playing** (`NowPlaying.tsx`, `.now-playing`): while something plays it
  stands at one side of every screen on desktops and the TV, a panel the
  window's height that the page steps beside: the right unless This device →
  **Player side** says the left (`player-side.ts`). The page's inset at each
  edge is `--content-inset-left` and `--content-inset-right` (0 without a side
  player), which messages keep clear of; its panels open toward the page, and
  the room's lamp stands by it. Its picture and title open the full player
  ("Open player" on hover and focus); **Minimise player** (a chevron) folds it
  to a capsule in that side's bottom corner, for this window only, which shows
  it again when pressed. A phone keeps it as a dock above its tabs, which opens
  the full player. Play/Pause, Next and a labelled Stop start from its
  bottom-left corner at every size, the full player's too. It is a lit panel
  (below), the side player with its picture on the wall behind it.
- **Surfaces**: Now playing is a **lit panel** (`.lit-panel`): a warm
  dark that takes the lamps' colours, with a hairline edge, a deep shadow and a
  little of the light around it; a panel that shows the picture (the side
  player) puts a blurred copy of it behind (`.room-picture`). What opens over
  the page (popovers, menus, dialogs, sheets) is a warm dark, a little
  see-through, blurring the light behind it, with the same edge and shadow.
  A toast is ink, the one light surface, with a dark verb.
- **Stage** (`components/Stage.tsx`): opens every Details page
  (`DetailHeader`). The picture stands whole as an **object** with a shadow, or
  as a **mark** (a logo on nothing) without one.

## Tokens

Tokens live in `:root` in `src/client/index.css` (one dark theme). Use the
Tailwind names, never hex values in components. Couch's scales are in the
`@theme` block "Couch's scales", and `cn` (`lib/utils.ts`) knows them.

| Scale | Steps |
| --- | --- |
| Radius | what you press or type into is a capsule (`rounded-full`); tiles and menu rows `rounded-md`; surfaces opening over the page `rounded-lg` |
| Control height | `control-sm`, `control`, `control-lg`, `field`; `touch:` raises each to 44px |
| Type | `caption`, `meta`, `body`, `title`, `heading`, `page` |
| Spacing | `caption`, `stack`, `item`, `section`; the page gutter is `px-(--gutter)` |

- **Colour**: room `#110f13`, ink `#f6f2ec`, quieter ink at 70%
  (`text-muted-foreground`, an unchosen tab too, so it reads over the light) and 48%
  for what only labels (`text-subtle-foreground`: a placeholder), lines at 11%.
  No fixed accent: the light comes from what plays.
- **Focus inverts** the focused control to white with black ink; the TV's
  highlight is the same, and a focused tile rings its picture and lifts.
- **One hover language**: a pointer brightens (ink to white, a fill one step up)
  and media glows in its own colour. Nothing tints, scales or moves under a
  pointer, and the TV ignores hover.

## Type

`html` font size is `clamp(16px, 1.25vw, 24px)`, so rem sizes scale every screen
alike.

- **Mona Sans** (`font-display`, `font-heading`) sets display titles
  (`.display-title`), page titles, section headings, the Couch's name and the
  Browse line, always expanded (`wdth` 112 to 120, widest for page titles).
  `titleLength` steps a title's size down as it grows and `titleFit` sizes it so
  its longest word usually fits one line (very wide words can still break), so
  titles wrap whole instead of ellipsing.
- **Inter Tight** sets everything else; metadata is small, muted and tabular.
- Text truncates only where space is truly scarce, with the whole text on hover
  and focus.

## Motion

Motion answers what people do and what plays; nothing performs on its own. One
easing (`ease-out`) and three durations: 150 ms for what answers a control,
200 ms for what arrives, 600 ms for colour that follows what plays. Focus
arrives at once. No scroll entrances, staggers, scaling tiles or animated
`filter`; the only loops are loading indicators and the `Level` bars while sound
plays. New motion is `motion-safe:`; reduced motion stills everything.

## Building blocks

In `src/client/components`:

- `PageHeader`, `ContentBreadcrumb`, `SettingsRow` / `SettingsSection`
- `Stage`, `DetailHeader`, `Description`, `Onboarding`
- `Shelf`, `MediaTile`, `MediaRow` / `MediaList`, `MediaArtwork` (`artShape`:
  2:3 posters, 16:9 videos, square music and stations, round channels),
  `mediaCaption`, `metaLine`
- `ContentFilters`, `BrowsePagination`, `ContentLink`, `RowMenu`
- `PlaybackTransport`, `PlaybackTimeline` (Video.js's `TimeSlider`),
  `PlaybackThumbnail`, `VolumeButton`, `Level`
- `playbackStatus`: one status vocabulary for every playback surface

Messages: **toasts** (`src/client/toasts.ts`, a fixed set of kinds, at most one
action, never taking focus) for a failed action, Undo and unexpected outcomes;
routine actions stay quiet. A message is a short pill in ink, its action a dark capsule
inside, an Undo draining a thin bar over its time; a problem keeps the bar's dark
surface and its icon. Every message shows in one place, centred over the content
beside the side player (`--content-inset-left`, `--content-inset-right`), at the bottom clear of the dock, tabs
or player controls (`--bottom-bar`), or at the top: each device chooses in This
device → General, and can turn off confirmations (Queued, Playing on).
**Alert** for a problem (see Problems), **Empty** for empty states, **Dialog**
for short tasks, **AlertDialog** for confirmations, **Popover** for panels over
the picture, **Sheet** for longer panels on phones.
Portalled surfaces share `z-50`; later portals cover earlier ones.

## Problems

A problem shows where it belongs, never as a banner dropping into the page:

- **One thing** (a shelf, a device's row, a setting, a panel) says so in that
  thing's own place, quietly: a shelf under its heading (`ShelfProblem`), a
  device under its name, a setting under its row. Nothing else moves. A shelf
  that keeps its last list after a refresh fails says "Couldn't refresh" beside
  its heading (`StaleNote`).
- **What you just did** (an action failed) is a message (`failed()` in
  `toasts.ts`), beside nothing else.
- **The whole app** (Couch out of reach, refusing this address, updated, its
  player unavailable, an update that failed) is one quiet line in one fixed
  place: the header's status row (`StatusLine`, `UpdateCue`), or the pairing
  page, which has no header.
- **A page that can't show at all** keeps its own space: its title, one line
  and one action (`PageProblem`, or the page's header with an Alert).

Every problem looks the same: an icon, one sentence in ink and one action
(`TryAgain` when it can retry), no box or border. Red is only the problem's
icon. An Alert announces itself (`role="alert"`, or `status` for a note), and
its action is a remote's next stop below the thing it belongs to.

### Dismissing

Every message and problem line puts away the same way: one **Dismiss** ×, the
same icon and size, last on its line (`Dismiss` in `alert.tsx` on every Alert and
`StatusLine`; sonner's own close button on every message, Undo and problems
included). A focused one also goes with Escape or the remote's Back, and a
message swipes away on touch. A dismissed problem stays mounted but hidden until
what it says changes, or until it goes and comes back (Couch reconnects, then
drops again). A line whose action is the one way on (Reload after an update, a
page that can't show) has no ×, so dismissing never hides an action you need;
plain progress ("Starting…") goes by itself.

**A control's panel opens from it.** On desktops and the TV its Popover or menu
hangs from the control and fits the screen; on phones a longer panel rises as a
Sheet from the bottom, by the dock, while short menus stay Popovers.

## Menus

A row or tile has one press and one "…"; a Stage (an item's page, Search's top
result, a room's lead, Continue's lead) has its main verb with where it plays
(`PlayPill`), Save and its "…". Every other verb is in the menu, never a button
beside it, and never the press again.

An item's menu draws its groups in one order, a separator between them and no
group labels: **Play** (Play or Resume, From start, Play next, Queue, then Play
on…), **Keep** (Save or Remove from For later, Add {name} to Home… or Show {name}
on Home), **Go** (Details, at most two Go to {name}, nearest first), **Share**
(Copy link, or Share… on a phone, and Open in browser) and **This list** (Move up,
Move down, Mark as watched, Remove from {list}, Hide). A menu keeps to nine rows:
past that Open in browser goes, then the second Go to, then Queue beside Play
next. What never applies is hidden; what can't run now is disabled. A label that
opens a panel ends in "…". Copy link hands out only a known source's public page,
in its usual form: never Couch's address, a stream, a signed or private link, and
nothing for Live TV, shared sources or a link Couch has no source for. On phones a menu of more than two rows is a Sheet titled with the
item's name; the TV opens it with a held OK.

## Copy

Sentence case, short: say what happened and what to do next. A problem says
"Couldn't {verb} {thing}." then what happens next or what to do, or Core's own
sentence when it sent one; never codes, script errors or an "Error:" prefix. Parts of a line
join with commas (`metaLine`), never middle dots. Shared strings live in
`src/client/copy.ts`. Verbs are the same everywhere: Play, Pause, Stop, Next,
Play next, Queue, Save, Open, Resume, From start, Details, Move up, Move down,
Remove from {list} (bare Remove only where the row is in one list and has nothing
else), Hide, Copy link. Couch's own words:
Where it plays, Move here, Play on {name}, Remote, Share on network, Up next (the
list), Queue (the verb), admin. Words for people follow
[voice](product/voice.md).

## See the TV in a browser

`isTvPresentation()` (`src/client/session/presentation.ts`) is true in the TV
app's window or a tab that opts in, which scratch and development builds allow:

```sh
COUCH_TV_OVERRIDE=1 bun run build
COUCH_DATA_DIR=/tmp/couch-tv COUCH_PORT=4782 node build/core.mjs
```

Open `http://localhost:4782/?tv=1` (with `bun run dev`, `http://localhost:1420/?tv=1`).
The tab stays a TV until `?tv=0`. Check a UI change at 1920×1080 as a TV,
1440×900 on desktop and 390×844 on a phone.
