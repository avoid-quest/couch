# Couch design system

Couch is one app on three kinds of screen: the TV (driven by a remote), a
desktop window (mouse and keyboard) and phones (touch). The look is **Clock**:
black ground, white ink, hairlines. The picture brings the colour.

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
catalog provides interface icons, not brand identities.

## Principles

- **Conventional structure, quiet style.** Home, Live, Search, Library and
  Settings, plus Remote on a Device that can drive a TV; a full-bleed player with a compact
  bottom control band; and the Device you control and where it plays one step
  away.
- **One target per row and tile.** Pressing a media row or tile does its main
  verb; its page holds every verb, and on a pointer or touch screen its
  context menu holds the rest.
- **Real content only.** A browse page shows what its source returns, never
  suggestions Couch picked. A source without a home page of its own (YouTube,
  Bandcamp, SoundCloud) opens on an Empty with a search field scoped to it.
- **Time is the organising idea.** Every length is read as the clock time it
  ends: "4:52, ends 10:29". The now-playing bar reads "−3:24 ends 20:59"; the
  player says "ends 20:59" once, in its top band or Now playing, and its band
  keeps "−3:24". Live reads "Live", with no total.
- **Colour only when it means something.** Destructive red is the only colour.
  Live is the word "Live", not a red badge.
- **Flat.** Open typography, whitespace and divided rows. No Cards, bordered
  panels, shadows, gradients or blur.
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
| `muted-foreground` | `#a3a3a3` | metadata |
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
inversion.

## Scale

`html` font size is `clamp(16px, 1.25vw, 24px)`. Use Tailwind's rem sizes so
the same typography and controls scale across screens.

| Role | Classes |
| --- | --- |
| Display (search field, Home's hero, Details and Now playing titles) | `text-3xl font-semibold tracking-tight` |
| Title over a video (the player's top band) | `text-2xl font-semibold tracking-tight` |
| Departures line (the hero's and Now playing's end time) | `text-2xl tabular-nums` |
| Page title | `text-2xl font-semibold tracking-tight` (use `PageHeader`) |
| Section title | `text-base font-medium` |
| Row title, settings label | `text-base` |
| Body, controls, metadata | `text-sm` (metadata adds `text-muted-foreground`) |
| Caption | `text-xs text-muted-foreground` |

Spacing uses Tailwind steps 1, 2, 3, 4, 6, 8 and 12, plus `gap-0.5`, `py-1.5` and `-ml-2.5` for compact rows and aligned controls. The page gutter is
`px-(--gutter)` (3rem, 1rem on phones). Two-column pages use a `12rem` rail plus `gap-12`, keeping each page’s breakpoint.
The shell's content wrapper sets the one top offset below the header (`pt-6`); pages add none.

Controls are Mira-sized at `h-8 text-sm`. The `touch:` variant (phones and
windows narrower than 960px) raises every control to a 44px target; player-band controls are 44–48px on every screen, scaled in rem. Sonner toast
actions take `h-8 text-sm` and the touch target through its `actionButton` classes, as its default is 24px.

## Components

Prefer shadcn components from `src/client/components/ui`, and check the
[catalog](https://ui.shadcn.com/docs/components) before building anything
custom; record the gap that justifies a custom component in its surface doc.
Their files are owned by Couch; the Mira defaults were changed only where Clock needs it:
`text-sm` controls at `h-8`, flat left-rule `Alert`, left-aligned borderless
`Empty`, no shadows.

Shared building blocks in `src/client/components`:

- `SettingsRow` / `SettingsSection`: label and control on divided rows.
- `PageHeader`: title with optional back and actions.
- `ChoiceGroup`: inline choices with a check on the selected option.
- `DetailHeader`: an item or collection page's artwork, title, meta, synopsis
  and row of verbs ([Browse](design/browse.md#details)).
- `Shelf`: a section heading over a plain overflow row of `MediaTile`s, for
  Home's shelves and Live's On air ([Browse](design/browse.md#mediatile)).
- `RowMenu`: one list of verbs as a row's `RowContextMenu` (right-click or a
  long press) or a visible "…" `OptionsMenu`, for Details' rest and the TV's
  rows that keep theirs ([Browse](design/browse.md#mediarow--medialist)).

Release notes use `react-markdown` with GitHub-flavoured Markdown because the
[shadcn catalog](https://ui.shadcn.com/docs/components) has no Markdown renderer.
They sit in the settings row's content column, where block content is valid and
has room to read. Keep the parser's safe URL handling and omit raw HTML.

Messages:

- **Toast** (`sonner`) for errors, removal/Stop Undo, other people's activity and unexpected outcomes. Successful explicit Queue confirms `Queued {title}` with Up next on the requesting controller, idle or playing; other controllers and queue snapshots stay quiet. Other routine user-triggered actions stay quiet. One line, at most one action, named by its verb: Undo, Up next, Tap to hear.
  - **Kinds.** Every toast is one of `src/client/toasts.ts`'s kinds; only that module and the Toaster import sonner. Each kind fixes its duration and its action, and shows one toast at a time: a repeat updates the one showing, in place; once that one is leaving (timed out, dismissed or acted on) or hidden behind two newer toasts, the repeat takes a new id and the old one goes, since sonner removes whatever a leaving toast's id shows when its exit ends, and an update keeps a hidden toast hidden: `failed` ("Couldn't X.", 6 s), `undoable` (Undo, 6 s or what the Undo has left; each offer retires the last), `queued` (Up next, 4 s), `playingOn` (4 s), `activity` (6 s), `notice` (6 s) and `waitingForTap` (Tap to hear, until sound plays). `failed` shows Core's own sentence when Core sent one; a network error or timeout gets the call site's Couch sentence, and its detail goes to the console.
  - **Placement.** Top right at the page gutter on every screen: below the header's row (the clock's on the TV, the top bar's on phones), and in the player below its top band, which publishes its height as `--player-top`. Two show at most, both open, since a remote can't hover to expand a stack.
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
  **Context Menu** for a row's other verbs on right-click or a long press
  ([Browse](design/browse.md#mediarow--medialist)).

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
| Live, Search, Library (the sections) | Find, Saved (earlier sections) |
| Live TV, Radio playlists | IPTV, TV guide |
| Try again | Retry, Reload, Refresh |
| Couldn't load X. | Could not…, Check the connection and… |
| Offline. Reconnecting to {name}… | 30 variants of "Reconnect to…" |
| Only an admin can change this. | 20 variants of "An administrator can…" |

## Surfaces

Each surface's own layout and behaviour lives in its file:

- [Shell](design/shell.md): the sections and their paths, the header and tab bars, the Couch switch, the now-playing bar, keyboard shortcuts, first run and pairing, and when a picture opens the player.
- [Home](design/home.md): Home's hero and its shelves of tiles.
- [Browse](design/browse.md): Search, Live, Library, item and collection pages, media rows and tiles, pagination, breadcrumbs and Play on menus.
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
