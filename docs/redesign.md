# Redesign brief

Couch is moving to a classic ten-foot media-centre structure while keeping
Clock's look (black ground, white ink, hairlines, focus by inversion, no
cards). This brief is the target for the `t3/redesign/*` stack. It is
temporary: each layer moves its decisions into the surface docs under
[`design/`](design.md#surfaces) as it lands, so those docs keep describing the
code, and deletes its section here. The last layer deletes this file.

Read [`design.md`](design.md) first; this brief changes structure, not tokens,
type or copy rules.

## Direction

- **Top shelf.** Home opens on one large item, then shelves of tiles, the way
  Apple TV and Infuse do. Every screen uses the same sections and the same
  component tree; the TV, the desktop window and phones differ in layout,
  not in which components they render.
- **A departures board.** Couch's organising idea stays time. The hero is the
  board's top line: its end time ("ends 21:42", "until 23:10") is the largest
  text after the title, in tabular figures. Spend boldness here and keep
  everything around it quiet.
- **Artwork as it comes.** Providers give thumbnails, not backdrops. Artwork is
  always contained at its own aspect ratio (2:3, 1:1, 16:9) on black. Never
  blur, stretch or crop it into a background.
- **Fewer exceptions.** A rule that needs an exception for one surface is a
  sign the structure is wrong. Prefer changing the structure.

## Deferred

- A Live TV programme grid, and any Core endpoint it would need.
- `apps/web`, the couch.avoid.quest site.
- Settings restructuring beyond fitting the new shell: #761 just settled its
  two owners.

## Layers

Each layer is one PR on the layer below. The title is the PR title and becomes
release notes ([ci.md](ci.md)).

| Branch | Title | Scope | Updates |
| --- | --- | --- | --- |
| `spec` | Describe Couch's redesigned interface | this brief; design docs split by surface | `design.md`, `design/`, `AGENTS.md` |
| `foundation` | Prepare the interface for its redesign | one presentation module; a TV presentation override for scratch and browser checks, unreachable in release builds; no visual change (landed) | `design/tv.md` |
| `shell` | Navigate Couch with tabs and a now-playing bar | Shell; new section paths with redirects; existing pages render inside them (landed) | `design/shell.md` |
| `home` | Open Home on what you'll most likely play next | Home (landed) | `design/home.md` |
| `browse` | Search everything and open each source from its own home | Search, source homes, details (landed) | `design/browse.md` |
| `live-library` | Find radio and channels in Live, and what you keep in Library | Live, Library (landed) | `design/browse.md` |
| `player` | Show the time and title over the playing picture | Player (landed) | `design/player.md` |
| `where-it-plays` | Choose where it plays from a simple list of devices | rules model and tests; picker (landed) | `design/where-it-plays.md` |
| `devices` | See every device and what it plays on one page | overview (landed) | `design/where-it-plays.md` |
| `remote` | Drive the TV from a classic remote on your phone | Remote; Settings fitted to the shell; delete this brief | `design/remote.md`, `design/settings.md` |

## Every layer

- **One tree.** Render one component tree per surface. Express TV and touch
  differences with the `tv:` and `touch:` variants. Keep a
  `tvPresentation` branch only where behaviour differs, such as focus stops
  or keys, and convert the branches in the files the layer rewrites.
- **shadcn first.** Reuse `src/client/components/ui`, and check the
  [catalog](https://ui.shadcn.com/docs/components) before building anything
  custom. Record the gap that justifies any custom component in its
  surface doc.
- **Keep the hooks.** The browser checks (`tests/tv-navigation.browser.ts`,
  `tests/tv-continue.browser.ts`) find elements through `data-*` attributes,
  `aria-label`s and paths. A layer that moves one updates those checks in the
  same layer.
- **Green before done.** These must pass on the layer's branch:
  - `bun run typecheck`;
  - `bun run build`;
  - `bun test` on every `tests/*.test.ts(x)`;
  - the `tests/*.integration.ts` files covering the layer's surface, run as
    [ci.md](ci.md) describes.
- **Seen on three screens.** Run a scratch Couch with its own
  `COUCH_DATA_DIR` and `COUCH_PORT`, and stop it by PID afterwards. Take
  before and after screenshots of the layer's surface at 1920×1080 in TV
  presentation ([in a browser](design/tv.md#see-the-tv-in-a-browser)),
  1440×900 on desktop and 390×844 on a phone.
- **Docs follow code.** Move the layer's decisions from this brief into its
  surface doc, and delete them here.
