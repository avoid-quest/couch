# Delivered Couch and remaining acceptance, 14 September 2026

This record supports [documentation issue #251](https://github.com/avoid-quest/couch/issues/251).
It describes the checked baseline, not concurrent branches or a new release.
The README and usage guide describe its installed behavior. Parent issues
[#1](https://github.com/avoid-quest/couch/issues/1) and
[#25](https://github.com/avoid-quest/couch/issues/25) were not edited.

## Source and installed identity

Checks on 14 September 2026 at 11:23 to 11:31 Europe/Rome used fetched remote main,
an existing administrator browser and read-only SSH. No install, restart,
playback, queue, source, pairing or power change was performed.

| Evidence | Verified result | Boundary |
| --- | --- | --- |
| Remote default branch | `main`, `f60f3daea2dd9e11c2ed483ce094866ec8d0ce8c` | `git fetch origin`, remote HEAD and `git rev-parse origin/main`; implementation branch starts here |
| Running coordinator and native host | Both `0.1.0+build.34172088349.1`, `aa8bb761d2381c41dcade83ed3c9aad014cb2244` | Settings > Advanced, collected 11:24:21, identifies both builds and reports both Ready |
| Source comparison | Installed source to remote main differs only in `tests/package/installed.ts` | `git diff aa8bb761d2381c41dcade83ed3c9aad014cb2244 origin/main --stat`; production source matches, package bytes were not freshly hashed |
| Ubuntu companion | `0.1.0+build.34172088347.1`, `6df685632f1cf899ed607dd601ea64a1cb2b38f7` | SSH `dpkg-query -W couch-appliance` and `/usr/share/doc/couch-appliance/build-info.json` agree |
| Readiness and display | `/api/health` returns `ok: true`, `player: idle`; Connections shows Server Connected and Player Available; Advanced shows fullscreen `eDP-1`, 1920×1080 | Readbacks do not establish physical HDMI picture, audibility, decode performance or subtitle geometry |
| Build service | GitHub Actions API reports `enabled: false` | No workflow dispatched; temporary builds belong in Ubuntu Docker on the Mac, never on the T480 |

Pinned source evidence includes the [navigation](https://github.com/avoid-quest/couch/blob/f60f3daea2dd9e11c2ed483ce094866ec8d0ce8c/src/client/App.tsx),
[search](https://github.com/avoid-quest/couch/blob/f60f3daea2dd9e11c2ed483ce094866ec8d0ce8c/src/client/SearchPanel.tsx),
[Settings labels](https://github.com/avoid-quest/couch/blob/f60f3daea2dd9e11c2ed483ce094866ec8d0ce8c/src/shared/settings-pages.ts),
[phone folders](https://github.com/avoid-quest/couch/blob/f60f3daea2dd9e11c2ed483ce094866ec8d0ce8c/src/client/FolderSettings.tsx),
[phone Jellyfin setup](https://github.com/avoid-quest/couch/blob/f60f3daea2dd9e11c2ed483ce094866ec8d0ce8c/src/client/JellyfinSettings.tsx),
and [pairing QR](https://github.com/avoid-quest/couch/blob/f60f3daea2dd9e11c2ed483ce094866ec8d0ce8c/src/client/SetupQr.tsx).
The QR in Connections contains the controller code in a URL fragment. Earlier
address-only descriptions do not describe this baseline. It never carries the
separate administrator code.

## Browser journey

These observations follow [the basic journey](../usage.md#connect-a-phone-and-find-media)
through the installed app's visible browser interface. They use the Mac in-app
browser with its existing administrator pairing, not a new physical phone.

| Step and visible route | Result |
| --- | --- |
| Open the advertised named origin | `http://couch.avoid.local` opened Connected without code entry, reusing the existing pairing. Home showed the idle prompt and 18 waiting entries. |
| Open Search from navigation | `/search` showed Search your sources and All, YouTube, RaiPlay, Radio, TV folders, Jellyfin, Twitch and Bandcamp filters. |
| Select YouTube, enter `jazz`, submit Search | `/search?q=jazz&source=YouTube` returned six visible results and Show more YouTube. The first was `1940's Jazz Classics [Jazz, Jazz Classics, Smooth Jazz, Vintage Jazz]`. Each had distinct Play and Add to Up next controls. Neither was activated. |
| Settings > Playback | Showed Video quality set to `1080p (recommended)` and Default music ReplayGain set to Off. No setting changed. |
| Settings > Connections | Displayed the named origin, Server Connected, Player Available, the existing administrator role, pairing QR, Reconnect and Pair again. No reconnect or new pairing was attempted. |
| Settings > Sources > TV folders | Showed Add TV folder and the explanation that folders live on the TV, including already-mounted shares. No folder was added. |
| Library | Opened YouTube with Twitch, RaiPlay and Bandcamp tabs and Radio, Live TV, Jellyfin and TV folders buttons. |
| Library > TV folders | Showed All media, Movies, Shows, Artists, Albums and Collections; zero items; directed an administrator to Settings > Sources. |
| Finish | Returned to idle Home with 18 waiting entries and closed the task-created tab. |

Pending human steps for #251: on a real phone joined to the TV's network, open
the advertised address, name and pair the browser using the TV code or scan the
Connections QR on this configured TV. A fresh TV instead shows the QR on
Claim and name. Then follow Search to a chosen result. During the coordinated
appliance window, choose Play, confirm picture and sound, distinguish adding
next from playing now, pause and recover from an unavailable source. Record the
phone/browser, installed build, date and each result. Do not mark the phone
journey criterion complete from the Mac browser check. The newcomer trial and
pairing-dialog QR additionally belong to #248 and #249 below.

## Delivered software and evidence limits

| Capability | Existing implementation or qualification record | Limit |
| --- | --- | --- |
| Install, signed staging, manual/idle updates and recovery | [Installer](../install-couch.md), [AppImage updates](../appimage-updates.md), [idle-failure acceptance](https://github.com/avoid-quest/couch/issues/9#issuecomment-5592123546) | Use the enrolled key and signed feed; old updater receipts are historical, not the current running identity |
| Music, CUE and ReplayGain | [Continuity](audio-continuity.md), [CUE #30](https://github.com/avoid-quest/couch/issues/30), [ReplayGain #31](https://github.com/avoid-quest/couch/issues/31) | Measured lossless 44.1 kHz FLAC continuity covers local, mounted-folder and Jellyfin software captures; not every format, slow open or physical speaker |
| Video metadata, corrections and collections | [Library](media-library-27.md), [metadata](../metadata.md), [current collection UI](https://github.com/avoid-quest/couch/blob/f60f3daea2dd9e11c2ed483ce094866ec8d0ce8c/src/client/CollectionsPanel.tsx) | Local NFO/artwork/correction/export work exists; live TMDB matching still needs authorized API access |
| Guide scheduling and completed recordings | [Recording evidence](../recordings.md), [closed #66](https://github.com/avoid-quest/couch/issues/66) | Historical generated-media/backend tests qualify their named paths; no Tvheadend is deployed on the audited TV and no physical tuner reception is claimed |
| Desktop controllers | [Mac/browser qualification](desktop-controllers-171.md), [selected #171 scope](https://github.com/avoid-quest/couch/issues/171) | Safari/website-app loopback checks completed; Mac-to-installed-TV LAN/Search/commands/playback acceptance remains pending; Windows/Edge verification deferred; native Mac/Windows playback not delivered |

These existing documents retain their original source identities, failed attempts
and acceptance boundaries. Old references to temporary artifact directories are
historical receipts, not promises of files in a fresh checkout. No historical
qualification record was deleted or converted into a current hardware pass.

## Remaining acceptance and open implementation

| Owner | Exact remaining action |
| --- | --- |
| [#150, rendering](https://github.com/avoid-quest/couch/issues/150) | Continue matched measurements from build 49. Hidden and visible-controls targets still fail; retain the existing UI, recovery and measurement limits. |
| [#13, display](https://github.com/avoid-quest/couch/issues/13) | Physically start the session without HDMI, reconnect it, verify enabled outputs and saved display choice. Companion 47 includes the hotplug fix. |
| [#14, sound](https://github.com/avoid-quest/couch/issues/14) | Confirm HDMI/internal selection and audibility, hardware keys, output loss/reconnect, retained route and sound after resume. Earlier C39S evidence remains historical acceptance. |
| [#12, sizing](https://github.com/avoid-quest/couch/issues/12) | With captioned media, verify pointer alignment and unchanged video/subtitle geometry at the selected TV interface sizes. |
| [#17, folders](https://github.com/avoid-quest/couch/issues/17) | From an administrator phone add one real accessible local or already-mounted folder, scan, confirm picture/sound, and test unavailable-folder recovery. The readback still has zero items. |
| [#23, first run](https://github.com/avoid-quest/couch/issues/23) | Complete real media/display/audio acceptance using retained setup state. Do not reset the configured TV merely to repeat software setup tests. |
| [#246, AC lid](https://github.com/avoid-quest/couch/issues/246) | Implement and install the AC policy correction, then qualify reachability with HDMI absent/TV off and lid closed, reopen and explicitly test playback. Installed companion 47 still suspends on undocked AC lid closure. |
| [#247, local tests](https://github.com/avoid-quest/couch/issues/247) | Review/merge [PR #253](https://github.com/avoid-quest/couch/pull/253). Its branch reports clean focused, full and typecheck exits; the checked main baseline still fails. No appliance action is needed. |
| [#248, guest discovery](https://github.com/avoid-quest/couch/issues/248) | Deliver the small Home/discovery change and run the uncoached guest find/play/pause/recovery trial. |
| [#249, pairing dialog](https://github.com/avoid-quest/couch/issues/249) | Add the existing pairing QR to Pair a remote, then qualify a real phone scan and physical TV focus/directional behavior. |
| [#250, diagnostics](https://github.com/avoid-quest/couch/issues/250) | Review open [PR #254](https://github.com/avoid-quest/couch/pull/254) and follow its restart/retention acceptance. Baseline Advanced still labels errors as session-only. |

The five sibling implementation issues #246 through #250 were open with no PRs listed
at the initial 11:23 read. The AC lid task subsequently opened
[PR #252](https://github.com/avoid-quest/couch/pull/252), with local installer checks
passing and all live installation/physical acceptance pending. PRs #253 and #254
were also open at the final GitHub read; remote main still resolved to `f60f3da`.
Follow each linked issue for later PRs and qualification.
Their branches are not included in the main/build-49 claims here. The power task
owns `docs/appliance-session.md`; the installed policy is also pinned in
[main's logind configuration](https://github.com/avoid-quest/couch/blob/f60f3daea2dd9e11c2ed483ce094866ec8d0ce8c/packaging/appliance/root/usr/lib/systemd/logind.conf.d/50-couch.conf).
Coordinate one shared-TV window before installing, restarting, changing pairings,
playing media or testing power. Privileged installation needs an administrator's
sudo access; noninteractive sudo was unavailable in the earlier audit.

Growing timeshift [#67](https://github.com/avoid-quest/couch/issues/67) is deferred;
no permanent Ant role was accepted. [CEC #38](https://github.com/avoid-quest/couch/issues/38)
was closed as not planned. [Full Rust port #175](https://github.com/avoid-quest/couch/issues/175)
was an investigation. Account-login/DRM video, protected RaiPlay, Jellyfin
transcoding, crossfade, multiroom and broader Streaming Community catalog/search
are outside delivered scope. HDR/refresh switching has no completed hardware
qualification. These are not hidden finishing criteria.

## Historical build-49 receipts

The 14 September audit was supplied from the owner's original checkout. Its
local evidence links were resolved there before this change. Two small receipts
are now preserved byte-for-byte in this repository:

- [Build-49 comparison](evidence/status-2026-09-14/historical-build49-comparison.json), SHA-256 `3c097486e46ebbb57bc9ca96009fd44f13b49d5c57f32442b662de10c56873d6`.
- [Build-49 feed readback](evidence/status-2026-09-14/historical-build49-feed.json), SHA-256 `a1a94279b99368f3d15ac4ca7ed8f47e07f1ad93643741dd2b25cdb219d1755a`.

These are 8 September delivery evidence, not new playback or integrity checks.
The feed receipt identifies the 268,106,232-byte AppImage with SHA-256
`228e05bcc76cdefba6d81c337b34780a441aa102005e679882b810f9308fd13c`.
Protected AppImage and database bytes were not freshly read without sudo.

| Selected 1080p60 VP9 interval | Build 46 callbacks/s; drops | Build 49 callbacks/s; drops |
| --- | --- | --- |
| Hidden controls | 49.99; 16.72% | 55.35; 7.74% |
| Held controls | 43.96; 26.74% | 49.33; 17.75% |

[PR #244](https://github.com/avoid-quest/couch/pull/244) and
[PR #245](https://github.com/avoid-quest/couch/pull/245) are included in build 49.
Both conditions still exceed 1% drops and miss 58.8 callbacks/s. Selected windows
exceed 40 seconds, with VP9/vaapi-copy and no cache stalls. These are one trial
per candidate without matched thermal records. Callbacks do not count distinct
frames physically displayed. The complete hidden receipt includes an earlier
seek outside the selected window; only the selected interval passes continuity.
The owner reported the TV off. Screenshots and counters add no physical sound,
subtitle, pointer, audio-sync or continuous TV presentation acceptance.

The comparison's `raw` and `observer` filenames refer to the owner's private
retained `couch-remaining-20260908` evidence, not downloadable repository files.
Request that archive from the repository owner for independent recomputation.
The reviewed source report `matched52-review.md` has SHA-256
`b3ea873b8d8d3155468247d6ad1daed0a0bd7a1089b2455b0d1e388de46628dd`;
`readiness49.json` has SHA-256
`24eadd4cdcf1f0554c7e52f717412c2e9388dd340d062e1d09ecabb669f75a49`.
The originals remain in the owner's checkout, including sensitive operational
readbacks; they are not republished here. Repository links require access to
`avoid-quest/couch` when private. Reproducing live readbacks additionally requires
LAN/SSH access and a paired administrator browser. No pairing code, token,
private key or raw diagnostics export is part of this record.

## Local validation

The supplied 14 September audit ran clean main `f60f3da` with pinned Bun 1.4.2.
Typecheck passed. The isolated clock test passed once with two opt-in skips.
The remaining suite had 1,054 passes, seven skips, zero assertion failures,
two unhandled errors and exit 1. The focused SoundSettings/MetadataEditor run
had nine passes, one unhandled error and exit 1. These are historical baseline
results, not checks rerun for this documentation-only change. #247 owns the
Happy DOM/Radix event teardown correction; opt-in skips are not live-provider
passes. The separate [PR #253 evidence](https://github.com/avoid-quest/couch/blob/dec79dba01e629aa04453cd9e7efbfd2801674fa/docs/research/ui-test-lifecycle-2026-09-14.md)
reports 1,063 full-suite passes, seven skips and zero errors, plus isolated clock,
focused UI and typecheck passes on that unmerged branch. Original logs remain in the owner's private `status-audit-2026-09-14`
archive and require owner access.

This change passed checks of 62 local Markdown file/fragment targets, both copied
receipt SHA-256 hashes and JSON parsing, and `git diff --check`. Current labels
were checked against source and the installed browser journey above. No product code changed, so native, build and full UI suites were
not rerun. GitHub Actions remains paused.

## Issue #251 acceptance

- [x] Dated remote-main, running-build and installed-companion cross-check, with physical evidence kept separate.
- [ ] Installation/controller/navigation/search instructions corrected; existing-browser connection and find-media path verified. Fresh physical phone connection/QR and picture/sound journey remain pending as listed above.
- [x] Implemented capabilities, remaining hardware acceptance and deferred/excluded scope separated.
- [x] Performance, hardware and folder owners linked; historical qualification records retained as historical.
- [x] New evidence and source links live in the repository or pinned GitHub records; private raw-evidence access requirements recorded.
