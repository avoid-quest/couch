# Native Debian TV setup

**Settings > Updates** shows whether the automatic timer is active. A stopped
or masked timer appears as off; administrators can still use **Update and
restart** from their paired remote.

The Linux `.deb` includes optional TV setup (`/usr/sbin/couch-setup`, with the session files in `/usr/share/couch/tv`). Installing the package alone leaves
the current login, display manager and power policy unchanged.

## Use an existing desktop installation as a TV

On that computer, choose **This computer**, then open the Couch's **General**
in Settings and turn on **TV mode**; a paired admin can do the same from its own
device. Confirm **Restart Couch** to save the choice and open fullscreen.
Playback stops during the restart; the library and paired devices stay saved.
Turn on **Share on network** in **Settings > Network** to let paired phones use
**Remote**. Turn TV mode off in the same place to return to the desktop window.
A TV launcher's TV mode stays on and shows as set by the launcher.

This choice keeps the desktop's normal login and update mechanism. **Start on
boot** and the overnight update service belong to the dedicated TV setup below.
`COUCH_TV_PRESENTATION=1` still forces TV mode for that launcher and locks the
setting; remove that launch override to use the saved desktop choice.

## Dedicated TV

On minimal Debian 13 amd64, install the package and explicitly enable TV
setup from the ordinary administrator account:

```sh
sudo apt install ./couch_<V>_amd64.deb
sudo couch-setup --tv
sudo reboot
```

Setup installs Debian's Xorg, Openbox, LightDM, PipeWire and Bluetooth support. It
creates the locked, unprivileged `couch-tv` account and enables its graphical
session. Couch runs from the root-owned `/usr/bin/couch` (`/opt/Couch/couch`) in TV presentation, fullscreen on the TV. The mouse pointer hides after a second without movement anywhere on the TV, outside Couch's window and over the recovery notice too, and returns when it moves. No source checkout or
manual verification utility is needed.

If cursor hiding stops, the session logs its exit status once and keeps Couch
and the recovery notice available. It does not restart the graphical session
during playback. Inspect `sudo couch-session logs`; restarting the graphical
session or rebooting retries cursor hiding.

Keep your administrator account, password and SSH access. Setup does not alter
them. From SSH or Ctrl+Alt+F3, use `sudo couch-session logs`, `status` or `restart`.
The initial session offers **This computer** or **Another Couch**. Setup checks
the running app with `check-health.js`, run by the app's own Node
(`ELECTRON_RUN_AS_NODE=1`): in This computer mode Core must be a child of the app
with the TV's database open and a healthy loopback listener; Another Couch runs
no Core. The check uses Core's open files and sockets rather than
`/proc/<pid>/environ`, which Electron can clear when setting process titles. Select this
computer for TV playback. To pair a phone, turn on **Share on network** in
**Settings > Network** if the TV is still private, then open **Settings > Devices** and choose **Pair a device**
for the pairing QR and six-digit code. The first device you pair becomes the
admin. If no paired device is admin later,
Devices shows a one-use code under **Make a device the admin**; enter it in the
phone's **Settings > Devices** under **Admin code** and choose **Become admin**.
**Home** shows what plays now and Up next, **Live** holds radio and Live TV,
**Search** holds search and sources, **Library** holds lists and favorites, and
**Settings** the rest. TV **Settings > Display > Text size** offers Default,
Larger and Largest at 100%, 115% and 130%; confirm a trial size within 20
seconds or the TV returns to its saved size. Client size stays separate.

## TV navigation

Home presents one primary focus stop per media item: Continue resumes, a radio station
or channel plays, and a saved film or collection opens Details. Continue adds
one secondary Details stop for its existing History actions, including inspection
and removal when Resume is unavailable. The tab bar keeps
Home, Live, Search, Library and Settings between the TV's name and the clock,
and scrolls away with the page; Up from a page's first row returns to it. Settings OK moves
into the selected page's first enabled control. Back closes an overlay and
restores its opener; from Settings content it restores the visible rail entry
or narrow Settings page selector,
then returns Home. A source page first returns to Sources.

The TV player has its own controls without the desktop breadcrumb, Couch
switch or fullscreen button. Details lives in Playback. A paused picture shows
a large Pause glyph and “Paused”. Back hides the controls, then returns to the
page that opened the player; Back on Home does nothing. Up next and Details
preserve this route even after the queue changes the player URL. Playback
continues when browsing.

With controls hidden, OK focuses the first enabled transport slot, which is
Stop for nonpausable radio. Up/Down reveals the timeline when available;
Left/Right also seeks ten seconds when supported. Without a seekable timeline,
arrows reveal the transport. Volume moves five points per press after OK enters
adjustment; OK or Back ends adjustment before navigation resumes. The fixed
Play/Pause, Stop, Next slots are shared with Home's hero; radio Stop is
OK, OK and pausable Stop is OK, Right, OK.

### Browser regression

Use an isolated Core and data directory, a paired TV renderer (the TV app's
window, or a browser tab using the [TV override](design/tv.md#see-the-tv-in-a-browser)), a 1920×1080
viewport and a paused finite direct-media video that supports byte-range seeking (a
provider's video opens `/collection`, and the Details check wants the Playback sheet's `/item` link). Network
sharing must be enabled for the pairing-dialog check. Save two videos for later
to exercise the Home tile and asynchronous Details check. Reload the renderer before
each run so the second Saved item’s Details query is cold; its check delays the
real For later response by 800 ms. Run with the tab visible
or a T3 recording active so Radix exit animations finish. Also save two radio
favorites, configure a local Live TV channel the second output can play (serve its
stream with CORS), and pair a second online shared output for the favorite ordering/Undo
and Live TV Queue/Play on checks. Queue skips a channel already anywhere in the queue,
and Play on leaves the TV controlling that output, so before another run remove the
channel from Up next's Played and bring the video back with Only here. Don't be sharing this device's screen or sound.
Build the browser checks, minified so the bundle fits one preview evaluation:

```sh
bun build tests/tv-navigation.browser.ts --target browser --format iife --minify --outfile build/tv-navigation.browser.js
```

Evaluate that bundle in the T3 preview, then evaluate
`await window.runTvNavigationRegression()`. The checks exercise real route,
focus and playback behavior: one Home station stop, Up and Down out of a shelf beside a tile with a longer or shorter caption, Home entry on the hero's
primary verb and Up from its last shelf through each shelf and the hero to the
current tab, Saved Details entry on Play and Right across its verbs, pairing overlay → content
→ rail → Home, hidden-HUD ten-second seek, queue and Details opener retention,
the tab bar's scroll, Up and Back, repeated Home Back, five-point OK-to-adjust Volume, Where it plays' Every device
entry on the overview's first device and Back to the picker's button, Saved removal/Undo/order,
retained favorite and Live TV actions, and a Remote that can't choose or open this device's
capture on Sharing while its own pointer and keys still can (it drives the bundle's copy of
`applyTvNavigation`, the path Remote keys take; `runSharingLocalOnlyRegression()` runs it alone). Cold and warm Saved Back retain the
item opener after settling and continue arrow navigation from it. Live TV checks
the labeled Play on device group, a successful Queue request and recipient selection.
Details Back asserts Playback focus,
the same entry and paused state, then immediate OK reopens the Sheet. They use DOM activation
and bubbling key events; also use T3 keyboard input to check actual D-pad
navigation and capture screenshots. This browser evidence does not qualify
native Main, Linux packaging or a physical TV remote.

For Continue, stop two decoded finite videos before completion on every output
(the first leads Home as its hero, the second sits in Continue's shelf) and keep
the second shared output online. Build `tests/tv-continue.browser.ts` with the same browser
command and run `await runContinueDetailsRegression()`. It requires the hero's
Resume, From start and Details, the shelf's sibling Resume/Details controls, a 44px Details target, inspection without playback,
the exact History item, Back to the usable Details opener, successful Queue,
Remove/Undo, and usable focus after the removed opener disappears. Also verify
primary Resume, From start and actual Play on selection with trusted TV keys;
repeat inspection/removal with an unavailable history source.
Use `runContinueDetailsRegression(true)` for that unavailable fixture; it
requires disabled playback and enabled Details/removal and skips successful Queue.
The same bundle exports `runNarrowSettingsRegression()` (use a sub-md TV
viewport, at Default and confirmed Largest) and `runBusyLiveHitRegression()`
(first built-in Radio station unsaved). The latter holds only a successful
real Save response, requires the original enabled Open destination and usable
browse focus on Back, then releases the response and restores the fixture favorite.

## TV maintenance

A paired administrator's **Settings > Updates** updates this TV remotely with
**Update and restart**. A TV in **Another Couch** mode appears by its paired
Device name in that Couch's Updates page; the request travels over its existing
connection to the TV app. The TV keeps its saved mode, channel and pairing after
restarting. It must be online to receive the request.

Setup refuses an unrelated existing display manager or Couch service override.
Repeated setup preserves administrator configuration, data-directory overrides,
disabled autologin and logind masks. It does not restart LightDM or logind. Reboot
when convenient to apply first-time session and power configuration.

The retired 0.1.0 AppImage installation is not migrated. Fresh installations use
the package above; an old AppImage installation stays as it is and its session is
not switched.

The TV checks for updates like the desktop app and shows them in **Settings >
Updates**, but root installs them. `couch-update.timer` runs
`couch-update.service` roughly 15–75 minutes after boot and daily between 04:00 and 05:00.
Enabling the timer more than 15 minutes into an existing boot can run it
immediately; a missed overnight check can also run earlier after boot. These are
systemd's [`OnBootSec` and `Persistent` rules](https://github.com/systemd/systemd/blob/v257/man/systemd.timer.xml).
The updater installs the newest release on the TV's channel (the one picked in Settings;
by default Preview on a preview build, else Stable) unless something plays. It
never goes back to an older version, except from a preview to Stable. **Restart
to update** installs a release sooner: the `couch-tv` account may only start
`couch-update@<version>.service`. Both run a root script that downloads the
release's `.deb` from avoid-quest/couch, checks its sha512 against the
release's update file, installs it and restarts the TV app. The timer checks
both Core and the TV window's fresh playback report, including Client-mode
video and synced audio, and checks again after refreshing package lists. A
missing Core without a fresh report waits for the next run. Manual updates
from the administrator's button restart immediately, even during playback. The app must then
pass the check setup uses within a minute, or the script reinstalls the previous
version, kept as `/var/lib/couch-update/installed.deb` (or first downloaded from
its own release), and unattended updates skip the failed release until a newer
one appears.

From SSH, `sudo systemctl start couch-update@<version>.service` installs a release
by hand, `systemctl list-timers couch-update.timer` shows the next run,
`/var/lib/couch-update/status` holds the last run's outcome and
`journalctl -u couch-update.service -u 'couch-update@*'` shows how updates went,
with `stage=… elapsed_ms=…` lines for download, installation, setup refresh,
restart and health checking.
The outcome is `installed`, `installed-unverified` when no TV session runs to
check, `rolled-back` with the `failed` release and its error, `skipped` for that
release, `up-to-date`, `waiting` while something plays, or `failed` with its
error; `rollback=unavailable` means no previous package was at hand.
**Settings > Updates** shows the last automatic outcome under **Automatic
updates**, including waiting while media plays, the known failed version it
skipped, and an up-to-date check. A failed **Restart to update** shows its error
instead of installing forever.
After each install, including a rollback, the script runs the installed
package's `couch-setup --refresh`, so the one `sudo couch-setup --tv` is enough:
on a completed setup it installs TV packages and links TV files a later release
adds, with the same preservation as setup, and enables `couch-update.timer`
unless masked. It leaves accounts, sign-in and power policy and the running
session alone, so session changes, such as the hidden pointer, apply at the
next sign-in; `setup=failed` in the status means it failed and the update went
ahead.
`sudo systemctl disable --now couch-update.timer` and then `sudo systemctl mask
couch-update.timer` turn unattended updates off for good.
TVs set up before this rerun `sudo couch-setup --tv` once to get the units; until
then **Automatic updates** says so.
