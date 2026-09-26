# Clock consistency pass

Checked 26 September 2026, based on #595 (`64f2b882`). The pass applies Clock's documented patterns and existing shared components. No requested judgement call was implemented.

## Verification

- `bun run typecheck` passed.
- `bun run test:core`: 1,495 passed, 10 skipped, zero failed. Copy assertions and Bluetooth fixtures follow the changed native strings. An earlier run had two media-helper timeouts while native compilation was running; the complete rerun passed.
- `cargo check` passed on Apple Silicon with two existing unused-code warnings. The initial checkout lacked the compiled sidecar; the standard desktop build generated it, after which the unmodified cargo command passed.
- Built this branch with `bun scripts/desktop.ts build --debug --bundles app`. The resulting `src-tauri/target/debug/bundle/macos/Couch.app` contains the compiled frontend, Rust app and coordinator. It uses this Mac's installed media helpers; this is a local UI validation build, not a release-package qualification.
- Native app ran with `COUCH_PORT=4178 COUCH_DATA_DIR=/tmp/couch-polish-native COUCH_LAN_INTERFACE=en0`. Completed This computer setup, enabled remotes, played NTS Radio, searched live sources, and opened a generated local H.264 fixture through the native file picker. Checked playback, pause, replay, Finished, mini player, Playback Sheet and keyboard focus. Diagnostics reported mpv 0.41.0, CoreAudio for radio, and VideoToolbox/libmpv for video; yt-dlp, Deno and ffprobe were ready. The video has no audio track. No Bluetooth device, external library, OS update or installer was exercised.
- Browser ran the requested server on 4177 with `/tmp/couch-polish-data`, and Vite on 1437. Paired through the printed code. Browser-only captures correctly show that this separate coordinator has no native player.
- No `verify`, Docker, `act` or e2e suite ran. No workflow or packaging source changed.

## Measurements

All rail pages start their content at **x=288** in the 1280px viewport and **x=432** in the 1920px viewport: gutter + 12rem rail + 3rem gap. Each page retains its breakpoint. Saved's `Channels & stations 0` fits: scroll width equals client width (190px desktop, 286px TV). No captured page has horizontal overflow.

At 1920px, the root is 24px and Autoplay's Switch track is **42×24px**, enclosing its **21×21px** thumb. Its existing label resolves to **Autoplay**. Saved's title-to-empty gap is 24px at desktop and 36px at TV, the same `mb-6` used by Settings. The native player screenshot shows the slider's white focus outline. Raw browser measurements are in [measurements.json](measurements.json).

Viewport names describe CSS pixels. T3 captures may scale the raster; native screenshots include the macOS title bar and Retina pixels. Captures are unedited; the website's development toolbar was removed from the preview DOM only.

## Screenshots

| Screen | 390×844 | 1280×800 | 1920×1080 | macOS app |
| --- | --- | --- | --- | --- |
| Home | [Phone](home-390x844.png) | [Desktop](home-1280x800.png) | [TV](home-1920x1080.png) | [Native](macos-home.png) |
| Find | [Phone](find-390x844.png) | [Desktop](find-1280x800.png) | [TV](find-1920x1080.png) | [Native](macos-find.png) |
| Saved | [Phone](saved-390x844.png) | [Desktop](saved-1280x800.png) | [TV](saved-1920x1080.png) | [Native](macos-saved.png) |
| Playback | [Phone](playback-390x844.png) | [Desktop](playback-1280x800.png) | [TV](playback-1920x1080.png) | [Native](macos-playback.png) |
| Advanced | [Phone](advanced-390x844.png) | [Desktop](advanced-1280x800.png) | [TV](advanced-1920x1080.png) | [Native](macos-advanced.png) |

Native player: [radio](macos-player-radio.png), [video](macos-player-video.png), [Playback Sheet](macos-player-playback.png), [Finished](macos-player-finished.png), [slider focus](macos-player-focus.png).

Website: [phone](web-download-390x844.png), [desktop](web-download-1280x800.png).

## Additional audit findings

Every non-test file in the requested Find, Saved, non-settings routes and Settings areas was read, including the eight named shared/shell components. The complete 75-file inventory follows. Files without findings reuse shared patterns, define route wiring, or have no visual UI. These findings extend the original known-drift list.

- **fix — section type.** `SettingsRow.tsx`: `FieldLegend`'s variant overrode `text-base`; make the section-title override use the same specificity. `ui/empty.tsx` titles also use `text-base font-medium`.
- **fix — source settings structure.** `SettingsSources.tsx`: replace custom source links with `SettingsSection`/`SettingsRow` and the existing ghost Open action; show initial Spinner and read failures in an Alert with Try again.
- **fix — browsing states.** `BrowseMusic.tsx`, `BrowseRadio.tsx`: replace bare loading/empty text with Spinner status lines and Empty; reuse `offline(name)`; link Add folder to the actual Folders settings page.
- **fix — settings empty states.** `BluetoothSettings.tsx`, `ConnectionsSettings.tsx`, `SoundSettings.tsx`, `FolderSettings.tsx`, `FolderBrowser.tsx`, `GuideSources.tsx`, `MetadataEditor.tsx`, `AdvancedSettings.tsx`: reuse Empty for empty device, remote, output, folder, guide, match and diagnostic lists, with an appropriate next step where available.
- **fix — loading states.** `DisplaySettings.tsx`, `IptvSettings.tsx`, `StreamingCommunitySettings.tsx`, `MetadataSettings.tsx`, `MetadataEditor.tsx`: add the shared Spinner status line; avoid showing an empty Live TV list before the first response.
- **fix — safe read retries.** Folder browser; Folders, Jellyfin, Radio playlists, Movie & show info and StreamingCommunity settings; Display, Bluetooth, Remotes' code/address reads, Advanced and Tools: place Try again in AlertAction for failed reads. Preserve mutation errors and existing confirmations. `routes/__root.tsx` now puts error-boundary reset in AlertAction.
- **fix — onboarding and pairing roles.** `Onboarding.tsx` uses PageHeader and body-scale description; `PairForm.tsx` code slots use `h-8 text-sm touch:h-11`; `PairingDialog.tsx` subsection headings use section-title weight.
- **fix — editor controls/type.** `MetadataEditor.tsx` section headings use section-title classes; result rows and `FolderBrowser.tsx` entries retain wrapping while enforcing 32px/44px minimum targets.
- **fix — copy and real paths.** `SearchSource.tsx`: Settings → Sources → Folders. `MetadataEditor.tsx`: Video details and Settings → Sources → Movie & show info. `GuideSources.tsx`: Live TV sources and Try again.
- **verified, no change — pairing instructions.** SettingsNav labels the page Remotes and ConnectionsSettings provides Pair a remote, so Settings → Remotes → Pair a remote is already accurate. `#playback-autoplay` already has the correct SettingsRow label association.
- **ask — retrying mutations.** Settings writes, Saved writes, GuideSources, PairForm and MetadataEditor often have no AlertAction. Recommend deciding which operations can safely replay; retain existing input/confirmation flows for destructive writes.
- **ask — embedded errors.** Folder/Radio/GuideSources source descriptions and FolderBrowser location errors use muted text; SearchSource uses unavailable text. Recommend destructive Alert for actionable failures, keeping the row association. Sound routing support messages need a distinction between failure and unavailable capability.
- **ask — pending captions.** Folder scan/status descriptions, update transactions, Startup's initial status and pending button captions are not uniformly Spinner status lines. Recommend a shared status line for actual work while retaining concise button labels.
- **ask — pairing-code type role.** SetupQr and the Remotes admin code use display-sized monospace digits with wide tracking. Recommend documenting one explicit code role rather than shrinking codes to body text.
- **ask — form and facts structure.** MetadataEditor's focused form and DiagnosticFacts' semantic definition lists differ from SettingsRow. Recommend retaining these task/data structures; Settings pages themselves now use the shared rows.
- **ask — local album context.** BrowseMusic's track view has less collection artwork/context than opened online collections. Recommend reusing CollectionHeader once the available album metadata is agreed, without adding lookups in this pass.

The PR's **Needs your call** section includes these judgement calls and every original ask item. The requested verified fixes are applied; none are skipped.

## Files read

See [audit-files.txt](audit-files.txt). The inventory excludes tests and nested settings route wrappers, includes the root Settings route shell, and includes all explicitly named shared components.
