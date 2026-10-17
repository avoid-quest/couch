# Remote

What the TV does with each press: [TV](tv.md).

## The Remote section

**Remote** is a section on Devices that aren't TVs, laid out like the remote
it stands in for, phone first, in one column, its name left to the current tab
as Home's and Discover's are: the TV and its status, the pad,
Back, Home and Info, what plays, then Type on TV. It selects a TV to control
without joining or moving its outputs. With two or more TVs, a Select picks
one; offline or private TVs cannot be controlled.

The pad is a ring of four arrows around a round OK, and each press sends one
key. Each arrow is a quarter of the ring, so a press anywhere on it counts, and
every target is at least 64px at the base scale. The catalog has no direction
pad, so it is `Button`s, each in its half of the ring so that its centre is
its own (taps by assistive tools land there), clipped to its quarter; a mask
keeps a gap around OK, so a focused quarter stays apart from it. OK sends on
release; held for 500 ms it sends a held OK (`menu`), which opens the menu of
the item focused on the TV, as a remote's held OK does
([Menus](../design.md#menus)), and is OK elsewhere. Arrow keys and Home work
while the pad has focus, and a hint line says so outside `touch:`. Back, Home
and Info follow in a row of hairline pills; Info opens the TV's player.

The shared transport, the timeline or "Live", and Volume act on that TV; Up
next retains the same target for queue actions, shortcuts and Undo. Commands
reject a disconnected, revoked or reassigned target rather than act on a
different TV. The now-playing bar hides on Remote.

## Type on TV

Type on TV is an `InputGroup` for the TV's focused search field (the header's,
on every page) or its own Device name. Send replaces the draft; Clear sends an empty draft. Only
Enter on TV submits the existing search or name form. Typing and reconnecting
do not send an unsaved draft, and no field is chosen automatically. Pairing
codes, source URLs and administrative fields are unavailable. Status and
disabled controls explain unavailable targets and fields. The TV itself
has no Remote section or on-screen keyboard.
