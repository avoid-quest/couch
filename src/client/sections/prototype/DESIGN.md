# Couch UI redesign — reference ("Clock")

PROTOTYPE reference for the TV and desktop redesign. The prototype in this folder is
throwaway code. Copy its decisions, not its code. The real build must use Couch's shadcn
components, as `AGENTS.md` requires.

## Run it

1. Start the dev server with a scratch data folder:
   `COUCH_DATA_DIR=/tmp/couch-proto-data bun run dev`
2. Open http://localhost:1420 and pair with the code the server prints.
3. Open http://localhost:1420/prototype and add `?screen=tv` for the true 1920×1080 canvas.

The prototype bar at the top only exists in dev builds:
- `\` hides or shows the bar.
- Video, Music, Radio, Live, Loading, Buffering, Retrying, Error and Nothing jump the player to that case.
- Controller, Offline and First run switch the app state.
- Desktop and TV switch the screen.

Search is real (the provider, radio and library APIs). Opening a channel or playlist is real (`/api/providers/{id}/items?url=`). Everything else is simulated:
- Playback is a stub. Muted YouTube and Twitch embeds stand in for mpv.
- Settings, Saved lists and the device list are fixtures.

Files:
- `Couch.tsx`: the app root, player, Find, and the actions on each row.
- `Shell.tsx`: top bar, Playing on popover, pairing, Saved, Settings, first run.
- `Looks.tsx`: the Clock tokens and how rows are drawn.
- `proto-data.tsx`: data and the simulated player.

## How we got here

- Round 1 was rejected. It had four metaphor UIs: Sentence, Poster, Stage and Index. The metaphors got in the way of playing things.
- Round 2 was rejected. It had interaction gimmicks: cinema masking bars, channel zapping, shrink-to-tile, type-over.
- The rule that came out of it: **structure is conventional and efficient** (Netflix without recommendations or branding), and **the avant-garde lives in the visual style and in functional decisions**, never in how the main actions work. Couch runs on many devices, so novel interaction models aren't worth it.
- Three looks were compared on one shared layout: Clock, Colour and Focus. **Clock won.**
- User feedback that shaped the rest:
  - "Useless" red live bands were removed.
  - The home was trimmed.
  - The **whole app** has to be covered: Settings, Play on, pairing and the rest, not just the player and search.

## Round 3 (rejected)

Three restyles of Clock were built without asking and rejected: Numerals (giant end times), Inversion (difference-blend bars, band as progress) and One size. The user called them fancy changes that were neither functional nor outstanding. Don't restyle for its own sake. Improve Clock through craft and UX, and propose before building.

A look is still `{ name, font, vars, Results, css }` in `Looks.tsx`. Its `css` is scoped to `[data-look]`, and it restyles the shared markup through its `data-*` markers.

## Round 4: craft and shared-media-center UX (accepted to build)

Couch is **shared** (several remotes, one TV) or **personal** (your own computer). What was built:

- **Who did what:**
  - Up next rows say "added by iPad".
  - The player's meta line says "started from Pixel 8" when someone else started it.
  - Other people's actions show as short notices ("iPad paused", "Pixel 8 added Xtal") that never take focus.
- **Undo, not confirm, for shared actions:** Play replacing what's on, Stop, Remove from Up next, Remove from Continue and Delete list all happen at once, with a 6 s Undo notice.
  - Switching device and admin actions (Restart, Remove source, Forget, Disconnect) keep an inline confirmation.
- **Here or there:**
  - The top bar says "Playing here" on the device that plays, and "Playing on Kitchen" when controlling another Couch.
  - In that remote case the player replaces the picture with "Playing on Kitchen. The picture and sound are on Kitchen. Everything here controls it."
  - On your own computer the mini player gets volume.
  - Saved says "Shared with everyone who uses Living room", because For later and Lists are per TV.
- **Empty states that lead:**
  - A fresh install's Find says what Couch can search.
  - Administrators see the device's sources with their state and "Add a source", which opens Settings on the Sources page.
  - A failed search says what was searched and suggests pasting a link.
  - An empty Up next says how to fill it.
- **Craft:**
  - TV-safe gutters of 3rem (72px at 1080p).
  - The current tab is marked with an underline, so focus inversion stays unambiguous.
  - Queue rows show actions only on focus or hover, so titles get the room.
  - Up next says "9 to play, done by 18:58".
  - Notices sit just above the band or the mini player, and to the left of an open panel.
  - One transition: the mini player grows into the player's band and back (View Transitions, off under reduced motion).
- **Prototype bar:** Fresh (a new install) and Someone acts (a simulated remote) were added. The bar collapses to a pill; hover to expand.

## Principles

1. **Time is the organising idea.** Every length is drawn to one log scale, from now to four hours ahead, and read as the clock time it ends: "4:52, ends 10:29".
   - The player shows "−2:53 ends 10:27".
   - Up next shows when each item starts.
   - Continue shows "Resume at 25:27, 49:23 left, ends 11:04".
2. **The picture is never covered by a scrim.** Controls sit on one solid band at the bottom and panels are solid sheets.
3. **Colour only when it means something.** The interface is black and white and the picture brings the colour. There is no red for live; live is just the word "Live" and a plain full-width line.
4. **Minimal means nothing that doesn't help you pick or control something.**
   - No recommendations, recently played, rails, heroes, totals or eyebrow labels.
   - Filters appear only once there is something to filter.
5. **One layout, scaled proportionally.** 1rem is 1/80 of the width (24px at 1920). TV and desktop look identical, and the remote and mouse drive the same screens.
6. **One verb per job, the same everywhere:** Play, Play next, Queue, Save, Open, Resume, From start, Remove.

## Tokens (Clock)

| Token | Value | Use |
|---|---|---|
| `--ground` | `#000` | page and band background |
| `--ink` | `#fff` | text and bars |
| `--line` | `rgb(255 255 255 / .2)` | hairlines, empty bar track |
| `--focus` / `--focus-ink` | `#fff` / `#000` | focused control is inverted |
| muted text | ink at 55–70% opacity | metadata |

- **Type:** Inter Tight throughout, tabular numbers for every time.
- **Scale:**
  - Search field 2.4rem.
  - Player title 2.1rem.
  - Row title 1.1rem.
  - Metadata 0.8–0.9rem.
- **Shape:** 0.25rem radius on controls. No shadows, gradients or blur.
- **Focus:** the focused element inverts to white with black text. That is the only focus treatment, and it reads from the sofa.

## Screens

```
┌ Find  Saved  Settings ─────────── ● Playing on Living room   Pair a remote   10:24 ┐
│  (Reconnecting banner, only when offline)                                           │
│  page                                                                               │
└ ▮▮ Vordhosbn  2:00 / 4:52, ends 10:17 ────────────────────────────────── Resume ─┘
```

### Player (full screen, Back goes to the last page)

**The band**, top to bottom:
- **Title row:** ‹ back to the last page, the title, then "artist, source, started from <device>". While offline this reads "Reconnecting to <host>".
- **Timeline:** seekable with ←/→ in 10-second steps. Chapters are cut into the bar only when the source provides them. Live media gets a plain full line with no seeking.
- **Time row:** the elapsed time and the current chapter; on the right, "−remaining ends HH:MM". Live media shows "Live" and, for radio, the song on air now.
- **Controls:**
  - Play/Pause, Back 10, Forward 10, Next, Stop.
  - "Next: <title> in 2:53, then 6 more", which opens Up next.
  - Mute with the volume level.
  - Audio & subtitles (video only).
  - Settings.

**Behaviour:**
- The band hides after 4 s while playing. It stays pinned while paused, on an error, or while a panel is open.
- The first key press only brings the band back and focuses the timeline.

**Panels** (a right-hand sheet; Back closes it and returns focus to its button):
- **Up next:**
  - "Keep as a list".
  - Each row shows the title and "starts HH:MM", with Earlier, Later, Save and Remove.
  - A Played list is shown below.
- **Audio & subtitles:**
  - Subtitle tracks, Add subtitle file, Save as default.
  - Audio tracks, Save as default.
  - Subtitle timing.
- **Settings:**
  - Chapters (jump), Speed (Save as default), Quality (video), Volume levelling.
  - Volume and audio timing.

**Audio stage (music and radio):** artwork on the left, a large title, artist or station, and for radio "Playing now: <ICY track>".

**States:** loading, buffering, reconnecting and errors each show a solid card with verbs:
- Loading: "Asking YouTube for the stream".
- Buffering: a small tag.
- Reconnecting: "Next try in 8 s. Attempt 2 of 5", with Try now and Skip.
- Errors: the error text depends on the media (video / file / stream / station), with Try again, Skip and Find something else.

### Find

- **Search field:** "Search, or paste a link". Typing anywhere goes to the field.
  - ↓ or Enter goes to the results; ↑ goes to the top bar.
  - Open file sits beside the field (desktop app).
- **Home (empty query):** Continue (unfinished only) and For later (saved media). Nothing else. On a fresh install it's just the field.
- **Filters** appear only with a query:
  - **From:** only sources that returned something, with counts. "Still asking Twitch…" shows while a source loads.
  - **What:** Video, Music, Live, Radio, Channels.
  - **Length:** Under 10 min, 10 min to 1 hour, Over an hour.
  - Counts are computed with the other filters applied, and options with no results are disabled.
- **Rows:** thumbnail, title, "artist, source", then the length bar with its end time. The description shows on focus.
  - The main button depends on the kind: **Play**, **Resume** (Continue) or **Open** (channel or playlist).
  - Actions appear on focus or hover:
    - Media: Play next, Queue, Save.
    - Continue: From start, Queue, Remove.
    - Channels: Save.
  - Right arrow stops at the end of a row.
- **Open (a channel, playlist or series):** "‹ Results", the title, Play all, Queue all, Save, then the same rows.
- **Pasted link:** a link card with "Open as Webpage / Direct media", Quality, Play and Queue.

### Saved

A side list with three tabs:
- **For later:** media.
- **Channels and stations:** saved channels, playlists and radio stations. One Save verb covers everything.
- **Lists:** "Keep Up next as a list"; each list shows its item count and total length.
  - Inside a list: Play, Add to Up next, Update from Up next, Delete.

### Settings

A rail of groups on the left and the page on the right. Each row is a label with inline choices, a value or actions.
- **Choices:** the selected option carries a check.
- **Risky actions** (Restart, Remove, Forget, Disconnect, Clear token) ask inline first.
- **Long actions** (scan, check updates, test tone, search Bluetooth, diagnostics) show progress, then the result.
- **A new display** is kept only if confirmed within 20 s.

Pages mirror `sections/settings/**`:
- **Playback:** Playback, Appearance.
- **Library:** Sources (TV folders, Jellyfin, Live TV/IPTV, Radio playlists, StreamingCommunity, film and series details/TMDB).
- **<device name>:** General, Sound, Display.
- **Connections:** Remotes, Bluetooth.
- **System:** Updates, Advanced.

**Roles:**
- An administrator sees everything.
- A controller loses Sound, Display, Bluetooth, Updates and Advanced.
- For a controller, General and Sources are read-only and Remotes becomes "Claim administration".

### Global

- **Playing on <host>** (popover), used for both where and how it plays:
  - Play on: this computer, a known Couch, or a typed address.
  - Switching asks "Stop and switch" or "Keep <host>".
  - Sound output and volume on that host, plus a link to sound settings.
- **Pair a remote** (administrators only): QR, address and a 6-digit code.
- **Offline:** a banner under the top bar, and the player band's meta line says it is reconnecting.
- **First run:**
  - "Where do you want to play?" leads to either:
    - **This computer**: then "Allow remote control?".
    - **Another Couch**: type its address, then pair with a code.
- **Mini player** on every page: pause, title, time and end time, and Resume. A 1px progress line runs along its top.

## Remote (D-pad) rules

- Arrows move focus spatially (`navigation.ts`), Enter activates, and Back goes back.
- **Back order:** overlay → panel → in-page back (a list or channel) → page → Find → player.
  - Back on Find with a query clears the query first. Otherwise it returns to the player.
- **Explicit hops where spatial movement would guess wrong:**
  - Search field ↑ goes to the top bar, and ↓ goes to the first result.
  - Top bar ↓ goes to the first control on the page (`data-page-first`).
  - Timeline ↓ goes to Play/Pause.
- Focus is never lost when content changes: opening or closing a list, collection, panel or overlay moves focus to a real control.
- All of this was checked on the TV canvas using only the arrow keys, Enter and Esc.

## For the real build

- **Fix `index.css` first.** Its unlayered legacy rules (`h1`/`h2`/`p` sizes and margins, `[data-keyboard] :focus`) override Tailwind utilities. The prototype had to force `h2` sizes with `!`.
- **Map the prototype onto existing components** rather than new ones:
  - The shadcn Button, Tabs/ToggleGroup for choices, Sheet for player panels, Popover for Playing on, Dialog for Pair.
  - The existing `PlaybackSettings`, `QueuePanel`, `PairingDialog`, `SourceSetupDialog`, settings pages, `SaveForLater`, `QualitySelect`.
- **Server gaps the design assumes:**
  - **Play next:** insert after the current item. Today Up next only appends.
  - **Previous track:** not in the design yet.
  - **Remove from Continue:** use the existing progress action "Clear resume point".
  - **Save:** merge For later and Kept behind one verb, or keep two stores behind one button.
- **Implemented in the app today but not reachable, and still undecided:** TV guide/IPTV channels, browsing movies, shows, music and collections, and the `/music` and `/radio` pages.
- **Profiles:** Couch has no profile switching, so the design has none.
- **Remote pad:** the phone stays a controller and the RemotePad stays phone-only.
