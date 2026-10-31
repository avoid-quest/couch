# Remote

What the TV does with each press: [TV](tv.md).

## The Remote section

**Remote** (`/remote`) appears on devices that aren't TVs while the Couch has
a TV. One column, phone first: the TV (a Select when there are several;
TVs that are off or private can't be controlled), the pad, Back, Home and Info,
what plays with the shared transport, timeline, Volume and Up next, then Type
on TV. It controls a TV without joining or moving its outputs. The
now-playing bar hides here. For Live audio, programme transport and Up next are
absent. Remote's explicit volume still addresses the selected TV under its output
consent; ordinary player volume and Join/Leave address the listener's own device.

The pad is a ring of four arrows around a round OK, each target at least 64px;
the catalog has no direction pad, so it is clipped `Button`s. Each press sends
one key. OK sends on release; held for 500 ms it sends a held OK (`menu`),
which opens the focused item's menu on the TV ([Menus](../design.md#menus)).
Arrow keys work while the pad has focus. Info opens the TV's player with its
Info shown; on the player it shows or hides Info ([Player](player.md#calm-and-info)).

Remote picks the TV this device controls, else one that's on, else the one
seen last. If the selected TV is forgotten, Remote picks from the remaining
TVs by the same rule. A TV that's off says so ("Living room TV is off."); "No TV
connected" with Open Devices is only for a Couch without a TV. Core keeps
whether each device last connected as a TV with its record, so a TV stays one
while it's off and across restarts.

Commands reject a disconnected, revoked or reassigned target rather than act
on a different TV. Up next can play that TV's Autoplay suggestions directly;
ordering and removal still apply only to entries already in its queue.
Core rechecks the selected TV, its connection, consent and original Playback
after a catalogue list finishes preparing. A delayed command cannot follow a
queue that moved to another TV. Explicit **Play on** still addresses the chosen
destination.

## Type on TV

An `InputGroup` for the TV's focused search field or its own device name. Send
replaces the TV's draft; Clear sends an empty one; Enter on TV submits.
Nothing is sent while typing or reconnecting, and no field is chosen
automatically. Pairing codes, source URLs and admin fields are not offered.
The TV itself has no Remote section or on-screen keyboard.
