# Hosted updater metadata observations

Four sequential GET requests used the updater endpoint in `scripts/hosted-policy.ts` on 15 September 2026, completing at `01:34:00.229Z`. They fetched 2,040 response-body bytes in total. No AppImage, asset URL or other download body was fetched. No response was rate limited, so no retry was needed.

| Channel | Reported current version | HTTP | Observed provider response |
| --- | --- | --- | --- |
| Preview | `0.1.0-preview.1`, A | 200 | Offers corrected `0.1.0`; signature exactly matches the qualified B manifest |
| Preview | `0.1.0`, equal | 204 | Empty response |
| Preview | `0.2.0`, higher | 200 | Returns `0.1.0` metadata and its matching signature despite the higher reported version |
| Stable | `0.1.0-preview.1`, A | 404 | Empty response while no Stable release is published |

[summary.json](summary.json) records request URLs, statuses, body SHA-256 hashes, candidate identity and signature comparisons. Each `*-attempt-1.json` preserves the first status, selected headers and parsed provider body, or the empty response. Body hashes describe the original response bytes before parsing.

The matching candidate is source `61739ad7ce782da5482067f16a5727306cd65d6a`, AppImage SHA-256 `dd50813112c9643faddeedee46889e8102965c97f5d77bfd43d45756a20c6a05`. These metadata responses identify the same signed candidate; this probe does not independently reverify its downloaded bytes.

These are server metadata observations. In particular, the higher-version request demonstrates that the server can return lower-version metadata. It does not demonstrate Couch accepting a downgrade. Equal-version handling, downgrade rejection, switching channels, real update installation/relaunch and preservation of local state require separate client acceptance evidence. No Couch update or installation was attempted here. The Stable 404 is a provider response, not a successful Stable promotion or switching test.

Static cross-check: Couch uses the default Tauri updater version comparator; its locked `tauri-plugin-updater` 2.11.0 accepts only a remote version strictly greater than the installed version. Thus a provider response containing a lower version is not itself evidence of a Couch downgrade. This code inspection does not replace an installed-client rejection test.
