# Native Debian TV setup

**Settings → Updates** shows whether the automatic timer is active. A stopped
or masked timer appears as off; administrators can still use **Update and
restart** from their paired remote.

The Linux `.deb` includes optional TV setup (`/usr/sbin/couch-setup`, with the session files in `/usr/share/couch/tv`). Installing the package alone leaves
the current login, display manager and power policy unchanged.

## Use an existing desktop installation as a TV

On that computer, choose **This computer**, then open **Settings → TV** and
turn on **TV mode**; a paired admin can do the same from its own
device. Confirm **Restart Couch** to save the choice and open fullscreen.
Playback stops during the restart; the library and paired devices stay saved.
Turn on **Share on network** in **Settings → Devices & network** to let paired phones use
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

Before committing a machine, `sudo couch-setup --inspect` reports what `--tv`
would do there, with the same checks: the supported target, an earlier setup,
the `couch-tv` account, the data directory, the display manager and boot
target, missing packages, the files it would add or keep, the update timer and
any running session. It lists every refusal `--tv` would stop at (exit status 1),
including another installation or recovery holding setup's lock, which it finds
in the kernel's lock table rather than by taking the lock. It writes nothing: no
file, lock, account, package or service. Without `sudo` it marks what only root
can read as unavailable, as it does a lock it can't match to that table. It can't foresee APT or
service failures during setup.

Setup installs Debian's Xorg, Openbox, LightDM, PipeWire and Bluetooth support. It
creates the locked, unprivileged `couch-tv` account and enables its graphical
session. Couch runs from the root-owned `/usr/bin/couch` (`/opt/Couch/couch`) in TV presentation, fullscreen on the TV. The mouse pointer hides after a second without movement anywhere on the TV, outside Couch's window and over the recovery notice too, and returns when it moves. No source checkout or
manual verification utility is needed.

Setup also installs the GStreamer plugins and libplist that the optional
[AirPlay receiver](airplay.md) uses.

If cursor hiding stops, the session logs its exit status once and keeps Couch
and the recovery notice available. It does not restart the graphical session
during playback. Inspect `sudo couch-session logs`; restarting the graphical
session or rebooting retries cursor hiding.

Keep your administrator account, password and SSH access. Setup does not alter
them. From SSH or Ctrl+Alt+F3, use `sudo couch-session logs`, `status`, `restart` or
[`diagnose`](#diagnose-and-measure).
The initial session offers **This computer** or **Another Couch**. Setup checks
the running app with `check-health.js`, run by the app's own Node
(`ELECTRON_RUN_AS_NODE=1`): in This computer mode Core must be a child of the app
with the TV's database open and a healthy loopback listener; Another Couch runs
no Core. The check uses Core's open files and sockets rather than
`/proc/<pid>/environ`, which Electron can clear when setting process titles. Select this
computer for TV playback. To pair a phone, turn on **Share on network** in
**Settings → Devices & network** if the TV is still private, then choose **Pair a device** there
for the pairing QR and six-digit code. The first device you pair becomes the
admin. If no paired device is admin later,
Devices shows a one-use code under **Make a device the admin**; enter it in the
phone's **Settings → Devices & network** under **Admin code** and choose **Become admin**.
**Home** shows what plays now and what to continue, then what's on air, Live TV
and what you saved from each source, **Saved** holds For later, lists and
favorites, the header's search field searches every source, and **Settings**
the rest. TV **Settings → TV → Text size** offers Default,
Larger and Largest at 100%, 115% and 130%; confirm a trial size within 20
seconds or the TV returns to its saved size. Client size stays separate.

## TV navigation

Home presents one primary focus stop per media item: Continue resumes, a radio station
or channel plays, and a saved film or collection opens Details. Continue adds
one secondary Details stop for its existing History actions, including inspection
and removal when Resume is unavailable. Holding OK on a media item opens its menu of
other verbs; a short OK acts on release. The header keeps
Home, Saved and Settings between the TV's name and its search field
and clock, and stays at the top while the page scrolls; Up from a page's first
row returns to it. Settings OK moves
into the selected page's first enabled control. Back closes an overlay and
restores its opener; from Settings content it restores the visible rail entry
or narrow Settings page selector,
then returns Home. A source page first returns to Sources.

The TV player has the same controls as every screen, without the Back arrow
and fullscreen button a pointer and a window need. Details lives in Playback. A paused picture keeps
the controls up, its transport showing Play. Back hides the controls, then returns to the
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
provider's video opens `/collection`, and the Details check wants the Playback menu's `/item` link). Network
sharing must be enabled for the pairing-dialog check. Save two direct-media videos
with only titles (no metadata or known duration yet) as the first two items in For later
to exercise the Home tile and asynchronous Details check. Their compact controls
also catch Up wrongly choosing the Saved rail over the preceding video; taller
rows with metadata can hide that regression. Reload the renderer before
each run so the second Saved item’s Details query is cold; its check delays the
real For later response by 800 ms. Run with the tab visible
or a T3 recording active so animation frames run (a removal moves focus in one). Also save two radio
favorites, configure a local Live TV channel the second output can play (serve its
stream with CORS), and pair a second online shared output for the favorite ordering/Undo
and Live TV Queue/Play on checks. Queue skips a channel already anywhere in the queue,
and Play on leaves the TV controlling that output, so before another run remove the
channel from Up next's Played and bring the video back with Move here. Don't be sharing this device's screen or sound.
Build the browser checks, minified so the bundle fits one preview evaluation:

```sh
bun build tests/tv-navigation.browser.ts --target browser --format iife --minify --outfile build/tv-navigation.browser.js
```

Evaluate that bundle in the T3 preview, then evaluate
`await window.runTvNavigationRegression()`. The checks exercise real route,
focus and playback behavior: one Home station stop, a held OK opening a Home tile's menu (Back returns to the tile, a short OK acts on release, and the Remote's held OK does the same), Up and Down out of a shelf beside a tile with a longer or shorter caption, Home entry on the hero's
primary verb and Up from its last shelf through each shelf and the hero to the
current tab, Saved Details entry on Play and Right across its verbs, pairing overlay → content
→ rail → Home, hidden-HUD ten-second seek, queue and Details opener retention,
the sticky header, Up past a shelf's heading and Back, repeated Home Back, five-point OK-to-adjust Volume, Where it plays'
entry on its first device you can choose, Down to the next and Back to its button, Down from a check past
its Sync line (revealed by Sync… once the second output's sound joins) and from its fader onto it, Saved removal/Undo/order,
a remote's Undo by Up past the tabs (Back leaves it, OK undoes and returns focus to the tab),
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

For startup focus, build `tests/tv-playback-focus.browser.ts` in the same way.
Reload a paired, idle TV on Home without pointer or key input, then evaluate
`runTvPlaybackFocusRegression({ token, deviceId, targetDeviceId, source })`:
`token` and `deviceId` belong to a second paired controller, `targetDeviceId`
is the TV, and `source` is a 30–60 s finite direct video URL. Keep
credentials out of captured evidence. The check sends real WebSocket commands,
asserts playing video hides the bands without focusing Pause, then checks first
OK, deliberate focus, pause/resume, Back, timeline navigation, panel/menu restoration
and automatic queue advancement. Stop playback and reload Home before repeating
with `true` as the second argument to check OK before the first hide timeout.
Store the returned promise's result on `window` and read it separately if the
preview's evaluation timeout is shorter than the check. Use native preview key
input as well to verify local keyboard entry and the focus highlight.

Home's own TV navigation is part of `runTvNavigationRegression()`: its Home
entry check covers the hero, the board and the shelves, and its Live TV check
opens Live TV from Home's heading.

Toast lifecycle checks use the real Sonner instance from Vite. In a paired scratch
TV tab, evaluate `tests/playback-feedback.browser.js` to expose its SessionGate
reader, then import `/@fs/<checkout>/tests/toasts.browser.ts` and call
`runToastRegression(window.couchPlaybackReview.gate, mediaUrl)` with a finite
direct video URL. It checks expiry under a parked pointer, Queue → Play cleanup,
incoming playback retiring Undo, Queue during playback, and remote Up/Back/OK on
Stop's Undo. It changes the scratch queue.
Run `runIdleQueueRegression(gate, mediaUrl)` from an empty idle session to check
that the first Queue keeps its confirmation and Up next after a delayed snapshot.
Use a second paired controller to
verify that Play, Pause, Resume and Queue stay quiet on the TV, while ending a
shared source notifies its receivers once and keeps its publisher quiet. The same
module exports `runPlayingOnRegression(gate, mediaUrl, targetDeviceId, true)`
for a controller with a second online shared output: it delays real snapshots to
check that Playing on survives its own confirmation and then expires. Call it
without the last argument for normal delivery. `runTapToHearRecoveryRegression()`
exercises the real shell boundary's Try again flow while audio is blocked, then
activates the recovered Tap to hear action.

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

## Diagnose and measure

`sudo couch-session diagnose` prints a passive report to attach to a problem;
`--json` prints the same as a `couch-evidence/1` record. It reads, as `couch-tv`
and with no other environment: the installed package, the app's Electron and
Node, OS, kernel, CPU, memory and graphics devices, setup state, the service and
its restarts, the [health check](#dedicated-tv) setup and updates use, the
window's lifecycle, the mode, the helpers Core selected, display connectors and
the X screen's current mode, the sound server's sinks, the last update outcome,
the update timer, and from the log only the run header, the last delivery route,
player error hosts and Main's redacted errors, including those in `couch.log.1`
when that is the same run's rotated file. Each observation has its own time
limit and is reported unavailable or timed out on its own, and it reads at
most a bounded start (and, for the log, end) of each record. It never opens
`couch.sqlite`, runs or updates a helper, plays, captures or tests media, or
changes anything, and it leaves out keys, tokens, pairing, settings, the
environment, executable paths, device names and source URLs. What it quotes
from errors follows Main's own log redaction ([redact.js](../packaging/tv/redact.js)).

The window's lifecycle comes from Main's `<data>/renderer-status.json`, named by
the same run ID and process as the header of `couch.log`. It counts only when
the service's running process wrote it: the same PID, boot and kernel start
time, so a report an earlier process left behind never passes for a reused PID's:

- `page-loaded`: the page and its scripts loaded, but its app shell hasn't said
  it mounted. The app is still loading its mode, showed a startup error or failed
  to render, or another Couch's page predates the report.
- `ready`: a usable screen mounted, the mode chooser or the app shell once this
  computer's Core answered (not `Starting…` or `Couldn't start Couch`), and
  acknowledged it from the window's main frame, for the navigation now shown.
  Core's health and another Couch's reachability are reported apart.
- `failed`, with `page: remote` (summary `remote-failed`): another Couch that
  can't be reached. The local app is running; this is not a broken package.
- `stale`: written by an earlier or stopped process, even one whose PID the
  running app reuses, so it says nothing about the running app.
- `unknown`: no report, the service couldn't say which process runs, or the
  report or process lacks that identity (an older Couch), so a saved report
  can't be tied to the running app.

Core's health stays separate: it is the check setup and updates use, and
neither the window's state nor this report changes what rolls an update back.

### A repeatable hardware run

Compare hardware or builds with the same journey, recording each step's evidence
together. Run tests on an isolated Couch (its own `COUCH_DATA_DIR` and
`COUCH_PORT`, stopped by its PIDs), never the TV's installed data.

1. `sudo couch-session diagnose --json > diagnose.json` on the TV, before and
   after the change, for the installed package, runtime, helpers, display and
   sound route.
2. From a checkout on the same machine, with `COUCH_EVIDENCE=<directory>`, run
   the [HTTP latency](../tests/http-latency.integration.ts) and, with
   `COUCH_TEST_FFMPEG` set, the [live latency](../tests/live-latency.integration.ts)
   integrations as [Checks](ci.md) describes, using the installed app's Node to
   measure its runtime. Each writes a `couch-evidence/1` record with the
   revision, runtime, machine, input route, measurements and what it didn't test.
3. Run the [TV navigation regression](#browser-regression) and record its input
   route: DOM key events, T3 keyboard input or a physical remote.

Every record keeps measured and untested conditions apart. Loopback and
synthetic-input results don't measure the network between devices, browser
players, a physical remote, the decoded picture, audible output, HDMI hotplug,
standby resume or speaker and screen alignment; mark those untested unless that
run exercised them. Benchmarks published for Android TV builds are not Couch
results.
