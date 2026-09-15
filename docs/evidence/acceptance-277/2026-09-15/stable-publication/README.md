# Stable 0.1.0 publication

The owner accepted the completed T480 campaign, deferred the remaining checks and authorized Stable publication and closure of #276 and #277 on 2026-09-15. Their closure comments record that scope. The owner also reported successful audible playback after the retained muted checks.

Stable promotes the six original qualified Preview files and signatures without rebuilding or resigning. The app is 0.1.0 at revision `61739ad7ce782da5482067f16a5727306cd65d6a`, with AppImage SHA-256 `dd50813112c9643faddeedee46889e8102965c97f5d77bfd43d45756a20c6a05`.

The publisher verified the original files, signatures, qualification and exact provider asset set before publication. See [publication receipt](publish-stable.json) and [public readiness](readiness-stable.json). The Preview and Stable readiness files have identical file identities and signatures.

The first public-readiness attempt reached the updater artifact download and exhausted its retries on HTTP 429. That attempt failed. The subsequent run spaced fetches by 15 seconds while preserving the same HTTPS, status, size, hash, metadata and signature checks. No release files or provider URLs were changed to repair the verification run.

The [T480 report](../t480-update/REPORT.md) remains the historical acceptance checkpoint, including its original failures and unrun cases. Publication does not turn those cases into passes. The generic rejected-download diagnostic remains tracked in [#295](https://github.com/avoid-quest/couch/issues/295). The signing-key offline backup remains owner-deferred.
