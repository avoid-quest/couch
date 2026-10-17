# Home

## Home is a timetable

Each row names its section and the clock time it
matters at ("ends 21:38", "until 23:10") in a left column, with its content
on the right. Rows appear only when they have something in them: Now,
Continue, For later, Radio, Played recently and Up next. Radio always has
the built-in stations, so a fresh Couch opens on something playable. With
nothing playing or to continue, the first show on air leads its row. A row's
items keep the order they had when Home opened; a station that starts
playing is marked Playing where it is.

Settings → Home controls each device's row visibility and order. Saved
visibility always applies; Up next stays reachable from the now-playing bar and the player band.
Home ends with its content. Up next is off by default and, when enabled,
appears as one ruler split by each entry's length.

Rows are [`MediaRow`s](browse.md#mediarow--medialist); the Now row uses the
player's [transport](player.md#transport).

## Tiles on the TV

On the TV, Continue, Radio, For later
and Played recently are shelves of tiles. Each media item on Home has one primary `MediaTile` focus
stop, and OK does its main verb: Continue resumes, a station or channel
plays, everything else opens its page, which holds the other verbs. Continue
alone adds a sibling secondary Details button (at least 44px): Resume's
playback destination lacks its history actions. This extra focus stop opens
existing History Details without playing, even when Resume is unavailable.
Tiles with complete destinations keep one stop.

A tile is a [`MediaTile`](browse.md#mediatile); the Now row's remote keys are
in [TV](tv.md#the-tv-player-answers-a-remote).
