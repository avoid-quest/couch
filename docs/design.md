# Couch design system

Couch is one app on three kinds of screen: the TV (driven by a remote), a
desktop window (mouse and keyboard) and phones (touch). The look is **Clock**:
black ground, white ink, hairlines. The picture brings the colour.

Everything on screen comes from one model: **Devices**, the **Playback** each
one serves, and **Where it plays**, a Playback's Devices with their picture and
sound. A Device that shares neither audio nor video only controls: it is never
where something plays unless it plays on itself. A Device running Couch's TV
presentation is a **TV**: it gets the TV layout, and the other Devices get a
**Remote** for it.

## Brand mark

Shift carries the avoid.quest disc and horizontal cuts, with its lower half moved
right. Desktop icons use the black tile in `packaging/icons/icon.svg`. The macOS
tray uses a transparent template silhouette so the system can tint it. The PWA
maskable icon uses a full black background and keeps the mark inside the safe
circle. The website uses a custom SVG for this product mark because the shadcn
catalog provides interface icons, not brand identities.

## Principles

- **Conventional structure, quiet style.** Home, Find, Saved and Settings, plus
  Remote on a Device that can drive a TV; a full-bleed player with a compact
  bottom control band; and the Device you control and where it plays one step
  away.
- **The player is one tap away.** The mini dock opens the player through its
  artwork and title. The mini player and the player band hold one control
  order: Play/Pause, Stop and Next, the timeline, volume, Where it plays, Up
  next, then Expand (`ChevronUp`) in the mini player or Playback settings (a
  gear; Audio & subtitles lives inside) and fullscreen in the band, whose
  timeline takes its own row above. Every control there is an icon with an
  `aria-label` and a matching `title` tooltip, never visible text. The
  transport is Play/Pause, Stop and Next wherever it appears: the band, the
  mini player, Home's Now row and the Remote. Each keeps its slot for every
  kind of media: live media that can't pause keeps Pause, disabled, and Stop is
  enabled whenever something is loading, playing, paused, ended or failed.
  Stop clears the sequence and offers Undo; it lives in the transport, never
  only in a Sheet. The keyboard and the timeline seek.
  Volume is a speaker icon that opens its slider and Mute in a Popover. A
  timeline shows only where it means something: seekable media, or media with
  a length it will seek through once loaded. Live media that can't seek shows
  no bar, no position and no total, just "Live" in the timeline's slot.
  Audio and remote playback place contained artwork beside a persistent
  desktop queue. On phones, Up next replaces the artwork while transport stays
  available. Video uses the full viewport until Up next opens beside it; then the picture is letterboxed, never cropped.
  Queue navigation survives playback changes; track-specific settings reset.
  Transport, volume and tools share one bottom dock across media modes. Keep
  unavailable controls in their slots so loading and queue changes preserve
  muscle memory (the live timeline is the exception: it gives way to "Live");
  adapt the rows to screen width, with content above the dock.
  Audio keeps its solid controls visible. Video controls fade over a transparent
  black scrim, preserving the picture bounds; the gradient exists only to keep
  overlaid text readable without an abrupt edge that resembles cropping. Hidden
  controls are inert and let pointer input reach the video. The player fits the
  viewport at every interface size. Plain playback glyphs keep artwork central;
  Playback settings use Sheets. Stage CSS handles native video bounds
  and the responsive queue workspace; controls reuse shadcn components.
- **A picture you start opens the player.** When Play, Resume or Play on, from
  any Device, starts an item with a picture on this Device, this Device opens
  its player from whatever page it shows, so video never plays unseen. Up next
  moving on, by itself or with Next, keeps the page, and so does audio-only
  media (radio, music), which Home's Now row and the mini player carry. The
  first sync after a reload keeps the requested page. Back on Home does
  nothing; it never reopens the player.
- **Every journey step works with a remote.** The TV has only arrows, Enter and
  Back, so no control may keep them all: the arrows past a radio group's first
  or last radio move on, and on the TV so do Up/Down across a horizontal slider,
  Up/Down in a one-line field and every arrow on a closed select or menu button
  (OK opens it).
  A TV fader (Where it plays' faders, and every Volume, which
  has the player's tools beside it) moves on with every arrow until
  OK hands it the keys along it; OK, Back or leaving it ends that, as TV
  equalisers do, and Where it plays' hint says so on the TV. Playback position
  keeps Left/Right for seeking, and a seek's brief stall keeps the transport
  enabled so focus stays where it was. Spatial navigation places a
  slider by its whole track, not its moving thumb, reaches the sticky header
  and mini player only after the page's own controls, and keeps focus clear
  of both. After a page change the first key starts at the page's first
  control. Screens shown before the shell (the first-run chooser) bring the
  same arrow navigation.
- **The TV has its own layout.** A TV (`body.tv-presentation`, styled with the
  `tv:` variant) keeps the sections, routes and model and recomposes them for
  a remote at ten feet. Each media item on Home has one primary `MediaTile` focus
  stop, and OK does its main verb: Continue resumes, a station or channel
  plays, everything else opens its page, which holds the other verbs. Continue
  alone adds a sibling secondary Details button (at least 44px): Resume's
  playback destination lacks its history actions. This extra focus stop opens
  existing History Details without playing, even when Resume is unavailable.
  Tiles with complete destinations keep one stop. Focus is
  the only highlight; no hover style applies on the TV. Back closes an open
  overlay, then leaves a detail page for the page that opened it with its focus
  restored, then takes any section to Home, where Back does nothing. Opening
  Up next changes the player URL without losing its opener. Settings OK enters
  the selected page's first enabled control; Back from its content restores the
  visible rail entry or narrow Settings page selector, then Home (a source's
  own Back first returns to Sources).
  After every page change, focus is on the page's first control. The header holds the sections, the TV's name
  and the clock as plain text; the Couch choice lives in Settings → Devices.
  Volume and every fader move 5 per press. Text fields say "Type with Remote on
  your phone": a phone's Remote is the TV's text entry.
- **The TV player answers a remote.** With its controls hidden, OK shows them
  on the first enabled transport slot, Up and Down show them on the timeline (or
  that transport slot when there is no seekable timeline), and Left and Right seek
  10 s and show the timeline (live media that can't seek only shows them). Back
  hides the controls; with them hidden it leaves the player for the page that
  opened it, and playback goes on in Home's Now row and the mini player.
  Paused shows a large Pause glyph and "Paused", and the controls stay up until
  Back hides them. The TV's player has no breadcrumb, Couch switch, inline Details button or fullscreen;
  Details is in the Playback sheet. From hidden controls, Stop for pausable media
  is OK, Right, OK. Nonpausable radio/live starts on Stop, so it is OK, OK.
  Home's Now row uses that
  same transport rather than maintaining separate Play/Pause, Stop and Next logic.
- **First run names the computer.** The app asks "Where is your Couch?" (This
  computer hosts it; Another Couch joins one, and this computer still plays),
  then asks for its name once, with the random default shown, and whether to
  share it on the network; Back returns to the choice. Pairing and later
  servers reuse that name, in browsers too; a browser that switches to a new
  Couch finds it filled in on the pairing form. General owns this device's
  name, which is also the name of the server it hosts. An administrator
  connected to another host can rename that host in Devices. The Devices list
  manages pairings and roles. Unpaired browsers see only the pairing page: no sections
  that would lead back to it. The pairing dialog warns that browsers flag
  Couch's own certificate once, and closes itself when a device pairs, with a
  toast that names it ("Phone paired · admin").
- **Keyboard control stays inside Couch.** TanStack Hotkeys shares shortcuts
  between the browser and desktop window; Electron global shortcuts would also
  claim keys outside the app. The header's Keyboard shortcuts dialog is the
  user-facing reference. Keep transport shortcuts aligned with visible control
  capabilities, preserve Find's type-to-search, and let open panels, text entry,
  focused controls and TV navigation own their keys.
- **Up next is a deliberate list.** Keep Playing separate and Played collapsed.
  Compact artwork rows have one menu for Play next, ordering, Save for later
  and Remove. Removal leaves focus on an adjacent action menu. Save as list
  asks for a name and preserves errors there for retry. Queue-specific rows
  keep actions beside titles where MediaRow would stack them; shadcn/Radix
  Dropdown Menu supplies keyboard navigation and typeahead. Autoplay is a
  separate preview with a profile switch, continuing only the current series,
  album or playlist. Explicit queue entries play first. Stop clears the
  sequence; its end never starts recommendations.
- **Home is a timetable.** Each row names its section and the clock time it
  matters at ("ends 21:38", "until 23:10") in a left column, with its content
  on the right. Rows appear only when they have something in them: Now,
  Continue, For later, Radio, Played recently and Up next. Radio always has
  the built-in stations, so a fresh Couch opens on something playable. With
  nothing playing or to continue, the first show on air leads its row. A row's
  items keep the order they had when Home opened; a station that starts
  playing is marked Playing where it is. On the TV, Continue, Radio, For later
  and Played recently are shelves of tiles.
  Settings → Home controls each device's row visibility and order. Saved
  visibility always applies; Up next stays reachable from the mini player and the player band.
  Home ends with its content. Up next is off by default and, when enabled,
  appears as one ruler split by each entry's length.
- **Keep discovery context visible.** Opened shows, seasons and albums retain
  a contained cover and a short synopsis above their divided rows; a film or
  episode shows its synopsis under its title, never an empty About. Episode
  rows use their own descriptions when available; a show synopsis stays with
  the collection instead of pretending to describe each episode. A partly
  watched item's primary verb is Resume, with From start beside it. A series
  offers Play or Resume of its next episode, and with one season its episodes
  are on its own page. A detail page ends with its own content and never
  appends the source's catalogue. Posters and album art stay uncropped. This
  extends the existing shadcn Item-based MediaRow; no additional preview panel
  or per-result request is needed.
- **Details are destinations.** Item details and provider collections have
  their own URLs, resolved from stable item IDs or canonical provider URLs.
  Refresh loads the same content; Back restores the previous page, filters,
  scroll and focus. A provider search result's title opens its details; Play is
  a separate, explicit action, including on phones. StreamingCommunity's
  collections say Series or Season rather than List. Reuse PageHeader and existing media rows. Dialogs remain
  reserved for focused tasks such as pairing and source setup.
- **Browsing stays grounded.** The sticky header and scroll edges share the
  solid black page background on desktop and web. Native video alone clears
  its full-screen ancestors so the picture can show through. Source results
  pair artwork with available synopsis and episode metadata; collection
  headers contain their artwork instead of cropping covers. A collection
  without artwork shows a muted folder, not title initials.
- **Real content only.** A browse page shows what its source returns, never
  suggestions Couch picked. A source without a home page of its own (YouTube,
  Bandcamp, SoundCloud) opens on an Empty with a search field scoped to it.
  Find searches after one second without typing; Enter submits immediately.
  Its filters are Video, Music, Live, Radio and Channels. Music includes
  Bandcamp albums and tracks and SoundCloud tracks.
- **Time is the organising idea.** Every length is read as the clock time it
  ends: "4:52, ends 10:29". The band and mini player read "−3:24 ends 20:59";
  live reads "Live", with no total.
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
inversion. The TV has no hover: under `.tv-presentation` the `hover` variant
never applies, so a stray pointer can't compete with focus.

## Scale

`html` font size is `clamp(16px, 1.25vw, 24px)`. Use Tailwind's rem sizes so
the same typography and controls scale across screens. The TV uses its own
composition: fewer focus stops, a quiet local-name header and controls revealed
over the picture. Desktop and phone keep their browsing and Couch-switch controls.

| Role | Classes |
| --- | --- |
| Display (search field) | `text-3xl font-semibold tracking-tight` |
| Player artwork title | `text-2xl font-medium tracking-tight` |
| Page title | `text-2xl font-semibold tracking-tight` (use `PageHeader`) |
| Section title | `text-base font-medium` |
| Row title, settings label | `text-base` |
| Body, controls, metadata | `text-sm` (metadata adds `text-muted-foreground`) |
| Caption | `text-xs text-muted-foreground` |

Spacing uses Tailwind steps 1, 2, 3, 4, 6, 8 and 12, plus `gap-0.5`, `py-1.5` and `-ml-2.5` for compact rows and aligned controls. The page gutter is
`px-(--gutter)` (3rem, 1rem on phones). Two-column pages use a `12rem` rail plus `gap-12`, keeping each page’s breakpoint.
The shell's content wrapper sets the one top offset below the header (`pt-6`); pages add none, and Home's first row drops its rule.
Saved and Settings share one section nav: a rail with a check on wide screens and a Select on phones. On the TV, OK on a rail entry opens its page and moves focus to the page's first control.
Settings runs from identity (this device's name in General, then Devices) through Preferences, Media and Hardware to Updates, and opens on the first page; within a page, frequent settings come first and rare or destructive ones (admin handover, Forget) last. On the TV, Devices opens on Pair a device.

Controls are Mira-sized at `h-8 text-sm`. The `touch:` variant (phones and
windows narrower than 960px) raises every control to a 44px target; player-band controls are 44–48px on every screen, scaled in rem. Sonner toast
actions use its `actionButton` classes because its default height is 24px.

## Components

Prefer shadcn components from `src/client/components/ui`. Their files are
owned by Couch; the Mira defaults were changed only where Clock needs it:
`text-sm` controls at `h-8`, flat left-rule `Alert`, left-aligned borderless
`Empty`, no shadows.

Shared building blocks in `src/client/components`:

- `MediaRow` / `MediaList`: thumbnail, title, meta, length bar, one main verb
  and actions revealed on hover or focus. Home, Find and Saved. Every media
  row ends with the same verbs (`BrowseActions`): a filled ▷ for Play (Resume
  on Continue), then one "…" menu with Play on, Queue, Save and its other verbs.
  On the TV a row is one focus stop: OK does its main verb (Play for stations,
  channels and episodes, else Open), and its other verbs wait on its page.
  For later's Details keeps Remove with Undo and Move up/down. Rows whose
  destination does not hold every operation keep their existing Options and
  ordering controls: saved channels/stations, Live TV, and search hits without
  complete details actions. These exceptions preserve reachable operations
  without adding destinations solely for a menu.
  A live hit uses Play only while it is enabled; otherwise it retains its
  original Open destination, including during a pending Save. Busy actions
  keep their existing disabled state.
- `MediaTile`: one `Button` wrapping `MediaArtwork` (contained; 2:3 for films
  and series, 1:1 for stations and albums, 16:9 for videos and episodes), a
  title and one meta line, plus a `DurationBar` on Continue. It is one focus
  stop whose press does the item's main verb. The catalog has no media tile
  and Card breaks Flat, so a tile is the smallest Button composition. Shelves
  are plain overflow rows (`data-nav-row`), as Played recently already is:
  Carousel's own arrow handling fights spatial navigation, and focus scrolls a
  plain row into view.
- `BrowsePagination`: collection and radio lists keep count and Filter in fixed
  slots. Remote or multiple-page collections show Previous, "Page N of M" and
  Next, disabled when they can't move. A complete local collection on one page
  omits the inert pager, including a single season's episodes and a short list
  of seasons; its count still identifies the content. The page Select's trigger is
  borderless and transparent, in muted ink: it reads as the pager's
  "Page N of M" text between two ghost icon buttons, as shadcn Pagination's
  links do, and a bordered field there would be a panel inside the pager.
- `ContentBreadcrumb`: the path above a collection or item (Find, then Radio
  or the source, then the collection). It replaces a Back control, so its
  links are `text-sm`, the controls' size, rather than Mira's `text-xs`
  caption size, and each is `min-h-11`, a 44px target on every screen.
  The ordinary player's fixed-height header uses a compact trail of the same
  collection links, with single-line, truncated labels and at least `min-w-11`
  targets. Its title already appears in the player; Find and the provider remain
  in the full browse trail. Without a collection, the player links to Radio,
  its provider or Find. The Couch switch takes at most two fifths of the header's
  content width so a long device name leaves room for the trail. The
  [shadcn Breadcrumb](https://ui.shadcn.com/docs/components/radix/breadcrumb)
  supports composing links, but its wrapping default overlaps the switch on a
  phone; a collapsed menu would add a step to these existing destinations.
  The ordinary player's transient Buffering status has its own row above the
  transport: keeping it beside two 44px collection links
  obscures a link and clips the status at 320px and 130% interface size.
  The scoped Remote header keeps its own status arrangement.
- `SettingsRow` / `SettingsSection`: label and control on divided rows.
- `PageHeader`: title with optional back and actions.
- `ChoiceGroup`: inline choices with a check on the selected option.
- `DeviceIcon`: the lucide icon beside every Device's name in Where it plays'
  rows, familiar like Spotify's device picker. Device icons stand only for Devices: Where it plays' opener is a mixer
  icon and the "on {name}" status line is plain text. Picture and
  sound: `MonitorSpeaker`; picture: `Monitor`; sound: `Volume`, `Volume1` or
  `Volume2` by its volume (0, up to 50, above); muted: `VolumeX`. Idle, a plain
  `Monitor` in muted ink; offline, dimmer still. `aria-hidden`. It replaced a
  custom two-cell glyph that people couldn't read.

Release notes use `react-markdown` with GitHub-flavoured Markdown because the
[shadcn catalog](https://ui.shadcn.com/docs/components) has no Markdown renderer.
They sit in the settings row's content column, where block content is valid and
has room to read. Keep the parser's safe URL handling and omit raw HTML.

Messages:

- **Toast** (`sonner`) at bottom right for errors, removal/Stop Undo, other people's activity and unexpected outcomes. Successful explicit Queue confirms `Queued {title}` with Up next on the requesting controller, idle or playing; other controllers and queue snapshots stay quiet. Other routine user-triggered actions stay quiet. One line, at most one action.
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
  Couch switch: the server this window shows, with its connection status.
  The phone and desktop header holds the section nav, including Remote,
  and the Couch switch. Wide screens also show the clock and, outside Remote,
  Keyboard shortcuts; the player's header carries the switch too.
  The TV uses its local name instead of the
  switch and omits Remote and Keyboard shortcuts. The Popover reuses Settings → Devices' Couch
  choice: saved servers, the app's This computer option, and another address.
  On the host with sharing on, it ends with Pair a device. It scrolls within
  the available space and keeps the same flat, divided settings rows.
  Switching servers returns to that controller's live output mix, or the
  server's own outputs when the previous mix is gone, or this Device when
  those are offline. Ordinary Play keeps the
  mix; Where it plays and explicit Play on choose where it plays.
- **Where it plays** is one icon button in the band and the mini player, a
  mixer (`SlidersVertical`) with no Device name or DeviceIcon, so it can't be
  mistaken for the header's Couch switch. It opens a bottom Sheet of divided
  rows (`Item`). The first row, set off by a rule like a console's master
  fader, is All: its fader trims only the selected speakers you may control from
  100 (the Device levels) to 0 (silent), and the Playback keeps it across restarts.
  Private speakers keep their own attenuation; new private sound and revoked
  foreign influence return to their own level. Sharing audio again joins All. It
  shows its own trim, preserves Device levels and mute, and keeps outputs
  selected at zero so raising it restores their sound; it has no Picture, Only here
  or Mute. Its label is "Selected sound you can control": shared sound and this
  Device's own private sound. Then one row per Device:
  the Playback's Devices first (offline ones
  dimmed, their controls disabled), then this Device and the other online
  Devices that share audio or video, dimmed but operable when a move would not
  replace a private channel. This Device is listed even when it shares neither,
  so it can add itself here as well as with Play on → This device; another
  Device that shares neither is listed only while it is an output. A row reads
  the Device's icon, name and what it is doing, then Picture (pressed toggles
  invert, because Toggle's muted pressed state barely shows on black), the
  fader with its number, Mute and Only here (pressed, they invert too). What a
  Device is doing includes another Playback, with its status ("Paused
  {title}"): moving a Device that is busy elsewhere interrupts that Playback,
  so the row says so before you press. Joined outputs keep the current
  Playback's factual status too; unused devices say "Not playing here".
  Private picture/sound names the consent boundary and disables changes to
  that channel for other devices; shared sound can still be muted beside a
  private picture. This Device retains local controls even while viewing
  another Playback; Only here still requires consent to replace the destination's
  whole output. These statuses describe playback and consent, never whether
  sound can be heard.
  On phones controls wrap below name/status and Only here. Names and busy titles
  wrap without ellipses; the Sheet scrolls vertically. On wider screens the
  name/status, Picture, horizontal fader, number, Mute and Only here align in a row.
  Its controls and slider tracks have at least a 44px target at the base scale.
  The fader is the Device's one volume while its sound is in, else 0: 0 turns
  its sound off and raising it turns it on. Rows show saved levels
  independently of All's trim. A row's "Sync … ms earlier" slider, shown under
  its fader while its sound plays in sync with other devices, plays a late
  speaker sooner (Sendspin's static delay); "Delay" read as the opposite, and
  "Sync" keeps it apart from Playback's audio delay against the picture. With
  one receiver there is nothing to align, so the row shows the saved value and
  when it applies instead of a control that would do nothing. Only here
  (formerly Solo) keeps the Playback only on that Device,
  with its picture when the Playback has one, so moving a Playback is one
  press. It is unavailable while another device's private output plays in it,
  since that output would stay. A shared source waiting for
  receivers opens Where it plays for each request to choose; dismissed, it
  stays closed through unrelated updates. The band and mini player volume shows the loudest in-sound Device's,
  or 0 while All is at 0, and moves them all together (from All's 0, raising it
  only brings All back to 100 and lowering it does nothing); their Mute mutes
  them all, and so does M.
- **Play on** in item menus offers This device and the other online Devices
  that share, hidden while this is the only one; the primary Play says "Play on
  {name}" while you control another Device, and a "Playing on {name}" toast
  confirms it. The mini player, the player's summary and Home's Now row say
  "on {name}" (+N) whenever the controlled Playback plays anywhere but only here.
- **Remote** is a section on Devices that aren't TVs. It selects a TV to
  control without joining or moving its outputs. With two or more TVs, a
  Select picks one; offline or private TVs cannot be controlled. A D-pad of
  `Button`s sends one direction per press, with OK, TV Back and TV Home.
  The shared transport, timeline and volume controls act on that TV; Up next
  retains the same target for queue actions, shortcuts and Undo. Commands
  reject a disconnected, revoked or reassigned target rather than act on a
  different TV. The mini player hides on Remote.
  Type on TV is an `InputGroup` for the TV's focused Find field or its own
  Device name. Send replaces the draft; Clear sends an empty draft. Only
  Enter on TV submits the existing search or name form. Typing and reconnecting
  do not send an unsaved draft, and no field is chosen automatically. Pairing
  codes, source URLs and administrative fields are unavailable. Status and
  disabled controls explain unavailable targets and fields. The TV itself
  has no Remote section or on-screen keyboard.

## Copy

Sentence case, short, no filler. Say what happened and what to do next.

| Say | Not |
| --- | --- |
| the device's name, or Couch | host, playback host/computer/device, coordinator, installation |
| This computer, This device | this installation, this app |
| Where it plays, Picture, Only here, Mute, All | Mixer, Speakers panel, look at, host |
| Play on {name}, Playing on {name} | Send to, Cast to |
| device (a phone, browser, app window or TV) | remote (for a device), controller, client |
| Remote (the section that drives a TV) | TV remote, remote control |
| Share on network | Allow remotes, remote control |
| admin, Make admin, Become admin | administrator, Claim administration |
| Up next (the list), Queue (the verb) | shared queue, Add to Up next |
| Saved, Save / Saved | Kept, Keep, favorites |
| Live TV, Radio playlists | IPTV, TV guide |
| Try again | Retry, Reload, Refresh |
| Couldn't load X. | Could not…, Check the connection and… |
| Offline. Reconnecting to {name}… | 30 variants of "Reconnect to…" |
| Only an admin can change this. | 20 variants of "An administrator can…" |

Play on targets sit in a labelled group inside search result menus, with device names that can wrap. A nested flyout left too little width on a 320–390px phone at larger interface sizes. Use the standard dropdown Group and Label, and bound long menus to the available viewport height so keyboard and touch can reach every target. The separate inline Play on menu uses the same target rows.
