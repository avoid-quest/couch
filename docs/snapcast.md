# Snapcast audio output

Couch can send one household session to a Snapcast group while Snapcast keeps its
speakers synchronized. Browser and native playback do not require Snapcast or FFmpeg.
Use **Playback output** to select the group, or **Manage [group name]** to join/remove
speakers and change their individual volume or mute. Joining shares the group's
timeline; selecting another output moves the whole session.

This first adapter supports a controlled Snapcast **0.35.0** server on Core's own
machine, with loopback control/PCM ingestion and network-connected Snapcast clients.
Install FFmpeg on Core's PATH. It decodes the selected HTTP(S) audio once per group;
Couch paces stereo PCM into Snapcast without capturing the desktop's sound.

Configure Snapserver with a 500ms buffer and two dedicated streams:

```ini
[stream]
buffer = 500
source = tcp://127.0.0.1:4953?name=couch&sampleformat=48000:16:2&codec=pcm&chunk_ms=20
source = tcp://127.0.0.1:4954?name=couch-idle&sampleformat=48000:16:2&codec=pcm&chunk_ms=20

[http]
enabled = true
bind_to_address = 127.0.0.1
port = 1780
```

Keep `couch-idle` unused: removed speakers are moved to that silent stream. Merely
removing a Snapcast group member leaves it in another group playing the same stream.
Use zero client latency offsets and keep other producers/controllers away from these
two streams. Couch checks the observed version, PCM format, topology and latency;
Snapcast's control API does not report its configured buffer, so that setting is
an operator responsibility. The input port in Couch's configuration must match the
port in the observed stream URI, including when using containers.

Find the desired existing group's ID through Snapcast's `Server.GetStatus` RPC.
Save a private JSON file, for example `/etc/couch/snapcast.json`:

```json
{
  "controlUrl": "ws://127.0.0.1:1780/jsonrpc",
  "streamId": "couch",
  "idleStreamId": "couch-idle",
  "groupId": "YOUR_EXISTING_GROUP_ID",
  "name": "Home speakers",
  "pcmHost": "127.0.0.1",
  "pcmPort": 4953,
  "bufferMs": 500,
  "drainMs": 750
}
```

Start Core with `COUCH_SNAPCAST_CONFIG=/etc/couch/snapcast.json`. An optional `ffmpeg`
property selects an executable path. Configuration and provider headers stay on
Core; controllers receive only the group and eligible speaker names/settings.
Members already playing another stream are not eligible for a join.

Group position is estimated from paced PCM submitted to the backend, accounting for
the configured buffer. Pause, seek and Stop discard pending audio and wait 750ms for
the qualified buffer to drain. This is an explicit buffering policy, not a physical
speaker acknowledgement. Control/ingestion failure makes the output unavailable and
blocks transfer until reconnection establishes a fresh silent backend. **Reconnect
group** resets the stream, validates the backend and leaves playback stopped; choose
the output again to resume paused. Core restart also requires explicit assignment.
Core retains a marker after group use and waits 750ms before any new assignment on
restart, including when Snapcast configuration has subsequently been removed.

Seeking requires known finite duration; live radio does not gain a synthetic DVR
window. Speed uses FFmpeg's audio tempo filter. The first audio track is used;
alternate tracks, subtitles, clip segments, replay gain and video output are not
supported by this adapter. Sources needing those features fail explicitly.

The backend API and configuration references are the versioned
[Snapcast control API](https://github.com/snapcast/snapcast/blob/v0.35.0/doc/json_rpc_api/control.md)
and [configuration guide](https://github.com/snapcast/snapcast/blob/v0.35.0/doc/configuration.md).
Qualification results and hardware limits are recorded in the
[playback validation log](../.scratch/device-independent-playback/validation.md).
