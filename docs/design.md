# Couch design system

Couch is one app on three kinds of screen: the TV (driven by a remote), a
desktop window (mouse and keyboard) and phones (touch). The look is **Clock**:
black ground, white ink, hairlines. The picture brings the colour.

## Principles

- **Conventional structure, quiet style.** Find, Saved and Settings, a
  full-bleed player with one solid control band, and "Playing on" one step away.
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
focus treatment (see the unlayered rule in `index.css`).

## Scale

`html` font size is `clamp(16px, 1.25vw, 24px)`: 1rem is 1/80 of the width, so
the TV and a desktop window show the same layout. Use Tailwind's rem sizes only.

| Role | Classes |
| --- | --- |
| Display (search field, player title) | `text-3xl font-semibold tracking-tight` |
| Page title | `text-2xl font-semibold tracking-tight` (use `PageHeader`) |
| Section title | `text-base font-medium` |
| Row title, settings label | `text-base` |
| Body, controls, metadata | `text-sm` (metadata adds `text-muted-foreground`) |
| Caption | `text-xs text-muted-foreground` |

Spacing uses Tailwind steps 1, 2, 3, 4, 6, 8 and 12. The page gutter is
`px-(--gutter)` (3rem, 1rem on phones).

Controls are Mira-sized at `h-8 text-sm`. The `touch:` variant (phones and
windows narrower than 960px) raises every control to a 44px target.

## Components

Prefer shadcn components from `src/client/components/ui`. Their files are
owned by Couch; the Mira defaults were changed only where Clock needs it:
`text-sm` controls at `h-8`, flat left-rule `Alert`, left-aligned borderless
`Empty`, no shadows.

Shared building blocks in `src/client/components`:

- `MediaRow` / `MediaList`: thumbnail, title, meta, length bar, one main verb
  and actions revealed on hover or focus. Find, Saved and Up next.
- `SettingsRow` / `SettingsSection`: label and control on divided rows.
- `PageHeader`: title with optional back and actions.
- `ChoiceGroup`: inline choices with a check on the selected option.

Messages:

- **Toast** (`sonner`) for results of an action, other people's activity and
  Undo. One line, at most one action.
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
| Couch, or the device's name | host, playback host, coordinator, installation |
| remote | controller, client |
| administrator | admin, manager |
| Up next | queue (in UI copy) |
| Saved | kept, favorites |
| Sources | providers, catalogs |
