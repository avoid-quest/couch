# Find and play anything

Status: wip · Scenes: personal, group, home

Someone types a name they half remember, or pastes a link from a group chat: a
SoundCloud set, a Bandcamp collection, a radio show's page. Couch finds it across
every source, past radio shows included, and plays it, or the whole list, in one
press.

## Journey

1. **Search**: type a name, a DJ, a show or a style. Accents don't matter: `dj ale`
   finds **DJ Alé**. The best match comes first and stays put while other sources
   answer.
2. Narrow with a kind or a source: **Radio archives**, **Music**, **Mixcloud**,
   **YouTube**… (pick it, or type its name and Tab). Only those sources are asked.
3. A result's press does its main thing: **Play** an episode, track or station,
   **Open** a film or series; its menu has **Queue** and **Play next**.
4. **Paste a link**. One thing (a track, mix, episode or video): **Play**,
   **Queue**, **Play next**. A list (a SoundCloud set, a Bandcamp album, collection
   or wishlist, a YouTube playlist, a Mixcloud user, a radio show or a station's
   style page): **Play all**, **Queue all**, **Play next** or **Open**. Play all
   plays the first and Autoplay carries on through the rest; a list longer than
   Up next holds queues its first 500.
5. **Radio archives**: past shows of the built-in stations (Lyl Radio, NTS,
   Cashmere, Sygma, HKCR, Internet Public Radio, Radio BlackOut, Resonance Extra,
   Radio Alhara) play like any episode; a show opens its episodes, newest first.
6. On the player and a station's page, the DJ, show and style names search for
   more of the same.
7. A **Spotify** link plays each song from YouTube, matched by title, artist and
   length; Up next says where it plays from.
8. **Up next** → **Clear Up next** empties it, with **Undo**.

## Done when

- Every link in the demo plays, or opens and plays whole, from the search field.
- `DJ alé` and `dj ale` both find the Lyl Radio episode.
- Choosing a kind or a source asks only those sources.

## Demo

Needs: the Couch computer and a phone. Content:
`soundcloud.com/bubble_wrap/sets/imballata-on-radio-blackout`,
`lyl.live/episode/ghettology-2`, `lyl.live/shows/residents?styles=Baile%20Funk`,
`radioblackout.org/shows/arsider/`, `radio.syg.ma/shows/hypersigil`,
`www.nts.live/shows/minimal-effort`, `bandcamp.com/umbertopasinetti/wishlist`, a
Spotify album, and a search for `DJ alé`.

## Known issues

- A Spotify song can match the wrong recording; **Try again** picks again.
