# Live TV

Status: preview · Scenes: home

The house has a Live TV playlist. Anyone picks a channel on the TV and sees
what's on now and next.

## Journey

1. An admin: **Settings → Sources → Live TV → Add source**: **Name**, **M3U
   URL**, and an **XMLTV URL** for the guide.
2. Anyone: Home → **Live TV**, **Group** or **Filter channels**.
3. **Play** or **Play on** a channel; each shows what's on now and next.

## Done when

- A playlist's channels appear grouped, with now and next from the guide.
- Channels play on the TV and other devices that support their codecs.
- Channels only the Couch computer can decode play there, through mpv.

## Demo

Needs: the TV (or the HDMI display). Content: an M3U playlist with an XMLTV
guide.

## Known issues

- No full guide grid, catch-up or recording.
- mpv channels play only on the Couch computer, never on phones or in groups.
