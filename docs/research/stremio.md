# Stremio ecosystem and lessons for Couch

Research for [Research how Stremio works](https://github.com/avoid-quest/couch/issues/169), checked 2026-09-08. This report proposes directions for discussion; it does not approve a redesign or addon integration.

Stremio's strongest transferable idea is to let people choose what to watch before asking where it comes from. A title has metadata and episodes; several sources can offer streams for it; watching state survives the individual stream choice. Couch already has metadata, movie/show browsing, resume, profiles and saved provider items. The useful next experiment is to make these easier to reach, then test whether combining discovery across sources helps. Replacing Couch's player or building a marketplace would be a much larger step with no demonstrated UX benefit yet.

## Evidence and scope

I inspected official documentation, current release announcements and first-party source. Source findings use immutable snapshots of [Stremio Web](https://github.com/Stremio/stremio-web/tree/07553095e1c2f46f677e4ad341faa1dcb90fa760), [Stremio Core](https://github.com/Stremio/stremio-core/tree/ab28e8423689ef8cca166cc097b8d6c2bc89f3df), and [Couch](https://github.com/avoid-quest/couch/tree/351eb9ee52f9fea2b91c4db92fff9d042a1c95eb). The Stremio snapshots are development branches, not proof that every client ships those exact bytes. The Web package reports `5.0.0-beta.39` in [its package manifest](https://github.com/Stremio/stremio-web/blob/07553095e1c2f46f677e4ad341faa1dcb90fa760/package.json).

This was a documentation and source investigation. I did not install Stremio, authenticate an account, install community addons, measure interaction times, or qualify any behavior on Couch's TV. Usability benefits below are hypotheses. Source inspection establishes implemented behavior, not how comfortable it feels with a remote.

Version matters. Stremio announced v5 in Linux's stable Flatpak channel on June 26, 2026. Its July 27 Web/v5 update changed episode clicks to open the episode, with a separate play button, and fixed card navigation and repeated actions. Older screenshots and onboarding articles can describe materially different behavior. [Linux release](https://blog.stremio.com/stremio-tech-update-81-stremio-v5-released-for-linux/), [July update](https://blog.stremio.com/stremio-tech-update-83-stremio-v5-stremio-web-updated/)

## How the ecosystem fits together

| Part | Responsibility | Consequence for UX |
| --- | --- | --- |
| Client UI | Stremio Web renders React views and sends actions to a Rust/WASM core in a worker. | Browsing and state rules can be shared while the device presents its own controls. |
| Core | Models include catalogs, details, library, watching progress, notifications and playback selection. | A source response becomes product state rather than a provider-specific screen. |
| Addons | HTTP resources describe catalogs, titles, streams and subtitles. An addon can implement only some resources. | Discovery and playback can come from different services. |
| Account/API | Account-backed library and Continue Watching synchronize between clients. | A newly signed-in device can recover a user's collection and progress. |
| Player and companion service | `stremio-video` selects player implementations; the optional service expands Web playback beyond browser-supported sources. | Browsing success and playback capability are separate questions. |

Sources: [Web architecture](https://github.com/Stremio/stremio-web/blob/07553095e1c2f46f677e4ad341faa1dcb90fa760/README.md), [Core models](https://github.com/Stremio/stremio-core/tree/ab28e8423689ef8cca166cc097b8d6c2bc89f3df/src/models), [addon protocol](https://stremio.github.io/stremio-addon-sdk/protocol.html), [Web/service explanation](https://blog.stremio.com/stremio-tech-update-21-stremio-web-release-android-tv-update-stremio-on-iphone-and-more/), [service repository](https://github.com/Stremio/stremio-service).

The last source explains the original Web release in 2023. Its browser/companion distinction is useful architecture evidence, not a current exhaustive codec matrix. The current stream specification explicitly says protocol support depends on the client. A metadata card or an available stream URL therefore cannot prove that a particular browser, television or native player can play it. [Stream specification](https://stremio.github.io/stremio-addon-sdk/api/responses/stream.html)

### Addons are a data contract

The minimal HTTP addon exposes `manifest.json` and resource routes such as `/meta/movie/<id>.json` and `/stream/movie/<id>.json`. Catalogs supply lightweight title previews. Details supply richer metadata and episode IDs. Subtitle lookup is another resource. HTTP responses must allow cross-origin requests. This structure allows independent services to contribute data without each shipping its own client UI. [Protocol](https://stremio.github.io/stremio-addon-sdk/protocol.html)

The manifest advertises resource types and ID prefixes. For example, a stream addon accepting `tt` IDs can answer a request for a title discovered elsewhere. Catalog extras declare search, genre choices and required inputs, so the client can present supported filters. Configuration can happen on the addon's own `/configure` page; the manifest can require it before installation. [Manifest specification](https://stremio.github.io/stremio-addon-sdk/api/responses/manifest.html)

This is federation, not automatic deduplication. Addons must agree on IDs for that join to work. A title name alone does not establish that two items are the same film, edition or episode. Metadata can embed episode streams directly; the documented consequence is that Stremio does not ask other addons for streams for that video. These details matter if Couch ever imports catalogs. [Metadata and video objects](https://stremio.github.io/stremio-addon-sdk/api/responses/meta.html)

A stream can represent a direct media URL, torrent identity, YouTube identity, or an external webpage. Current documentation also includes Usenet and archive sources with explicit seeking/decompression limits. `externalUrl` is a browser handoff, not an in-app playback guarantee. A `bingeGroup` hints which next-episode source matches the current choice; subtitle matching can use filename, size and video hash. These fields express distinct capabilities that a generic Play button would otherwise conceal. [Stream objects](https://stremio.github.io/stremio-addon-sdk/api/responses/stream.html)

Cinemeta is an important metadata/catalog example, not the owner of watching progress. The protocol documentation links Cinemeta responses; Core's separate library model stores title identity, last video, offset, duration, watched state and notification preference. [Metadata examples](https://stremio.github.io/stremio-addon-sdk/api/responses/meta.html), [library data model](https://github.com/Stremio/stremio-core/blob/ab28e8423689ef8cca166cc097b8d6c2bc89f3df/src/types/library/library_item.rs)

### State ownership differs from Couch

Stremio's account synchronization supports separate clients recovering a library and continuing playback. Couch's phones command one authoritative TV session. The coordinator owns the queue and player observations; browsing routes remain local to each remote. Sharing profile data across devices and controlling one playback session solve different problems. An account-sync layer would not replace Couch's pairing, authority checks, reconnect handling or serialized commands. [Stremio Web](https://github.com/Stremio/stremio-web/blob/07553095e1c2f46f677e4ad341faa1dcb90fa760/README.md), [Couch state ownership](architecture.md#shared-state-is-server-authoritative-pubsub)

## User journeys worth studying

### Return to something unfinished

Stremio Web's Board places Continue Watching before catalog rows. Core derives it from resumable library items and new-episode notifications. The library item holds both collection membership and watching state, including temporary items, so those are separate concepts. A user need not deliberately curate every title they start. [Board](https://github.com/Stremio/stremio-web/blob/07553095e1c2f46f677e4ad341faa1dcb90fa760/src/routes/Board/Board.js), [Continue Watching model](https://github.com/Stremio/stremio-core/blob/ab28e8423689ef8cca166cc097b8d6c2bc89f3df/src/models/continue_watching_preview.rs), [library item](https://github.com/Stremio/stremio-core/blob/ab28e8423689ef8cca166cc097b8d6c2bc89f3df/src/types/library/library_item.rs)

Couch exposes local history under Library > History, plus Resume and From start on individual video items. Jellyfin already has its own Continue watching tab. The gap is their separation and initial visibility, not missing resume support. A small experiment could show local unfinished items at the first browsing destination, with a clearly labeled Jellyfin row when connected. Keeping rows distinct initially avoids inventing cross-account ownership or merging different editions' progress. [Couch library](../../src/client/LibraryPanel.tsx), [history](../../src/client/HistoryPanel.tsx), [video actions](../../src/client/VideoLibraryPanel.tsx), [Jellyfin](../../src/client/JellyfinPanel.tsx)

### Find a title without choosing a provider first

Stremio's Search renders separate catalog result rows, with independent ready, error and placeholder states. Discover offers filters, a focused-item preview and catalog pagination. These are two complementary jobs: search for something known, or browse a narrower catalog. Board loads rows around the visible range rather than immediately fetching every row. [Search](https://github.com/Stremio/stremio-web/blob/07553095e1c2f46f677e4ad341faa1dcb90fa760/src/routes/Search/Search.js), [Discover](https://github.com/Stremio/stremio-web/blob/07553095e1c2f46f677e4ad341faa1dcb90fa760/src/routes/Discover/Discover.js), [Board](https://github.com/Stremio/stremio-web/blob/07553095e1c2f46f677e4ad341faa1dcb90fa760/src/routes/Board/Board.js)

Couch currently searches local media, Jellyfin and selected online providers in their own panels. Online sources also differ: Bandcamp accepts public album/track links, while other providers support search. A shared search entry could return source-labeled groups from existing searchable integrations, show local results immediately, and let each remote group finish independently. It should retain direct-link entry and skip integrations without search. Universal ranking and cross-source deduplication are separate, larger decisions. [Library search](../../src/client/LibraryPanel.tsx), [Jellyfin search](../../src/client/JellyfinPanel.tsx), [provider capabilities and requests](../../src/client/ProviderPanel.tsx)

### Inspect a title, then choose playback

Stremio's stream list groups results by addon and offers an addon filter. It can show available results while a count indicates other addons are still loading. The selected episode stays visible. Different empty states cover no participating addons and all-error responses, although the latter collapses into a generic no-stream message. This is a useful pattern with a weakness worth avoiding: a provider outage should not imply that a title has no playable sources. [Stream list](https://github.com/Stremio/stremio-web/blob/07553095e1c2f46f677e4ad341faa1dcb90fa760/src/routes/MetaDetails/StreamsList/StreamsList.js)

Couch's local movie and episode detail actions already separate Play/Resume, From start and Queue. Its video browser also restores focus and scroll on Back. Preserve those behaviors. A source chooser becomes worthwhile when one title actually has multiple supported offers. Start that discussion with a real duplicate-title example, not a schema designed for a hypothetical marketplace. Distinguish an offer's provider, availability and playback behavior; never silently treat an external webpage as a TV stream. [Couch video browser](../../src/client/VideoLibraryPanel.tsx), [stream semantics](https://stremio.github.io/stremio-addon-sdk/api/responses/stream.html)

### Continue a series with fewer decisions

Core resolves the next episode, requests its streams and selects a matching stream through `is_binge_match`. That gives continuity a concrete source-selection rule. It is more precise than assuming every next episode should use the first returned URL. [Next episode/stream selection](https://github.com/Stremio/stremio-core/blob/ab28e8423689ef8cca166cc097b8d6c2bc89f3df/src/models/player.rs), [matching tests](https://github.com/Stremio/stremio-core/blob/ab28e8423689ef8cca166cc097b8d6c2bc89f3df/src/unit_tests/player/next_stream.rs)

For Couch, a possible first step is a visible next-unwatched episode action in the existing show browser. Automatic playback, prefetching and queue replacement are separate choices. The user must decide how an existing music/video queue interacts with a series. No such policy is selected here. [Current show/season/episode browser](../../src/client/VideoLibraryPanel.tsx)

### Reduce accidental actions on television

Stremio's July update explicitly separated opening an episode from playing it, corrected cards whose actions double-fired, and stopped addon dropdowns jumping during scrolling. It also adjusted held-key seeking and hid the desktop update banner during playback. These fixes are concrete test scenarios for Couch, not evidence that Stremio's entire TV interaction model should be copied. [July release notes](https://blog.stremio.com/stremio-tech-update-83-stremio-v5-stremio-web-updated/)

Couch already supports directional focus and nested dialogs, and its video browser retains the previous focus target and scroll position. Validate future layouts using the paired phone's directional pad as well as touch: opening Details must not start playback, Back must recover context, and delayed results must not move the selected control. [Navigation](../../src/client/navigation.ts), [video browser](../../src/client/VideoLibraryPanel.tsx)

## Current features that need qualification

Stremio introduced optional Supporters features in June 2026 and explicitly called them experimental. The announcement includes profiles, intro/outro skipping, catalog reordering/hiding/renaming, stream keyword filtering, richer Cinemeta configuration, downloads and live subtitle synchronization. Management and playback support vary by app; downloads were described as Desktop/Android Mobile, and some settings were managed in Desktop/Web. These are comparison candidates, not a universal free-client baseline. [Supporters announcement](https://blog.stremio.com/stremio-supporters-a-way-to-sustain-our-development/)

Couch already has watching profiles and playback preferences. There is no reason to add accounts simply because Stremio synchronizes them. Likewise, keyword stream filtering addresses the complexity of large addon result lists; it does not establish that Couch needs a filter language. Downloads, recommendations, intro detection and an episode-release calendar each add their own data and maintenance requirements. Evaluate them only if the corresponding user journey is selected. [Watching profiles](../../src/client/WatchingProfile.tsx), [playback preferences](../../src/client/PlaybackPreferences.tsx)

## Constraints on reuse

- Remote JSON addons avoid requiring downloaded plugin code in the client, but still depend on remote operators, returned URLs and configuration pages. As an engineering inference from this protocol, an integration would need bounded requests, response validation, credential redaction and Couch's existing restrictions on reachable destinations. Remote data is not automatically trustworthy. The manifest itself includes an explicit P2P disclosure flag. [Protocol](https://stremio.github.io/stremio-addon-sdk/protocol.html), [manifest hints](https://stremio.github.io/stremio-addon-sdk/api/responses/manifest.html)
- Metadata availability does not grant playback access. A stream may hand off to an external service or fail on the chosen device. Any compatibility experiment should use an authorized public or user-owned source and name supported stream kinds. This report does not claim support for subscriptions, DRM, torrents, archives or third-party credentials in Couch. [Stream contract](https://stremio.github.io/stremio-addon-sdk/api/responses/stream.html)
- Account synchronization introduces an external data dependency. Stremio's published privacy policy describes account credentials and automatically collected device/log information. Its policy is dated August 2020 and does not describe every 2026 experimental feature; it is insufficient evidence for a detailed current telemetry assessment. Keep Couch's existing local authority unless the user chooses a cross-device account requirement. [Published privacy policy](https://www.stremio.com/privacy), [Couch architecture](architecture.md#shared-state-is-server-authoritative-pubsub)
- Repository licenses differ. The inspected Web license is GPL-2.0; Core's is MIT. These are source facts, not a license-compatibility assessment. No upstream code or artwork is copied by this report. A future code-reuse proposal must name the exact component, revision and license before adoption. [Web license](https://github.com/Stremio/stremio-web/blob/07553095e1c2f46f677e4ad341faa1dcb90fa760/LICENSE.md), [Core license](https://github.com/Stremio/stremio-core/blob/ab28e8423689ef8cca166cc097b8d6c2bc89f3df/LICENSE.md)
- Stremio's architecture does not justify changing Couch's signed updates, systemd restart ownership or database recovery rules. Those solve appliance operation, while this research concerns discovery and watching. [Couch release contract](../hosted-releases.md)

## Proposed order for product decisions

These priorities are my inference from the comparison, not measured impact or approved work.

| Order | Bounded question to decide with the user | Smallest useful experiment | Evidence of success |
| --- | --- | --- | --- |
| 1 | Should unfinished local titles be visible immediately when browsing, alongside a labeled Jellyfin row? | Reuse current progress queries and actions in a temporary first-screen layout. | Returning to an unfinished item requires fewer navigation steps; the correct profile/source remains obvious. |
| 2 | Should one search entry query configured searchable sources? | Local and Jellyfin result groups first, each with its own loading/error state. | A user finds a known title without first knowing its source; one unavailable source does not block another. |
| 3 | When should selecting a card inspect it versus play it? | Compare existing movie/episode actions on TV and phone with a consistent detail-first option. | No accidental playback; Back restores focus and scroll; the direct Resume action stays easy to reach. |
| 4 | Should a show offer its next unwatched episode, and how should that affect the queue? | A manual next-episode action using existing local episode/progress data. | It selects the expected episode without changing unrelated queued media. |
| 5 | Is there a real need for the same title to aggregate multiple source offers? | Use one verified title available in two existing supported sources. | Users understand which source will play and why an offer is unavailable; identity/progress semantics are explicit. |

A public addon marketplace, Stremio account import and a replacement player are not prerequisites for these experiments. If Stremio compatibility later becomes a chosen destination, first specify whether the requirement is catalog discovery, HTTP playback, or broader transport support. Then test one addon implementing exactly that requirement. The four-resource protocol is a useful reference; adopting the whole ecosystem would be a separate project.
