# Design

Couch is one app on three kinds of screen: the TV (a remote), a desktop window
(mouse and keyboard) and phones (touch). It is a dark living room lit by what
plays. **One layout**: the TV's layout is Couch's layout everywhere, one
component tree. Screens differ only where input demands it, through the `tv:`
and `touch:` variants and, where keys or focus differ, a `tvPresentation`
branch. Phones keep a bottom tab bar for thumb reach.

## Principles

- **Use shadcn components** (`src/client/components/ui`, owned by Couch). Check
  the [catalog](https://ui.shadcn.com/docs/components) before building anything
  custom.
- **Flat.** Pages, rows, tiles and menus have no Cards or bordered panels: open
  typography, whitespace and divided rows. A tile is a picture and a caption.
  Only what floats casts a shadow: the now-playing bar, toasts, an object on the
  Stage, Up next over the picture.
- **Show only what people need.** No filler copy, no headers or labels that
  repeat the screen, nothing said twice (the bar holds the transport, so nothing
  else repeats it while something plays).
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

## Room, glass and stage

- **Room** (`.room`, `artwork-light.ts`): behind a Stage and the player's Now
  playing, the room is painted with two colours read from the artwork (via
  `/api/artwork`), set dark enough that ink keeps 7:1, with a static grain.
  Artwork colour is the only colour besides danger's red. Video keeps black bars
  and no artwork light.
- **Glass** (`.bar-glass`): the now-playing bar is a capsule floating over the
  page, its backdrop blurred and tinted with the artwork's tone. Besides the
  player's Up next panel, it's the one backdrop filter on a page.
- **Stage** (`components/Stage.tsx`): opens Home and every Details page
  (`DetailHeader`), reaching under the header in its picture's room. The picture
  stands whole at the right as an **object** with a shadow, or as a **mark**
  (a logo on nothing) without one.

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

- **Focus inverts** the focused control to white with black ink; the TV's
  highlight is the same, and a focused tile rings its picture and lifts.
- **One hover language**: a pointer brightens (ink to white, a fill one step up)
  and media glows in its own colour. Nothing tints, scales or moves under a
  pointer, and the TV ignores hover.

## Type

`html` font size is `clamp(16px, 1.25vw, 24px)`, so rem sizes scale every screen
alike.

- **Mona Sans** (`font-display`, `font-heading`) sets display titles
  (`.display-title`), page titles and section headings, always at normal width.
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
- `Stage`, `DetailHeader`, `SaveToggle`, `Description`, `Onboarding`
- `Shelf`, `MediaTile`, `MediaRow` / `MediaList`, `MediaArtwork` (`artShape`:
  2:3 posters, 16:9 videos, square music and stations, round channels),
  `mediaCaption`, `metaLine`
- `ContentFilters`, `BrowsePagination`, `ContentLink`, `RowMenu`
- `PlaybackTransport`, `PlaybackTimeline`, `PlaybackSeekBar` (Video.js Slider
  primitives), `PlaybackThumbnail`, `VolumeButton`, `Level`
- `playbackStatus`: one status vocabulary for every playback surface

Messages: **toasts** (`src/client/toasts.ts`, a fixed set of kinds, at most one
action, never taking focus) for errors, Undo and unexpected outcomes; routine
actions stay quiet. **Alert** for a problem that is the page, **Empty** for empty
states, **Dialog** for short tasks, **AlertDialog** for confirmations, **Popover**
for panels over the picture, **Sheet** for longer panels on phones and the TV.
Portalled surfaces share `z-50`; later portals cover earlier ones.

## Copy

Sentence case, short: say what happened and what to do next. Parts of a line
join with commas (`metaLine`), never middle dots. Shared strings live in
`src/client/copy.ts`. Verbs are the same everywhere: Play, Pause, Stop, Next,
Play next, Queue, Save, Open, Resume, From start, Remove, Hide. Couch's own words:
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
