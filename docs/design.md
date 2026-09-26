# Couch design system

Couch is one app on three kinds of screen: the TV (driven by a remote), a
desktop window (mouse and keyboard) and phones (touch). The look is **Clock**:
black ground, white ink, hairlines. The picture brings the colour.

## Brand mark

Shift carries the avoid.quest disc and horizontal cuts, with its lower half moved
right. Desktop icons use the black tile in `src-tauri/icons/icon.svg`. The macOS
tray uses a transparent template silhouette so the system can tint it. The PWA
maskable icon uses a full black background and keeps the mark inside the safe
circle. The website uses a custom SVG for this product mark because the shadcn
catalog provides interface icons, not brand identities.

## Principles

- **Conventional structure, quiet style.** Home, Find, Saved and Settings, a
  full-bleed player with a compact bottom control band, and "Playing on" one
  step away.
- **The player is one tap away.** The mini dock opens the player through its
  artwork and title, with direct transport and Up next actions. Volume uses
  an inline slider where space permits and a Popover in compact windows.
  Audio and remote playback place contained artwork beside a persistent
  desktop queue. On phones, Up next replaces the artwork while transport stays
  available. Video uses the full viewport until Up next opens beside it.
  Queue navigation survives playback changes; track-specific settings reset.
  Transport, volume and tools share one bottom dock across media modes. Keep
  unavailable controls in their slots so loading and queue changes preserve
  muscle memory; adapt the rows to screen width, with content above the dock.
  Audio keeps its solid controls visible. Video controls fade over a transparent
  black scrim, preserving the picture bounds; the gradient exists only to keep
  overlaid text readable without an abrupt edge that resembles cropping. Hidden
  controls are inert and let pointer input reach the video. The player fits the
  viewport at every interface size. Plain playback glyphs keep artwork central;
  Playback settings use Sheets. Stage CSS handles native video bounds
  and the responsive queue workspace; controls reuse shadcn components.
- **Keyboard control stays inside Couch.** TanStack Hotkeys shares shortcuts
  between the browser and desktop window; Tauri global shortcuts would also
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
  nothing playing or to continue, the first show on air leads its row.
  Settings → Home controls each device's row visibility and order. Saved
  visibility always applies; the header keeps Up next reachable while stopped.
  Home ends with its content. Up next is off by default and, when enabled,
  appears as one ruler split by each entry's length.
- **Keep discovery context visible.** Opened shows, seasons and albums retain
  a contained cover and a short synopsis above their divided rows. Episode
  rows use their own descriptions when available; a show synopsis stays with
  the collection instead of pretending to describe each episode. Posters and
  album art stay uncropped. This extends the existing shadcn Item-based
  MediaRow; no additional preview panel or per-result request is needed.
- **Details are destinations.** Item details and provider collections have
  their own URLs, resolved from stable item IDs or canonical provider URLs.
  Refresh loads the same content; Back restores the previous page, filters,
  scroll and focus. Reuse PageHeader and existing media rows. Dialogs remain
  reserved for focused tasks such as pairing and source setup.
- **Browsing stays grounded.** The sticky header and scroll edges share the
  solid black page background on desktop and web. Native video alone clears
  its full-screen ancestors so the picture can show through. Source results
  pair artwork with available synopsis and episode metadata; collection
  headers contain their artwork instead of cropping covers.
- **Time is the organising idea.** Every length is read as the clock time it
  ends: "4:52, ends 10:29".
- **Colour only when it means something.** Destructive red is the only colour.
  Live is the word "Live", not a red badge.
- **Flat.** Open typography, whitespace and divided rows. No Cards, bordered
  panels, shadows, gradients or blur.
- **One verb per job**, the same everywhere: Play, Play next, Queue, Save,
  Open, Resume, From start, Remove.
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
focus treatment; white controls (slider, Switch, Checkbox and RadioGroupItem) use a 2px foreground outline with a 2px offset on `:focus-visible` (see the unlayered rule in `index.css`).

**Hover** uses a white tint on actions, brighter field borders and quiet rings on
small controls. Reuse shadcn variants; artwork-only buttons dim the image because
it covers their background. Keep hover on enabled controls and preserve focus inversion.

## Scale

`html` font size is `clamp(16px, 1.25vw, 24px)`: 1rem is 1/80 of the width, so
the TV and a desktop window show the same layout. Use Tailwind's rem sizes only.

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
  and actions revealed on hover or focus. Home, Find and Saved.
- `SettingsRow` / `SettingsSection`: label and control on divided rows.
- `PageHeader`: title with optional back and actions.
- `ChoiceGroup`: inline choices with a check on the selected option.

Release notes use `react-markdown` with GitHub-flavoured Markdown because the
[shadcn catalog](https://ui.shadcn.com/docs/components) has no Markdown renderer.
They sit in the settings row's content column, where block content is valid and
has room to read. Keep the parser's safe URL handling and omit raw HTML.

Messages:

- **Toast** (`sonner`) at bottom right for errors, removal/Stop Undo, other people's activity, diagnostic results and unexpected outcomes; routine user-triggered actions stay quiet. One line, at most one action.
- **Alert** for a persistent problem on the page. `variant="destructive"` for
  errors; put Try again in `AlertAction`.
- **Empty** for empty states. Say what goes here and offer the next step.
- **Status line** (`Spinner` and muted text) for work in progress.
- **Dialog** for short focused tasks (pairing, source setup); **AlertDialog**
  for confirmations; **Sheet** for player panels; **Popover** for "Playing on".

## Copy

Sentence case, short, no filler. Say what happened and what to do next.

| Say | Not |
| --- | --- |
| the device's name, or Couch | host, playback host/computer/device, coordinator, installation |
| This computer / Playing here | this installation, this app |
| remote | controller, client, browser |
| admin, Make admin, Become admin | administrator, Claim administration |
| Up next (the list), Queue (the verb) | shared queue, Add to Up next |
| Saved, Save / Saved | Kept, Keep, favorites |
| Folders, Jellyfin, Live TV, Radio playlists, Movie & show info | TV folders, IPTV, TV guide, metadata |
| Try again | Retry, Reload, Refresh |
| Couldn't load X. | Could not…, Check the connection and… |
| Offline. Reconnecting to {name}… | 30 variants of "Reconnect to…" |
| Only an admin can change this. | 20 variants of "An administrator can…" |
