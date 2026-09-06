# Verified update staging

The packaged Ubuntu coordinator starts an asynchronous check one second after startup, then every 15 minutes. Its update manager owns one check or download at a time. Playback commands and the native owner are independent of this work. Source/development runs report that package updates are unavailable.

The administrator API accepts only these requests:

| Request | Body | Result |
| --- | --- | --- |
| GET `/api/updates` | None | Running identity, selected channel, manual policy, state, last successful check, last known candidate and safe error |
| POST `/api/updates/channel` | `{"channel":"stable"}` or `{"channel":"preview"}` | Persist selection, invalidate the previous candidate and start a check |
| POST `/api/updates/check` | `{"check":true}` | Start Check now |
| POST `/api/updates/stage` | `{"candidateId":"MANIFEST_SHA256"}` | Download the current authenticated candidate |

All routes require a currently authorized administrator remote. Browser callers cannot supply a path, feed URL, signing key, package name or command. Accepted operations return 202 and continue if that browser disconnects. GET reports progress. Concurrent mutations return 409. Channel and policy are separate saved fields in `updates/settings.json` beside the installation database. New settings default to Stable and manual installation. Changing channels never installs a package. A channel at or below the running Debian version produces no candidate, so switching to Stable cannot downgrade data.

The host reads the root-owned `/etc/apt/sources.list.d/couch.sources` and separately enrolled `/etc/apt/keyrings/couch.asc`. It never replaces the key from the feed or uses ambient keyrings. `gpgv` verifies InRelease and emits its signed plaintext. The verifier rejects SHA1 signatures, expired or future metadata, wrong suites and architectures, duplicate fields, and inconsistent manifest/package identities. The signed SHA256 list authenticates both the manifest and the package index. Index acquisition uses the immutable by-hash path. A publication race fetching the manifest fails authentication and can be retried.

Downloads stream into private partial directories with fixed size/hash limits. Before readiness, `dpkg-deb` checks each archive's identity, and its content listing supplies unpacked size even when an archive has no Installed-Size field. Staging and installation filesystems both need reserve space. Both exact packages and their signed metadata move into `updates/staged/MANIFEST_SHA256` only after verification. No APT operation runs here. A failed download removes its partial directory and preserves previous completed candidates. Startup removes interrupted partials; it never trusts a saved ready flag and requires a fresh check before staging again.

Completed candidate directories are retained for the later installation/recovery owner. That owner must hold a maintenance lock before any installation or staging mutation, independently verify the signed metadata and exact bytes using enrolled trust, and resolve an opaque identity inside its own fixed staging root. The current ready state is not authorization to execute a path. APT remains the installed-file owner. No installation endpoint or button is present in this slice.

`currentCheck` is false on restart and failed checks. The last successful timestamp and last known release remain visible as historical information. The signed publication timestamp is exposed with the candidate so a real LAN check can measure discovery latency. This field alone is not a measured qualification result.

Run `bun test src/server/update-feed.test.ts src/server/updates.test.ts` for state and failure checks. The disposable Ubuntu fixture uses `python3 scripts/test-update-feed.py /absolute/new-fixture` followed by `bun scripts/test-update-feed.ts /absolute/new-fixture`. Its signing key is disposable and must never be enrolled on the TV. The fixture exercises real gpgv, dpkg and dpkg-deb, but does not install packages or qualify physical playback.

The verifier follows [GnuPG's gpgv contract](https://www.gnupg.org/documentation/manuals/gnupg/gpgv.html) and the [Debian repository format](https://wiki.debian.org/DebianRepository/Format).
