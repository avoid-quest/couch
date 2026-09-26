# Reusing radio.avoid.quest in Couch

Checked on 2026-09-26 against deployed endpoints and the first-party
[radio source at e43918c](https://github.com/avoid-quest/avoid.quest/tree/e43918c9822924000dd8922cf4871cfb6330b98f/apps/radio).
This supersedes the September 8 deployment notes for
[issue #167](https://github.com/avoid-quest/couch/issues/167).

## Provider contract

[The public M3U](https://radio.avoid.quest/playlist.m3u) owns the built-in catalog:
station IDs, names, stream URLs, logos and group. [The JSON export](https://radio.avoid.quest/api/stations.json)
currently exposes the same ten stations and numeric order. It adds no descriptions,
tags or higher-resolution image alternatives.

[Station-ID metadata](https://radio.avoid.quest/api/radio-metadata?stationId=avoid-radio-nts-radio-channel-1)
is deployed and returned HTTP 200 with the NTS show “Alexander Nut W/ Allysha Joy”,
its description, “Detroit House” genre, a programme link and 400 × 400 show artwork.
Artist, album and bitrate are nullable fields in the
[provider schema](https://github.com/avoid-quest/avoid.quest/blob/e43918c9822924000dd8922cf4871cfb6330b98f/apps/radio/src/lib/metadata/types.ts).
Availability varies by station. Use the supplied artwork URL; the contract does not
provide a larger variant to select.

The response carries `sampledAt`, `expiresAt` and `refreshAfterMs`. The observed
successful sample remains cached for fifteen minutes; polling faster cannot make
that sample real time. The
[provider workflow](https://github.com/avoid-quest/avoid.quest/blob/e43918c9822924000dd8922cf4871cfb6330b98f/apps/radio/src/lib/metadata/metadata-workflow.ts)
resolves station configuration and owns retrieval/caching. Keep that knowledge
there instead of maintaining station-specific scrapers in Couch.

## Couch integration

The hub shares validated metadata between discovery and active playback, preserving
provider freshness and HTTP rate limits. It keeps the anonymous service cookie in
memory. Programme expiry clears the active snapshot before refreshing; failure leaves
audio running, and playback changes reject late metadata. Discovery polls while
visible and drops expired details. libmpv's observed track remains separate from the
provider's show information.

Browse/search use show artwork, title, genre, artist and a visible description preview.
The local and remote player expose show descriptions, genre, available artist/album/
bitrate. Browser remotes also expose the provider's show link; the native app
blocks new windows. Existing shadcn Badge/Button and divided media
rows cover these needs; no custom UI primitive or image-URL rewriting is needed.
New artwork can load even when the preceding programme's image failed.

Focused tests cover field validation, expiry/failure, shared requests, late responses,
show updates without user input, local/remote show details and artwork recovery.
Native playback and physical TV/two-controller acceptance remain device checks;
no provider deployment or release is part of this change.
