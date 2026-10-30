# What Couch can say

The evidence behind Couch's public copy. Before a sentence about a capability
goes on the website, in the README or in a release note, find its row here; if
it isn't here, verify it and add it. The original capability inventory was
checked on 2026-10-23 against `3e603a5`. The 2026-10-29
[release audit](../release-audit-2026-10-29.md) checks main `8beabc5`, including
the differences between published builds and newly merged work. It excludes
qualification of Live audio mode.

**Release state, checked 2026-10-29.** The latest published build is
[`v0.4.0-preview.5`](https://github.com/avoid-quest/couch/releases/tag/v0.4.0-preview.5),
from `73668e3`. Main `8beabc5` includes later work that is not in that build.
No published stable release was found. Recheck releases before changing public
copy; do not equate "on main" with "in the latest preview".

## In the latest preview

| Claim | Evidence | Public wording limits |
| --- | --- | --- |
| Packages desktop apps for macOS 14+ (Apple Silicon), macOS 13+ (Intel), Windows 11 (x64) and Linux (x64 AppImage, Debian 13 `.deb`) | `apps/web/src/pages/download.astro`, Package workflow, release assets | Name the platforms; not "every computer". Intel 13–14 needs a compatible local mpv for some TV codecs; automatic Intel mpv needs 15+. Intel downloads appear after publication; Ventura runtime/install/update validation remains required ([audit](../intel-macos-research.md)) |
| Can be set up as a dedicated Debian TV | `couch-setup --tv`, [native-tv](../native-tv.md) | Renderer fixtures exercise the TV layout; physical Debian TV installation remains unverified ([audit](../release-audit-2026-10-29.md)). Say "set up", not "tested on TVs" |
| Phones and laptops join through a browser by scanning a QR code or typing a six-digit code; no app install | [usage](../usage.md#connect-a-phone) | The first visit shows a certificate warning; mention it in how-to copy |
| No accounts; it runs on your own network | Pairing is per Couch, on the LAN ([architecture](../architecture.md)) | Online sources still need the internet |
| Everyone paired can search, play, queue and control; admins manage the Couch | [usage](../usage.md#administrator-access), `src/server/devices.ts` | The first device is admin and admins can make others admin. A playback that plays only on devices keeping their outputs private can't be joined or controlled by others ([architecture](../architecture.md)) |
| Saved lists and items; resume where you left off | [browse](../design/browse.md), [live-inputs](../live-inputs.md) (Save as list) | — |
| Several independent playbacks at once, each with its own Up next and devices | [architecture](../architecture.md), [where-it-plays](../design/where-it-plays.md) | — |
| Sources: YouTube, Twitch, RaiPlay, Bandcamp, SoundCloud search, other yt-dlp links, avoid radio, radio playlists and Radio Browser, M3U Live TV with XMLTV guide | [usage](../usage.md#sources) | Per-source/device support varies: link the table |
| Film, series and anime catalogues (StreamingCommunity, 123MoviesFree, AnimeSaturn, AnimeUnity) | [usage](../usage.md#sources) | Public copy names them by category only; their names stay in the docs. 123MoviesFree is experimental. Individual Linux/Windows playback smokes passed for these providers ([audit](../release-audit-2026-10-29.md)); broader catalogue and device coverage remains unqualified |
| Choose each device's picture and sound in **Where it plays**; move playback with **Move here** | [where-it-plays](../design/where-it-plays.md) | Move here is unavailable while another device's private output plays |
| Ordinary media plays with its sound in sync on several devices | Sendspin grouping; [usage table](../usage.md#what-plays-where), "Synced sound" column | YouTube, Twitch, RaiPlay, radio, other yt-dlp sites and H.264 Live TV only. Say "in sync", never "perfect sync" |
| A phone or laptop can be a speaker or screen for the Couch, once it allows it | [live-inputs](../live-inputs.md), "Let other devices use" | The device must allow it itself |
| Synced sound keeps playing with the screen locked | #841; owner tested Chrome on iPad and Android phones | Only for those tested setups |
| Share a screen, window, this computer's sound, or a microphone/audio input to other devices | #749, #877, [live-inputs](../live-inputs.md) | System audio needs macOS 14.2+ or Windows; no Linux system audio; sharing a window's sound sends the whole computer's mix; browsers without screen capture offer audio inputs only. The historical speaker-only join defect on `c344034` is not reproduced on current main: `live-outputs.integration.ts` drives the production mixer through Core and verifies a new sound-only receiver without borrowing its private screen. Physical/browser microphone capture remains unqualified; do not say "everyone's phones" |
| Shared screens and sound arrive fast; each device plays as soon as it receives them | [ADR 0001](../adr/0001-live-inputs-play-over-webrtc-unless-in-sync.md) | Only when the direct connection succeeds: a device that can't connect falls back to a few seconds behind (**Behind**) until sharing restarts ([live-inputs](../live-inputs.md)); the built-in relay helps where the browser reaches it. Devices aren't aligned with each other; upload grows per receiver. The sharer never plays its own share. No latency number |
| **In sync** makes a shared source play together on several devices, a few seconds behind | ADR 0001 | Must say "a few seconds behind". Not low-latency |
| Receive AirPlay sound | [airplay](../airplay.md) | Linux hosts only, admin turns it on; one sender at a time, sound only, no AirPlay 2 multiroom; not yet verified with a real Apple device. Don't feature publicly |
| Pair Bluetooth speakers and choose the TV's sound output | [bluetooth](../bluetooth.md), [sound](../sound.md) | Linux only; no PIN/passkey devices; physical outputs, audibility and reconnection still need checking on target hardware |
| Free and open source (MIT); forks and contributions welcome | `LICENSE`, `package.json` `license` | The UxPlay patch is GPL-3.0-or-later; dependencies keep their own licences |
| Updates itself; admins update connected Couch apps from a phone | #878, [usage](../usage.md#run-from-source) | — |

## On main after preview.5

| Claim | Evidence | Public wording limits |
| --- | --- | --- |
| Screen/window sharing offers independent resolution and 30/60/120 FPS targets, default 60 | #941, #940; [video measurements](../video-performance.md) | Targets, not achieved frame rates. Recorded WSL software, native Windows and native Mac default sharing miss the sustained 60 FPS gate ([audit](../release-audit-2026-10-29.md), [Mac follow-up](../release-audit-2026-10-29.md#native-macos-follow-up)). Native Linux GPU sharing, multiple physical receivers and 120 Hz chains remain unqualified |
| External media avoids discarded preparation requests; YouTube can use the existing Node runtime | #944; [startup measurements](../media-startup-performance.md) | The controlled delay experiment and individual provider samples do not guarantee internet startup times or improvements for every source |
| Playback delivery and controls are decided by Core | #918, #919; [delivery ADR](../adr/0002-playback-delivery-and-authority.md) | A private playback does not give every paired device transport control. Live audio mode is excluded from this audit; its existence on main is not venue or latency qualification |

## Historical live-audio experiments

The following predates the Live audio work merged after preview.5. It remains
historical evidence, not a description of current main or a release guarantee.

| Claim | Evidence | Status |
| --- | --- | --- |
| A sound card's stereo input delivered directly to scheduled receivers, without the buffered path | Lab experiment `ccac10b` (lab notes, not in this repo): UMC404HD, one MacBook Air receiver over Ethernet | Short wired captures only. The sender imposed a 350 ms lead; the measured electrical output delay was about 0.35–0.37 s, against about 3.1 s for the buffered comparator (which excluded the browser's recording stage, so it's no whole-run comparison). Diagnostic observations, not a product number or target. Not qualified for fidelity, continuity, Wi-Fi, two receivers or recovery |
| Source-clock stability for long live input | Active milestone (lab notes) | Projected lead loss over minutes; unresolved |

Never publish the lab's numbers as targets or results.

## Intended direction

- Live sound: a stereo input on the Couch computer heard through attendees'
  phones, laptops, headphones and speakers, close to live and in step. See
  [live sound](specs/live-sound.md).
- Several sound cards or input pairs, more than two channels, and routing
  them (choosing one audio input already exists).
- Expert audio settings (buffers, lead, output compensation) with sensible
  defaults, after measurement shows which controls matter.
- Low-delay synchronized screens, not only sound.

## Not claimed, and why

| Phrase | Why not |
| --- | --- |
| "Works on any device / everywhere" | Safari, Firefox, iPhone and physical Linux TV installation are unverified ([usage](../usage.md#what-plays-where)) |
| "Zero latency", "real-time", any ms figure | Unmeasured for products; lab figures are test settings |
| "Perfect sync", "sample-accurate" | Synchronization is software-clocked; physical skew isn't measured across devices |
| "Concert-ready", "for venues", attendee counts | No Wi-Fi, scale or multi-receiver measurement |
| "Stage monitoring", speaker arrays | Out of scope (see [live sound](specs/live-sound.md#scope)) |
| "Local files", "your library", Jellyfin | Removed ([usage](../usage.md#sources)) |
| "Stable", "1.0" | No stable release exists; say "in preview" |

## Unknown or needing a decision

- Which browsers and phones to verify before naming them publicly.
