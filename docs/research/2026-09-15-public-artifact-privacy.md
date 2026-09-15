# Public artifact privacy check, 15 September 2026

## Result

No personal Couch owner data or production credentials were detected in the checked release. This conclusion combines a fresh scan of the actual public downloads with the previous exact production-secret comparison. It is a bounded content check, not proof that every possible secret is absent.

The private Git repository is not shipped. However, the compiled Bun executable contains readable minified application JavaScript, including server routes, database schema and the browser application. Publishing Couch makes that application logic inspectable. A private repository does not make distributed code confidential.

## Actual public downloads

Fetched these Stable files anonymously from `https://cdn.crabnebula.app/download/avoid-quest/couch/latest/`. All three byte counts and SHA-256 hashes matched the [retained Stable readiness receipt](../evidence/acceptance-277/2026-09-15/stable-publication/readiness-stable.json).

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `Couch_0.1.0_amd64.AppImage` | 289110520 | `dd50813112c9643faddeedee46889e8102965c97f5d77bfd43d45756a20c6a05` |
| `couch-setup-0.1.0.tar.gz` | 16604 | `0773af9fce0efce8433ff27396a15e4b6996663d244f5e32be7b491779efa5df` |
| `couch-distribution-material-0.1.0.tar.gz` | 3159850 | `e10daed4e775cd61cf63e76ca4bf10ba63ad74cd4e13d062cecade387d82d102` |

Stable release ID is `01M2JA7QB9YMMXFWD5WCDGQV3H`; source revision is `61739ad7ce782da5482067f16a5727306cd65d6a`. See the [publication receipt](../evidence/acceptance-277/2026-09-15/stable-publication/publish-stable.json).

## Fresh inspection

Read the AppImage's Zstandard SquashFS filesystem directly at offset 944632 using [PySquashfsImage](https://github.com/matteomattei/PySquashfsImage), without running the application or copying its case-sensitive file tree onto the Mac. Scanned all regular files in that image and both archives, 3,440 files and 761,440,895 decoded bytes in total.

- No current Git author name/email, owner home path or private repository URL matched. No `.env`, database, browser-profile or `.map` filenames were present.
- The setup archive has 36 entries and dependency-material archive has 2,530 entries. Both use numeric owner/group zero, empty owner names, safe relative paths and no symlinks.
- `couch-server` has a 2,285,142-byte `.bun` application section containing readable minified JavaScript. That section has no inline `sourceMappingURL=data:` or `sourcesContent` markers. Neither Couch executable has ELF debug sections. No original TypeScript source maps were found. Generic source-map strings elsewhere in the executable belong to the embedded Bun runtime.
- The legacy string `modern-kodi.remote-token` is a localStorage key name, not a saved token. LAN addresses in Couch's bundle are form placeholders found in [PlaybackDevice.tsx](../../src/client/PlaybackDevice.tsx) and [JellyfinSettings.tsx](../../src/client/JellyfinSettings.tsx).
- Generic `/root/.cargo/registry/...` build paths and Bun virtual `/root/...` asset names are visible. These identify build machinery, not the owner's home directory. Public metadata includes source revision, dependency versions, hashes, upstream URLs and the updater public key.
- Dependency notices contain upstream authors' public names/emails and documentation examples. Seven complete private-key blocks in `libgnutls.so.30` exactly match the publicly documented test inputs in [GnuTLS's self-test source](https://github.com/gnutls/gnutls/blob/master/lib/crypto-selftests-pk.c). They are not Couch signing keys. Other PEM markers are parser strings; an AWS-shaped match in `libunistring.so.5` is part of its uppercase Unicode-name table. No GitHub-token pattern matched.

## Existing exact-secret check and packaging controls

The [retained sealed-content check](../evidence/acceptance-277/2026-09-15/mac-production-b-gles/public-archive-checks.json) checked both archives and all 2,033 AppImage inventory entries against qualified hashes, reporting no secret matches. The associated [sanitization record](../evidence/acceptance-277/2026-09-15/mac-production-b-gles/sanitization-audit.json) names the privately loaded production signing key/password, CrabNebula API key and Wrangler credentials. This fresh check did not reload or compare those secret values; it verified the downloaded payload hashes and scanned patterns and known owner identifiers independently.

[package-setup.ts](../../scripts/package-setup.ts) explicitly selects setup files and dependency material. It does not recursively export the repository or evidence. [tauri.package.conf.json](../../src-tauri/tauri.package.conf.json) selects application resources. [build.ts](../../scripts/build.ts) minifies bundles, disables compiled-server dotenv/bunfig autoloading and does not enable source maps.

The public setup intentionally includes install/recovery scripts and default TV configuration. The material archive intentionally includes dependency notices and approved extractor source. These are distributed code and defaults, not saved user settings.

## Limits

Fresh signature files and every historical release were not downloaded again. The payloads match the previously verified Stable identities. The scan read the files inside SquashFS and the tarballs; it did not recursively unpack compressed internals of every third-party executable or reverse-engineer Tauri's embedded assets. It does not establish absence of an unknown credential format. No rotation or emergency withdrawal is indicated by the evidence found here.
