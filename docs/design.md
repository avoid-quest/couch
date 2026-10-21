# Couch design system

Couch is one app on three kinds of screen: the TV (driven by a remote), a
desktop window (mouse and keyboard) and phones (touch). The visual identity is media-led: black ground, white ink, contained artwork,
open typography and quiet dividers. The picture brings the colour.

Everything on screen comes from one model: **Devices**, the **Playback** each
one serves, and **Where it plays**, a Playback's Devices with their picture and
sound. A Device that shares neither audio nor video only controls: it is never
where something plays unless it plays on itself. A Device running Couch's TV
presentation is a **TV**: it is driven by a remote, and the other Devices get a
**Remote** for it.

**One layout.** The TV's layout is Couch's layout on every screen. A screen
differs only where its input demands it: a pointer, touch reach and target
size, typing, or the window itself (fullscreen, the Mac window's buttons).
Phones keep a bottom tab bar for thumb reach; each surface doc names its other
input exceptions.

## Brand mark

Shift carries the avoid.quest disc and horizontal cuts, with its lower half moved
right. Desktop icons use the black tile in `packaging/icons/icon.svg`. The macOS
tray uses a transparent template silhouette so the system can tint it. The PWA
maskable icon uses a full black background and keeps the mark inside the safe
circle. The website uses a custom SVG for this product mark because the shadcn
catalog provides interface icons, not brand identities. In the app, `CouchMark`
sets the mark in the current ink at the text's size: it stands before the
Couch's name in the header (filled while connected, hollow while not, as the
status dot it replaced), before the TV's own name, and opens the pairing and
first-run screens.

## Principles

- **Conventional structure, quiet style.** Home, Discover, Saved and
  Settings, plus Remote on a Device that can drive a TV, with search in the
  header; a full-bleed player with a compact
  bottom control band; and the Device you control and where it plays one step
  away.
- **One primary action, direct relationships.** Pressing the main area of a
  media row or tile does its main verb. Related channels, artists, albums,
  series, stations and collections are separate visible internal links. They
  stay outside the primary target so links are never nested in buttons. Menus
  hold secondary actions, not the only route to related content.
- **Real content only.** A browse page shows what its source returns, never
  suggestions Couch picked: Discover samples each source's own home. A source
  without one (YouTube, Bandcamp, SoundCloud) scopes the header's search field
  to itself.
- **Sources are peers.** Every provider uses the same search, Details, Saved
  and Home surfaces. Source-specific behaviour follows the site's content
  and pagination, with no separate genre-specific layout or copy.
- **Content leads, time supports.** Artwork, title and relationships establish
  hierarchy. Runtime, progress and end times are secondary metadata. A watched
  item uses ordinary proportional progress; unstarted items show their runtime.
  There is no time ruler. Live reads "Live", with no invented total.
- **Colour only when it means something.** Destructive red is the only colour.
  Live is the word "Live", not a red badge.
- **Flat.** Open typography, whitespace and divided rows. No Cards, bordered
  panels, shadows, gradients or blur; only the player's bands shade a picture,
  with a scrim ([Player](design/player.md#controls-over-the-picture)).
- **One verb per job**, the same everywhere: Play, Pause, Stop, Next, Play
  next, Queue, Save, Open, Resume, From start, Remove.
- **Undo, not confirm**, for shared actions. Destructive admin actions confirm
  inline or in an AlertDialog.

## Tokens

Tokens live in `:root` in `src/client/index.css` (one dark theme). Use the
Tailwind names (`bg-background`, `text-muted-foreground`, `border`), never hex
values in components.

| Token | Value | Use |
| --- | --- | --- |
| `background` | `#000` | page, band, sheets |
| `foreground` / `primary` | `#fff` | text, bars, primary button |
| `muted` / `secondary` | `#171717` | inputs, thumbnail placeholders |
| `muted-foreground` | `#a3a3a3` | metadata; in the player's bands over a picture, white at 85%, so small text keeps 4.5:1 over the scrim on a white frame |
| `border` | white 16% | hairlines and row dividers |
| `accent` | `#fff` / `#000` | menu highlight (inverts like focus) |
| `radius` | `.25rem` | controls |

**Focus** inverts the focused control to white with black text. It is the only
focus treatment; white controls (slider, Switch, Checkbox and RadioGroupItem)
use a 2px foreground outline with a 2px offset on `:focus-visible` (see the
unlayered rule in `index.css`). A media tile's caption inverts and its artwork
takes a `0.125rem` foreground outline with a `0.125rem` offset, as artwork
can't invert.

**Hover** uses a white tint on actions, brighter field borders and quiet rings on
small controls. Reuse shadcn variants; artwork-only buttons dim the image because
it covers their background. Keep hover on enabled controls and preserve focus
inversion. A ghost button whose panel is open (`aria-expanded`: Volume, Where it
plays, Up next, Playback) keeps the same white tint, never an opaque fill, so it
reads alike on black and over a picture's scrim.

**Disabled** controls keep their slot and size at half ink (shadcn's
`disabled:opacity-50`); nothing shrinks, hides or moves while it can't act.

## Scale

`html` font size is `clamp(16px, 1.25vw, 24px)`. Use Tailwind's rem sizes so
the same typography and controls scale across screens.

**Titles lead, metadata recedes.** Inter Tight carries the interface. Titles
are semibold with tight tracking; runtime and progress use small muted tabular
figures. Time never competes with a title.

| Role | Classes |
| --- | --- |
| Hero / Now playing | `text-3xl` / `text-4xl`, `font-semibold tracking-tight md:text-5xl` |
| Details / closest match | `text-4xl` / `text-2xl`, `font-semibold tracking-tight` |
| Title over a video (the player's top band) | `text-2xl font-semibold tracking-tight` |
| Runtime, end time, progress | `text-sm text-muted-foreground tabular-nums` |
| Clock (TV header only) | `text-sm text-muted-foreground tabular-nums` |
| Page title | `text-3xl font-semibold tracking-tight` (use `PageHeader`) |
| Shelf title | `text-xl font-semibold tracking-tight` |
| Row title, settings label | `text-base` (a media row's or Up next's title adds `font-medium` and wraps to two lines) |
| Departures in a row (Up next's start times) | `text-base font-light tabular-nums`, the row title's size |
| Body, controls, metadata | `text-sm` (metadata adds `text-muted-foreground`) |
| Caption | `text-xs text-muted-foreground` |

Spacing uses Tailwind steps 1, 2, 3, 4, 6, 8 and 12, plus `gap-0.5`, `py-1.5` and `-ml-2.5` for compact rows and aligned controls. The page gutter is
`px-(--gutter)` (`clamp(1rem, 4vw, 3rem)`). Two-column pages use a `12rem` rail plus `gap-12`, keeping each page’s breakpoint.
The shell's content wrapper sets the one top offset below the header (`pt-8`); pages add none.

Controls are Mira-sized at `h-8 text-sm`. The `touch:` variant (phones and
windows narrower than 960px) raises every control to a 44px target; player-band controls are 44–48px on every screen, scaled in rem. Sonner toast
actions reuse the default Button variant, including its type, target size and focus treatment.

**Icon controls** for playback are one control wherever they appear: a ghost
`icon-lg` button with a 1.25rem glyph. That is the transport, Volume, Where
it plays, Up next, Playback, fullscreen, the player's Back and every Sheet's
Close. The band, the now-playing bar and every Sheet's heading row give each
a 44px target (`size-11`, in rem); beside Home's hero verbs they keep
`icon-lg`'s 40px, the `lg` verbs use 44px. An icon control at the end of a row pulls back
(`-ml-2.5`, `-mr-2.5`) so its glyph lines up with the text above it. A row's
own "…" stays at its row's size.

## Motion

A small touch, the same everywhere: things ease, nothing performs. One easing,
`ease-out` (Tailwind's `cubic-bezier(0, 0, .2, 1)`, which `index.css` makes
every `transition-*` utility's default), and two durations: **150 ms** for what
answers a control, **200 ms** for what arrives.

| What | Moves | Time |
| --- | --- | --- |
| Hover, press and selection: tints, ink, borders, the current tab's underline | colour, both ways | 150 ms |
| Focus and a menu's highlight (inversion), a tile's outline | at once in, eased out as they leave | 150 ms |
| A menu, popover, select or dialog | shadcn's fade, 95% zoom and short slide in; leaves at once | 150 ms |
| A page (a new route) | appears immediately, preserving cached content | — |
| Artwork | fades on a cold load; decoded cache appears immediately | 200 ms |
| The Sheet | fades and rises in; leaves at once | 200 ms |
| A toast | sonner's slide and fade, both ways | 200 ms |
| The player's bands, and the subtitles they lift | fade; the subtitles move with them | 200 ms |
| The now-playing bar growing into the player band | view transition (`couch-player-band`) | 320 ms |

- **General rules first.** Every link, button, tab, option and menu item eases
  its colours from one base rule in `index.css`, as the shadcn primitives'
  own `transition-*` utilities do, and those win. Routes appear immediately; `MediaArtwork` fades only images that still need loading. Add a `transition-*`
  only where a component moves something else, as a saved list's rows fade
  in their actions on hover.
- **Inversion arrives at once.** Easing it in would pass through a grey that
  reads as nothing, at every step of a held arrow; arriving at once keeps a
  remote instant, and the fade as focus leaves is a short trail behind it.
- **Overlays leave at once.** Menus, dialogs and Sheets hold focus, so they
  close at once and focus is back on what opened them before the next key.
- **Composited.** Opacity and transforms move surfaces; colour moves only on
  small elements. The bar's grow is the one longer move, as it crosses the
  screen.
- **Never in the way.** No entrances on scroll, staggers, springs, scaling
  tiles or loops; a page takes keys immediately.
- **Reduced motion stills it all.** New motion is written `motion-safe:`; a
  primitive's own `transition-*` carries `motion-reduce:transition-none`;
  sonner stills toasts itself.

## Components

Prefer shadcn components from `src/client/components/ui`, and check the
[catalog](https://ui.shadcn.com/docs/components) before building anything
custom; record the gap that justifies a custom component in its surface doc.
Their files are owned by Couch; the Mira defaults were changed only where Couch needs it:
`text-sm` controls at `h-8`, flat left-rule `Alert`, left-aligned borderless
`Empty`, no shadows, a 1.25rem glyph in `icon-lg` (the default 1.15em read
small on the player's icon-only band, and per-use `[&_svg]` overrides lose to
the variant's own selector) Select items reserve space for their checkmark, and a ghost button's open state in the hover tint
([Hover](#tokens)).

Shared building blocks in `src/client/components`:

- `SettingsRow` / `SettingsSection`: label and control on divided rows.
- `PageHeader`: wrapping title, optional description, back and actions.
- `ContentLink` / `MediaContext`: internal content relationships with Back/focus
  restoration, visible underlines and independent touch targets.
- `playbackStatus`: one status vocabulary for Home, player, compact bar, Remote
  and Up next; recovery follows the fixed transport slots.
- `ChoiceGroup`: inline choices with a check on the selected option.
- `DetailHeader`: an item or collection page's artwork, title, meta, synopsis
  and row of verbs ([Browse](design/browse.md#details)).
- `Shelf`: a section heading, which can link to the rest, over a plain
  overflow row of `MediaTile`s, for Home's and Discover's shelves
  ([Browse](design/browse.md#mediatile)).
- `MediaArtwork`: contained artwork; without any, a hairline frame with the
  title set in type ([Browse](design/browse.md#keep-discovery-context-visible)).
- `RowMenu`: an item's one menu, `useItemMenu` and `ItemMenu`, for media rows,
  tiles, Up next's rows and Details' "…" ([Menus](#menus)).

Release notes use `react-markdown` with GitHub-flavoured Markdown because the
[shadcn catalog](https://ui.shadcn.com/docs/components) has no Markdown renderer.
They sit in the settings row's content column, where block content is valid and
has room to read. Keep the parser's safe URL handling and omit raw HTML.

Messages:

- **Toast** (`sonner`) for errors, removal/Stop Undo and unexpected outcomes. Successful explicit Queue confirms `Queued {title}` with Up next on the requesting controller, idle or playing; other controllers and queue snapshots stay quiet. Playback activity from other devices (Play, Pause, Resume, Stop, Queue and Remove) stays quiet too: the player and Up next show the result. An ended shared source still names who stopped sharing on its receivers; its publisher stays quiet. Pairing still names the new device when its dialog closes. Other routine user-triggered actions stay quiet. Short copy, at most one action, named by its verb: Undo, Up next, Tap to hear.
  - **Kinds.** Every toast is one of `src/client/toasts.ts`'s kinds; only that module and the Toaster import sonner. Each kind fixes its duration and its action, and shows one toast at a time: a repeat updates the one showing, in place; once that one is leaving (timed out, dismissed or acted on) or hidden behind two newer toasts, the repeat takes a new id and the old one goes, since sonner removes whatever a leaving toast's id shows when its exit ends, and an update keeps a hidden toast hidden: `failed` ("Couldn't X.", 6 s), `undoable` (Undo, 6 s or what the Undo has left; each offer retires the last), `queued` (Up next, 4 s), `playingOn` (4 s), `notice` (6 s) and `waitingForTap` (Tap to hear, until sound plays). `failed` shows Core's own sentence when Core sent one; a network error or timeout gets the call site's Couch sentence, and its detail goes to the console.
  - **Lifetime.** A new item or controlled device clears the previous Queue and Undo feedback, including when another controller starts playback. Playing on keeps its four seconds while that device remains the destination, even if the confirming snapshot arrives after the command result; changing destinations retires it. Errors and audio recovery stay available, including after recovering the shell with Try again. Switching Couch clears every old notification and action. A TV ignores pointer hover over toasts so a parked pointer cannot pause their timers; desktop hover and touch interaction retain Sonner's behavior.
  - **Appearance and placement.** A flat black row with Alert's left rule, no rounded frame or shadow, and rem-sized spacing and type. Copy wraps instead of truncating the recovery instruction; the action keeps its size. Sonner's supported `unstyled` option and Button variants provide this: Sonner's default bordered surface doesn't fit Couch, and Couch's old single-line styling hid recovery instructions and long device names. Top right at the page gutter on every screen, below the measured header (`--top-bar`), and in the player below its top band (`--player-top`). Two show at most, both open, since a remote can't hover to expand a stack.
  - **Focus.** A toast never takes focus. Up where nothing is above (the header's tabs, or the top of the player's band) reaches the newest toast's action, with a remote as with arrow keys; OK runs it, and any other key, Back included, returns focus to where it came from, as sonner does when focus leaves a toast. Spatial navigation otherwise passes toasts by, so they never catch a press meant for the page.
- **System notification**: the desktop app has one, "Couch X is ready", shown
  once per version when an update has downloaded. It stays because desktop
  updates install only when Couch quits or restarts, which can be days away
  with the window closed to the tray. The TV shows none: it installs by itself.
- **Alert** for a persistent problem on the page. `variant="destructive"` for
  errors; put Try again in `AlertAction`.
- **Empty** for empty states. Say what goes here and offer the next step.
- **Status line** (`Spinner` and muted text) for work in progress.
- **Dialog** for short focused tasks (pairing, source setup); **AlertDialog**
  for confirmations; **Sheet** for player panels; **Popover** for the header's
  Couch switch: the server this window shows, with its connection status;
  **Dropdown Menu** for an item's other verbs ([Menus](#menus)).

## Menus

One item, one menu. Every media row and tile has one primary target, its
press, and at most one menu holding secondary verbs, Details included where
the press doesn't open Details. Visible Details and relationship links can also
provide direct navigation beside that primary target. The menu is a controlled shadcn Dropdown Menu
fed one verb list (`useItemMenu` and `ItemMenu` in `RowMenu.tsx`). It hangs
from the item's "…" ("Options for {title}"), or from the whole item where a
row's page holds all its verbs and the row shows no "…", so it opens in one
place with the same verbs whatever opened it:

| Input | Opens the menu |
| --- | --- |
| Pointer | The "…", always shown; right-click |
| Touch | The "…", always shown; a long press held still (500 ms), with no text selection or link preview |
| Keyboard | The "…" (a Tab stop on rows and tiles); the menu key or Shift+F10 on the item |
| TV remote | OK held for 500 ms on the item, which acts on release when pressed shortly; Right to a row's "…" (a tile's is no stop, so Up and Down still go shelf to shelf, but it shows in the focused tile's caption; it is the tile's one stop while the press is disabled) |
| Remote section | OK held on the pad, sent to the TV as a held OK |

A keyboard or a remote lands on the menu's first verb. Esc and Back close it
and return focus to what opened it, the item or its "…"; a verb runs from there,
so Details records the item for Back. A verb that takes its item away (Remove,
Saved on a station shown only as a favourite) leaves focus on the neighbouring
row or tile in its list or shelf instead.

## Copy

Sentence case, short, no filler. Say what happened and what to do next.

| Say | Not |
| --- | --- |
| the device's name, or Couch | host, playback host/computer/device, coordinator, installation |
| This computer, This device | this installation, this app |
| Where it plays, Volume, Picture, Only here, Mute | Mixer, Speakers panel, All, look at, host |
| Play on {name}, Playing on {name} | Send to, Cast to |
| device (a phone, browser, app window or TV) | remote (for a device), controller, client |
| Remote (the section that drives a TV) | TV remote, remote control |
| Share on network | Allow remotes, remote control |
| admin, Make admin, Become admin | administrator, Claim administration |
| Up next (the list), Queue (the verb) | shared queue, Add to Up next |
| Saved, Save / Saved | Kept, Keep, favorites |
| Discover, Saved (the sections), Search (the header's field) | Live, Library, Find (earlier sections) |
| Live TV, Radio playlists | IPTV, TV guide |
| Try again | Retry, Reload, Refresh |
| Couldn't load X. | Could not…, Check the connection and… |
| Offline. Reconnecting to {name}… | 30 variants of "Reconnect to…" |
| Only an admin can change this. | 20 variants of "An administrator can…" |

## Surfaces

Each surface's own layout and behaviour lives in its file:

- [Shell](design/shell.md): the sections and their paths, the header (name, search) and tab bars, the Couch switch, the now-playing bar, keyboard shortcuts, first run and pairing, and when a picture opens the player.
- [Home](design/home.md): Home's hero and its shelves of tiles.
- [Browse](design/browse.md): Search, Discover, Saved, item and collection pages, media rows and tiles, pagination, breadcrumbs and Play on menus.
- [Player](design/player.md): the player band, transport, timeline, Up next and Playback settings.
- [Where it plays](design/where-it-plays.md): its principles and rules model, the picker with its Volume, device rows and "…" menu, Play on, DeviceIcon and outputs after a server switch.
- [TV](design/tv.md): what a TV adds for its remote: remote navigation, Back, its header's name, and the TV player's keys.
- [Remote](design/remote.md): the Remote section that drives a TV, and Type on TV.
- [Settings](design/settings.md): Settings' two owners, its section nav, admin-only rows and device names.

Not yet: `apps/web`, the couch.avoid.quest site, keeps its own pages; this
structure hasn't reached it.

## Changing a surface

- **The TV's layout is the layout.** Screens differ only where input demands
  it: a pointer, touch reach and target size, typing, or the window itself.
  Name each such difference as an exception in the surface's doc.
- **One tree.** A surface renders one component tree on every screen.
  Express input's differences with the `tv:` and `touch:` variants, and keep a
  `tvPresentation` branch only where input differs, such as keys, focus stops,
  typing, fullscreen or pointer-only controls.
- **Keep the hooks.** The browser checks (`tests/tv-navigation.browser.ts`,
  `tests/tv-continue.browser.ts`) find elements by `data-*` attributes,
  `aria-label`s and paths. A change that moves one updates those checks with
  it.
- **Seen on three screens.** Look at the change on a scratch Couch at
  1920×1080 in TV presentation, through the
  [TV override](design/tv.md#see-the-tv-in-a-browser), at 1440×900 on desktop
  and at 390×844 on a phone.
- **Docs follow code.** A surface's doc changes with its code, so it keeps
  describing what is built.

### Loading and cached navigation

Use the existing shadcn Skeleton for cold reads, composed into the same artwork, row, detail and settings geometry as the destination. Shelf skeletons have fixed artwork dimensions; catalogue-grid skeletons fill their cells. These compositions cover Couch-specific media layouts absent from the primitive catalog. Respect reduced motion and keep placeholders out of the focus order.

Keep usable query data mounted during refreshes and refresh failures. List and detail metadata use a short freshness window; seed known details from the same authenticated QueryClient, preserving the source timestamp. Never share metadata across connections. Search publishes cached summaries before paint and preserves its first leading match as later sources arrive.
