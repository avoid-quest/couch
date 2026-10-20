# Settings

## Two owners

Settings has two owners, each titled with its real name. **This device** (its name) holds what changes only on the device in hand and what it consents to: General, Couch connection, Viewing, Home, Sharing and, in an app connected to another Couch, Updates. **The Couch** (its name, "Shared") holds what changes it for everyone: General, Access (Devices, Network), Watching (Playback for the active watching profile, Sources), the Couch's hardware (Sound, Bluetooth, Display, where it has them) and Updates when available. Each page's eyebrow repeats its owner; shared pages say "· This device" on the host, except hardware pages, which say "· Shared hardware".

Settings opens on This device → General; within a page, frequent settings come first and rare or destructive ones (admin handover, Forget) last. On the TV, entering Devices focuses Pair a device when it is available.

This device → Home lists Home's shelves, Continue, For later, Radio, Played recently and Up next, each with a Switch and Move up and down: [Home](home.md#shelves).

Settings is the last tab in the TV and wide desktop header, and in the bottom bar on phones and narrow desktop windows; every page renders inside the shell on all three. On phones, choose Sharing or Network from the Settings page menu. The player's gear opens Playback, a separate surface for the current media.

The Couch's Sources page lists its source pages, then **AirPlay**: an admin's **Receive AirPlay** switch, its **Code** with **New code** while it is on, and one status line. New code confirms in an AlertDialog, since it restarts AirPlay and every device must enter the new code. Others see the row with "Only an admin can change this." It uses the page's existing rows, Switch, Button, Alert and AlertDialog; nothing custom.

Not yet: restructuring Settings beyond fitting the shell. #761 settled its two owners and their pages.

## Admin-only rows

Every paired device opens every shared page: rows that need an admin say so ("Only an admin can change this.") instead of disappearing, and the server enforces it. A device's own consent, its capture, Quit Couch and the first-admin code on the host stay local. On the hosting app, Sharing explains that its speakers and screen are shared while Share on network is on; paired devices have their own Speakers and Screen switches.

After Stop sharing releases capture, keep the source's name and disabled
Stopping… button until Couch acknowledges the stop. Then return to capture
setup, retaining any error. A pending stop never shows Starting… or Cancel.

## Section nav

Saved and Settings share one section nav: a rail with a check on wide screens and a Select on phones. In Settings' rail each owner heads its pages, with its device name or role beneath, wrapping where the rail is too narrow. On the TV, Settings starts on the rail's current entry, as Saved does, and OK on a rail entry opens its page and moves focus to the page's first control.

On the TV, Settings OK enters
the selected page's first enabled control; Back from its content restores the
visible rail entry or narrow Settings page selector, then Home (a source's
own Back first returns to Sources).

## Names, pairings and roles

General owns this device's
name, which is also the name of the server it hosts. An administrator
connected to another host can rename that host in Devices. The Devices list
manages pairings and roles; New device heads its rows, since a separate untitled section would leave a gap that reads as an empty row. First run and the pairing dialog: [Shell](shell.md#first-run-names-the-computer).

## Shared source prompts

The Couch’s **General** page owns **Ask every device where a shared source
plays**, off by default and saved by Core across restarts. It changes how the
Couch asks everyone to choose receivers, so it belongs to the Couch rather than
This device → Sharing or a watching profile’s Playback preferences. Only admins
change it; everyone sees the row. Its description is “When someone plays a
shared source that nothing is playing yet, every device viewing it shows Where
it plays. Off: only the device that pressed Play.”

It uses the existing divided SettingsRow with its linked Label and shadcn
Switch, as Autoplay does. One tree serves TV, desktop and phone; the label gets
the existing touch target treatment. No custom component is needed.
