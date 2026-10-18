# Shell

## Header and section nav

The phone and desktop header holds the section nav, including Remote,
and the Couch switch. Wide screens also show the clock and, outside Remote,
Keyboard shortcuts; the player's header carries the switch too.
The TV uses its local name instead of the
switch and omits Remote and Keyboard shortcuts.

## Couch switch

The Popover reuses Settings → Couch connection's
choice: saved servers, the app's This computer option, and another address.
On the host with sharing on, it ends with Pair a device. It scrolls within
the available space and keeps the same flat, divided settings rows.

Where it plays after a switch: [Where it plays](where-it-plays.md#switching-servers).

## Mini player

Its control order and transport are the player band's: [Player](player.md#the-player-is-one-tap-away).

## Browsing stays grounded

The sticky header and scroll edges share the
solid black page background on desktop and web. Native video alone clears
its full-screen ancestors so the picture can show through.

## A picture you start opens the player

When Play, Resume or Play on, from
any Device, starts an item with a picture on this Device, this Device opens
its player from whatever page it shows, so video never plays unseen. Up next
moving on, by itself or with Next, keeps the page, and so does audio-only
media (radio, music), which Home's Now row and the mini player carry. The
first sync after a reload keeps the requested page. Back on Home does
nothing; it never reopens the player.

## Keyboard control stays inside Couch

TanStack Hotkeys shares shortcuts
between the browser and desktop window; Electron global shortcuts would also
claim keys outside the app. The header's Keyboard shortcuts dialog is the
user-facing reference. Keep transport shortcuts aligned with visible control
capabilities, preserve Find's type-to-search, and let open panels, text entry,
focused controls and TV navigation own their keys.

## First run names the computer

The app asks "Where is your Couch?" (This
computer hosts it; Another Couch joins one, and this computer still plays),
then asks for its name once, with the random default shown, and whether to
share it on the network; Back returns to the choice. Pairing and later
servers reuse that name, in browsers too; a browser that switches to a new
Couch finds it filled in on the pairing form. Renaming and pairings later:
[Settings](settings.md#names-pairings-and-roles).

Unpaired browsers see only the pairing page: no sections
that would lead back to it. The pairing dialog warns that browsers flag
Couch's own certificate once, and closes itself when a device pairs, with a
toast that names it ("Phone paired · admin").
