# Reusing radio.avoid.quest in Couch

Research for [Explore potential `radio.avoid.quest` first class support](https://github.com/avoid-quest/couch/issues/167), checked on 2026-09-08. The owner selected programme titles and artwork on the same day, with one metadata implementation maintained by radio.avoid.quest. Personal saved-station import is outside this increment.

## Recommendation

Keep the deployed M3U as the catalog authority and Couch's native player as the playback authority. Couch already has an **Add avoid radio** action in Settings > Sources. It imports the deployed catalog, and paired phones browse, favorite and queue its stations. Reimplementing this would add no capability. [Couch settings](../../src/client/RadioSettings.tsx), [catalog](../../src/server/radio.ts), [existing radio evidence](providers.md#radio-station-feeds)

The accepted next feature is programme metadata from the deployed radio service. Reuse its station-specific metadata retrieval and shared cache. First expose a provider-owned station-ID lookup so Couch does not copy the radio app's per-station configuration. Keep personal-library import and DJ playback outside that increment. Couch consumes the service contract; it does not maintain station-specific scraping or metadata configuration.

## Ownership and deployment evidence

The first-party implementation is in the private [avoid-quest/avoid.quest repository](https://github.com/avoid-quest/avoid.quest/tree/ba7742f62eead5abdad4ea56a1bcade0f32b0dc5/apps/radio), inspected at `ba7742f62eead5abdad4ea56a1bcade0f32b0dc5`. It is a TanStack Start application deployed through Cloudflare Workers. The repository is accessible through the authenticated GitHub account. This establishes source access, not Cloudflare deployment permission. [Worker configuration](https://github.com/avoid-quest/avoid.quest/blob/ba7742f62eead5abdad4ea56a1bcade0f32b0dc5/apps/radio/wrangler.jsonc)

Public GET requests to the deployed home page, playlist, station JSON and one metadata lookup succeeded. Executing the inspected source's `getPublicKodiStations` and `renderKodiM3uPlaylist` produced exactly the deployed JSON station array and M3U bytes. That verifies those exports against this source snapshot; it does not identify the deployed application's complete commit.

| Deployed contract | Observed behavior | Reuse in Couch |
| --- | --- | --- |
| [GET /playlist.m3u](https://radio.avoid.quest/playlist.m3u) | HTTP 200, `audio/x-mpegurl; charset=utf-8`, ten entries, stable exported IDs, names, stream URLs, logos and group | Already supported by the saved-playlist importer |
| [GET /api/stations.json](https://radio.avoid.quest/api/stations.json) | HTTP 200, `{ stations: [...] }`, the same ten entries plus numeric order | Useful for catalog clients, but adds no required field to Couch's present M3U integration |
| [GET /api/radio-metadata](https://github.com/avoid-quest/avoid.quest/blob/ba7742f62eead5abdad4ea56a1bcade0f32b0dc5/apps/radio/src/routes/api/radio-metadata.ts) | A configured NTS lookup returned HTTP 200 with programme title, artwork, item URL, genre and timestamps | Reusable metadata service after defining how Couch gets the required station configuration |

Both catalog endpoints returned `Cache-Control: public, max-age=300, stale-while-revalidate=3600`, with no account, request cookie or custom authorization header. The routes read the code-owned default station list, filter enabled public HTTP/S entries and sort them by order. They do not read a visitor's saved stations. Current defaults omit explicit IDs, so the export derives IDs from station names. A future station rename can therefore change identity unless the producer supplies a persistent explicit ID. [M3U route](https://github.com/avoid-quest/avoid.quest/blob/ba7742f62eead5abdad4ea56a1bcade0f32b0dc5/apps/radio/src/routes/playlist%5B.%5Dm3u.ts), [JSON route](https://github.com/avoid-quest/avoid.quest/blob/ba7742f62eead5abdad4ea56a1bcade0f32b0dc5/apps/radio/src/routes/api/stations%5B.%5Djson.ts), [export implementation](https://github.com/avoid-quest/avoid.quest/blob/ba7742f62eead5abdad4ea56a1bcade0f32b0dc5/apps/radio/src/lib/kodi-playlist.ts), [defaults](https://github.com/avoid-quest/avoid.quest/blob/ba7742f62eead5abdad4ea56a1bcade0f32b0dc5/apps/radio/src/lib/const.ts)

## What Couch already owns

At research base `b581323aba5bba0bf28c34c25b2e0441b17c0bcc`, the administrator action saves `https://radio.avoid.quest/playlist.m3u` through the existing authenticated API. SQLite owns the imported catalog and household favorites. Refresh retains station identity when exported IDs remain unchanged, updates matching favorites and retains the previous catalog on failure. Queue entries reference station IDs and resolve their current URL at playback time. [Settings API](../../src/server/radio-settings.ts), [catalog](../../src/server/radio.ts), [parser](../../src/server/radio-playlists.ts), [shared journey tests](../../src/server/hub.test.ts)

Native radio playback reads stream tags through libmpv. Couch keeps the station's queue identity separate from the current track, retries failed stations with bounded backoff and retains the no-autoplay restart policy. `NowPlaying` currently holds a title and optional artist, not programme artwork or freshness timestamps. [Protocol](../../src/shared/protocol.ts), [retry tests](../../src/server/radio-retry.test.ts), [prior native evidence](providers.md#radio-station-feeds)

The real Couch parser accepted this pass's downloaded M3U snapshot and produced all ten expected station identities, names, stream URLs and logos in the exported order. This was a parser check, not native playback qualification. The earlier 2026-09-05 ten-stream probes and Linux app observations remain dated evidence in the provider report. No T480 playback, deployment or device settings were changed in this pass.

## Richer metadata is available, with one missing contract

The deployed lookup was equivalent to:

```text
GET /api/radio-metadata?kind=nts-live-api&channel=1&url=https%3A%2F%2Fstreams.radiomast.io%2Fnts1
```

It returned `ok: true`, title `HTRK (R)`, an artwork URL, programme link, description and genre. The payload identified `source: nts-live-api` and included `sampledAt` and `expiresAt`, fifteen minutes apart. This is one live response, not a guarantee that every provider supplies every field. [Metadata types](https://github.com/avoid-quest/avoid.quest/blob/ba7742f62eead5abdad4ea56a1bcade0f32b0dc5/apps/radio/src/lib/metadata/types.ts), [lookup workflow](https://github.com/avoid-quest/avoid.quest/blob/ba7742f62eead5abdad4ea56a1bcade0f32b0dc5/apps/radio/src/lib/metadata/metadata-workflow.ts)

The metadata route accepts anonymous callers and creates an HTTP-only `radio_session_id` cookie when missing. This is a session and rate-limit mechanism, not a login to a personal catalog. The inspected request policy creates sessions by default and rate-limits the request. The live response used `Cache-Control: private, no-store` and allowed the radio origin through CORS. A Couch server-side integration avoids cross-origin browser cookie requirements; it should honor rate limits and keep any service cookie off paired-phone snapshots and logs. [Request policy](https://github.com/avoid-quest/avoid.quest/blob/ba7742f62eead5abdad4ea56a1bcade0f32b0dc5/apps/radio/src/lib/proxy/request-policy.ts), [rate-limit middleware](https://github.com/avoid-quest/avoid.quest/blob/ba7742f62eead5abdad4ea56a1bcade0f32b0dc5/apps/radio/src/lib/middleware/rate-limit.ts), [cookie creation](https://github.com/avoid-quest/avoid.quest/blob/ba7742f62eead5abdad4ea56a1bcade0f32b0dc5/apps/radio/src/lib/middleware/session.ts)

The current service requires `url` plus a metadata `kind` and sometimes `metadataUrl`, channel or stream ID. Neither public catalog includes `metadataConfig`. The radio client gets it from its own station configuration and polls every thirty seconds while requested. Successful service results can stay cached for fifteen minutes; polling more often does not imply fresher programme information. Couch must preserve sample/expiry meaning when presenting a result. [Client lookup](https://github.com/avoid-quest/avoid.quest/blob/ba7742f62eead5abdad4ea56a1bcade0f32b0dc5/apps/radio/src/lib/hooks/use-radio-metadata.ts), [configuration lookup](https://github.com/avoid-quest/avoid.quest/blob/ba7742f62eead5abdad4ea56a1bcade0f32b0dc5/apps/radio/src/lib/metadata/radio-config.ts), [cache](https://github.com/avoid-quest/avoid.quest/blob/ba7742f62eead5abdad4ea56a1bcade0f32b0dc5/apps/radio/src/lib/metadata/cache.ts)

The proposed next increment is:

1. In the radio repository, let the existing metadata route accept an exported station ID and resolve its current stream/configuration from the same default list as the catalog. Keep the response schema and retrieval/cache implementation. This is a proposed API addition, not an existing endpoint.
2. In Couch, request enrichment only for the active station from the saved avoid feed. One coordinator request serves every paired remote. Bound requests, cancel on playback changes, reject stale playback generations and stop polling when the station stops.
3. Preserve libmpv's observed track text and station identity. Put provider programme title/artwork in a separate optional metadata field with provenance and freshness, so schedule data cannot overwrite an observed track or survive a station change.
4. Verify provider failure, expiry, changed stream URLs, station changes, two-phone consistency and missing artwork. Metadata failure must leave audio playback working.

An additive `metadataConfig` field in the JSON export would also work, but requires a Couch adapter that understands every provider query parameter. The station-ID lookup keeps this knowledge with the deployed radio service and fits the request to reuse it. Neither approach requires moving audio bytes through the radio Worker or embedding the radio player.

## Personal libraries and browser playback

Personal stations use TanStack DB collections backed by the browser's `localStorage` key `radio-app-radios`. The application exports a versioned JSON configuration or a compressed `/import#data=...` share link containing radios and settings. The inspected routes expose no account-backed personal-library sync API. Source access cannot recover a user's browser-local collection. [Station storage](https://github.com/avoid-quest/avoid.quest/blob/ba7742f62eead5abdad4ea56a1bcade0f32b0dc5/apps/radio/src/lib/collections/radios.ts), [export/import implementation](https://github.com/avoid-quest/avoid.quest/blob/ba7742f62eead5abdad4ea56a1bcade0f32b0dc5/apps/radio/src/lib/db/export-import.ts), [route tree](https://github.com/avoid-quest/avoid.quest/blob/ba7742f62eead5abdad4ea56a1bcade0f32b0dc5/apps/radio/src/routeTree.gen.ts)

If personal-library transfer is selected, use that explicit export as input, validate supported public stream URLs and preview a merge into Couch's household catalog. Do not import browser playback settings or silently replace household favorites. A continuous sync feature would need a separately designed storage and ownership contract. This report does not select either behavior for the owner.

The radio application also has single, multiple and DJ playback modes, browser audio processing and external platform server functions. Those are browser-player and internal application contracts. Embedding them would require a separate playback authority and browser-local state reconciliation, which does not fit Couch's current shared native player. They are not needed for catalog or metadata reuse. [Radio architecture](https://github.com/avoid-quest/avoid.quest/blob/ba7742f62eead5abdad4ea56a1bcade0f32b0dc5/apps/radio/README.md)

## Accepted implementation and qualification

The owner chose programme titles and artwork, with one maintained implementation
in radio.avoid.quest. The provider change adds `stationId` to the existing metadata
workflow, using the same public export identity and default station configuration.
The original parameter-based route continues serving the radio application and
shares retrieval and cache entries with station-ID callers. Caller parameters
cannot override a station's provider-owned configuration.

Couch requests metadata only for a currently playing or paused station imported
from `https://radio.avoid.quest/playlist.m3u`. The hub binds each lookup to the
resolved native playback stream and playback ID, then shares one optional
`radioProgramme` snapshot with every controller. Queue station identity and
libmpv's observed song/artist remain separate. Programme artwork and title appear
on the TV audio stage and in remote controls, with provider attribution on the
controls. Missing artwork leaves the title usable.

Successful responses retain provider `sampledAt` and `expiresAt`. At expiry the
hub removes the programme before fetching again. Station changes, stop, player
loss, removed catalog entries, changed stream URLs and shutdown cancel the old
request/timer. A response for a different stream, an expired or malformed response,
or an upstream failure cannot replace the displayed programme. Failures retry
once per minute; HTTP 429 observes bounded `Retry-After` delays. The service's
anonymous session cookie stays in the hub's memory and never enters snapshots,
SQLite or logs. Native audio playback does not depend on metadata availability.

The provider branch is prepared against `avoid-quest/avoid.quest` remote main
`ba7742f62eead5abdad4ea56a1bcade0f32b0dc5`. Its full radio test suite passed 973 tests,
repo lint/typecheck passed, and the radio production build passed. Focused Couch
checks cover one-request sharing, expiry and retry, cancellation and stale
responses, imported-source provenance, changed stream URLs, session separation
and rendered controls. These are software checks, not product acceptance.

A read-only live check on 2026-09-08 returned HTTP 400
`RADIO_METADATA_URL_REQUIRED` for the station-ID query. The existing configured
NTS lookup returned HTTP 200 with `THE NTS BREAKFAST SHOW W/ FLO`, artwork, and
provider freshness timestamps. This proves that the new endpoint form is not yet
deployed, while the existing metadata implementation is available.

Keep issue #167 open. Delivery still requires review/publication of both changes,
normal radio Worker deployment, a live station-ID lookup, and installed native
playback with the same programme visible on the TV and two paired controllers.
Check a station change, missing artwork, provider failure and expiry while audio
continues. No provider deployment or physical-device acceptance was performed in
this implementation pass.
