# Guest discovery from Home, 14 September 2026

Issue [#248](https://github.com/avoid-quest/couch/issues/248) covers an already-paired guest. This change starts from remote default branch `main` at `f60f3daea2dd9e11c2ed483ce094866ec8d0ce8c`. It does not complete the physical TV or unfamiliar-guest acceptance gates.

## Implemented journey

Idle phone Home now puts **Find something to play** beside Browse library and Remote, before the queue and history. TV Home has the same primary search action ahead of its source shortcuts, even with no history or local media.

Search uses the existing provider, radio, folder and Jellyfin operations. Play now starts the selected item on the shared TV. Add next appends to the end of Up next without starting or interrupting playback. The distinction appears above results and in the action confirmations. Accessible button names include the same visible action labels. Folder result rows retain their Add next text on narrow phones. Existing playlist and album actions retain their explicit collection labels.

Submitting a search moves focus from the text field to the selected source button so direction keys can leave text editing. Recovering from an unavailable folder or disconnected Jellyfin connection offers Search YouTube, preserves the query, and focuses the YouTube source button. Administrators and the native host also receive Manage sources, using the existing Settings request. Ordinary controllers do not receive that action. Retry remains available for failed searches.

Queue ownership, device-local routes and search state, current playback broadcasts, provider resolution and permission enforcement are unchanged. The existing current-playback bar lets a controller pause while browsing.

## Local verification

Bun `1.4.2`, installed with the frozen lockfile, was used on the Mac. GitHub Actions remains paused. No tests or build tools were installed on the appliance.

- TypeScript passed.
- Frontend and Bun sidecar build passed for `aarch64-apple-darwin`. This is not a Linux installation artifact.
- The five focused files passed 67 tests and 986 assertions, with zero failures or unhandled errors.
- The isolated IPTV clock check passed one test with two existing opt-in skips.
- The full-suite check uses the two test-lifecycle repairs from [PR #253](https://github.com/avoid-quest/couch/pull/253), issue #247, temporarily applied. The known unmodified-main teardown failure is separate from this UI change. Both files are restored before commit; this PR does not include that repair.
- Final combined full suite passed 1,070 tests with seven existing opt-in skips, 8,468 assertions, zero failures and no unhandled errors in 82.76 seconds. The two #247 test files were then restored.

```sh
bun run typecheck
bun run build
bun test ./src/client/SessionHome.test.tsx ./src/client/BrowseHome.test.tsx ./src/client/SearchPanel.test.tsx ./src/client/SessionBar.test.tsx ./src/client/routes.test.tsx
# Apply #253 before the combined full-suite check.
bun test ./tests/linux/iptv-clock.test.ts
bun test --path-ignore-patterns 'tests/linux/iptv-clock.test.ts'
```

The focused checks cover empty and populated idle Home, no playback from browsing or details, play versus append commands, guest versus administrator recovery, input/source focus, independent retries, links, queue controls, pause/resume, and search query, scroll and detail-focus retention. Existing route tests cover browser Back/Forward and native hash routes without remounting the session.

### Browser observations

The browser used the actual App and coordinator with a fresh configured database on loopback port 4319. A disposable fixture replaced YouTube lookup with two named results and web-media resolution with a placeholder URL. It simulated player observations in response to the real coordinator commands. Native mode used the official Tauri IPC/window mocks. The fixture's pairings and queue were disposable. These checks prove UI and shared coordinator behavior, not external provider playback, picture, sound or physical remote behavior.

| Check | Observed result |
| --- | --- |
| Phone at 320 × 740 | Idle Home exposed discovery with no queue/history. Search result controls remained 44 pixels high. Document width and scroll width were both 320 pixels. |
| Find/play/add/pause | Searching `jazz`, playing Evening jazz, and adding Morning piano left Evening jazz current and Morning piano in Up next. Pause changed the playback bar to Paused. |
| Return to browsing | Opening Up next and returning to Search retained `jazz`, the YouTube filter and both results. Playback remained paused. |
| Guest recovery | Disconnected Jellyfin explained its state, offered Search YouTube, and omitted Manage sources. Recovery retained the query. |
| Second controller | Another controller saw the same paused item and queue while its own Search started empty. Its later `piano` query did not replace the first controller's search. |
| Desktop at 1440 × 900 | Search, source selection and the paused current-playback bar were usable. Document and scroll widths were both 1440 pixels. |
| Simulated TV at 1920 × 1080 | Idle Home discovery, text entry, source selection and selecting a result worked with arrows/Enter without Tab. Play switched to the TV playback presentation. Pause and Show TV home restored the search query and filter. Document and scroll widths were both 1920 pixels. |

The simulated TV's spatial navigation sometimes moved from the source row into the sidebar before reaching result actions. This is a specific point to watch during the guest trial. The playback overlay also auto-hides; the fixture pause/return check used its visible controls. Do not count these observations as a physical directional-navigation pass.

The dated audit in the original checkout reported real YouTube results, no local items and disconnected Jellyfin. Those are baseline observations from that audit, not fresh availability claims for this implementation. No live appliance access, deployment, restart, pairing change, queue change or playback occurred in this task.

## Acceptance status

| Issue criterion | Result and remaining action |
| --- | --- |
| Clear idle Home action, including empty history/queue | Implemented and passed focused checks and browser inspection. Confirm the delivered screen during the physical session. |
| Supported source finds a title/link and starts on the actual TV; paired controllers show current playback | Title/link commands and shared playback display pass software checks. Pending deployment and a real supported-source item with picture/sound on the TV and state visible on two paired controllers. |
| Play now versus Add next; pause and return without losing context or unintended playback | Passed local command, browser and retained-context checks. Repeat the sequence on the installed TV. |
| Unconfigured/unavailable sources explain state with permission-appropriate recovery | Passed guest/administrator tests and guest browser observation. Verify the actual source state after deployment. |
| One unfamiliar guest completes find, play, add-next and pause without procedural coaching | **Pending. No unfamiliar person has run the journey.** Record the trial below. Automated checks do not satisfy it. |
| Narrow phone, desktop and TV directional navigation; shared queue and local browsing preserved | Narrow phone, desktop and simulated TV checked locally. Real phone/TV directional navigation remains pending. Shared coordinator and independent browsing were observed with two fixture controllers. |

## Remaining human and hardware session

Coordinate one appliance window with the sibling tasks before deployment, restart or playback. Build on the Mac through the existing delivery path; the T480 only installs and runs Couch. Record the delivered source revision, build identity, date, source availability, phone dimensions and TV input device. Reuse the existing configured installation and pairings.

Start with an already-paired guest on idle Home. Ask only for the outcome: "Find something you want to watch, play it on the TV, add another item for later in this session, then pause and return to browsing." Do not tell the guest which page or button to use. Observe where they hesitate, what they expect Play now and Add next to do, and whether they can recover from an unavailable source using the interface. If procedural help becomes necessary, record it and leave the criterion pending.

During that window, confirm actual picture and sound, current playback on two paired controllers, no interruption after Add next, pause, retained search after returning from the queue or player, narrow-phone usability and physical directional navigation. Record any sidebar detour or difficulty finding the auto-hidden playback controls. Keep issue #248 open until its real-world criteria pass. Parent issues #1 and #25 remain unchanged.

| Trial record | Value |
| --- | --- |
| Date, build and source revision | Pending |
| Unfamiliar guest and controller/input used | Pending |
| Selected source and title/link | Pending |
| Find, play, Add next, pause and return outcomes | Pending |
| Hesitations, wrong turns and any coaching | Pending |
| Picture/sound and second-controller observation | Pending |
| Unavailable-source recovery and physical directional navigation | Pending |
| Final outcome and follow-up changes | Pending |
