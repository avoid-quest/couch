# Mac and Windows controller qualification

Issue [171](https://github.com/avoid-quest/couch/issues/171), 2026-09-08. The
[owner's selected increment](https://github.com/avoid-quest/couch/issues/171#issuecomment-5581948822)
is a controller for the existing Ubuntu TV on each platform. This record does
not close the issue.

## Implementation and tested build

The existing browser remote supplies pairing, browsing, playback commands and
persisted controller identity. No application code or platform wrapper was
needed for desktop access. The new [controller guide](../desktop-controllers.md)
covers LAN addresses and the operating systems' website-app shortcuts. The
earlier platform research now records the accepted scope.

On this Apple Silicon Mac, `bun run build` produced a compiled coordinator from
`d77af244cf6d1f6aab872e2fee0a11897284815f`. Its build identity is version `0.1.0`,
target `aarch64-apple-darwin`, Bun `1.4.2`, data format `1`, `packaged: false` and
`dirty: true`. The worktree changes were documentation and a dependency symlink;
application source matched that commit. Binary SHA-256:
`323cc5d710f1577419fee03c785133e79610886bb52a4213676e666448a8b357`.

The initial dependency link to the original checkout lacked `@gplane/cue`,
`fast-xml-parser` and `image-dimensions`, so that build failed. Using the existing
complete dependencies at `/tmp/couch-origin-20260908/node_modules` resolved the
build. No shared dependency tree was modified or package installed.

The coordinator listened only on `127.0.0.1:4381` with its own database under
`/tmp/couch-desktop-controllers-20260908/.artifacts/desktop-controllers-171/data`.
It had no native player. No shared preview, T480 data, media or queue was changed.

## Actual Mac GUI checks

Native Safari `26.6.2` on macOS `26.6.2`, build `25G83`, was operated through
the macOS accessibility UI. This was an actual desktop browser, not a changed
user agent or a Linux browser container.

- Safari loaded the pairing form and paired through the visible name/code
  fields. The first pairing used the retained earlier `d6eb731` dirty Mac
  coordinator, then the coordinator was replaced with the current `d77af24`
  compiled build above using the same disposable data. Reload retained that
  browser's pairing and showed the current controller interface.
- Safari's **File > Add to Dock** created **Couch controller acceptance** for
  the loopback test address. Opening the installed app showed a fresh pairing
  form, confirming its separate website storage. It paired through the form
  as **Mac Dock controller acceptance** against the `d77af24` build.
- The app displayed Playback controls, TV remote and the media-source tabs.
  Library opened with **Search library** and the correct empty-catalog state.
  There was no local video player. No populated search-result journey was
  tested in this empty fixture.
- After issuing Quit and reopening through the application API, the website
  app retained pairing and returned to the queue. No code entry was needed.
  The API relaunches the app transparently; process exit was not independently
  captured, and this check did not use a Dock-icon click.
- Stopping the disposable coordinator produced **Server unavailable** and
  disabled TV controls. Restarting the same binary/database reconnected the
  open app. **Settings > Connection** showed **Server: Connected**, **Player:
  Unavailable**, and **Mac Dock controller acceptance Controller**.
- General settings said an administrator can change the TV name. The ordinary
  controller remained separate from administrator claim. The app correctly
  reported **The desktop player is not connected** and disabled playback.

The GUI observations remain in the tool conversation; no separate screenshot
or GUI receipt was saved. The browser and installed app are retained. The test app's
URL is loopback and is not a shortcut to the user's Ubuntu TV. Runtime logs,
the database and compiled binary remain in the worktree's ignored artifact and
binary directories. This report contains no pairing credential.

## Remaining product acceptance

The Mac check proves real browser access, website-app installation, pairing,
controller role, empty-library browsing and restart recovery. It does not prove
commands reaching the installed Ubuntu TV, LAN hostname/certificate enrollment,
populated library/Search behavior in the accepted UI, or actual TV playback
from the Mac controller. Qualification must repeat those journeys on the final
delivered app against the target Ubuntu TV.

No real Windows environment was identified. The inspected Mac has no
`prlctl`, `VBoxManage` or `virsh` command and no explicitly named Windows host
in its SSH configuration. CrossOver is installed, but was not used as Windows
acceptance. The browser inventory offered only the Codex in-app browser;
native Safari was available through the application API.

The owner or coordinator must provide a real Windows machine or VM with Edge
and access to the intended Ubuntu TV. Verify the documented app install/pin
steps, named pairing, ordinary controller authority, library/Search and queue
use, TV play/pause/seek, and reconnect after app and TV restarts. Record Windows
and Edge versions and the final TV build. Until that evidence and the target
Mac-to-TV journey exist, issue 171 remains open.
