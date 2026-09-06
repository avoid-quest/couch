# Cue sheet parsing and segments

Research checked on 2026-09-06 for [Play local cue-sheet albums as ordered tracks](https://github.com/avoid-quest/couch/issues/30). The issue owns acceptance and integration status.

## Parser selection

Use `@gplane/cue` 0.2.0, pinned in the package manifest and lockfile. It is an MIT-licensed ESM package with TypeScript declarations and no runtime dependencies. The release dates to 2024-01-14. The non-archived upstream's latest commit, dated 2025-08-23, updates trusted publishing. That is maintainer activity, not evidence of recent parser development or frequent releases. [npm metadata](https://registry.npmjs.org/@gplane%2fcue), [publishing maintenance](https://github.com/g-plane/cue/commit/6c86e2a2de27f7d21fb1d7038838c2eac8295b10), [license](https://github.com/g-plane/cue/blob/v0.2.0/LICENSE).

```ts
import { parse } from "@gplane/cue";
const { sheet } = parse(text, { fatal: true, checkAtLeastOneTrack: true });
```

`fatal` throws the first reported error, with line and column. Keep `strictFileCommandPosition` off because it rejects ordinary album metadata before FILE. The parser constructs the sheet; Couch checks whether that sheet fits the supported product subset. [Public parser](https://github.com/g-plane/cue/blob/v0.2.0/src/parser.ts), [error definitions](https://github.com/g-plane/cue/blob/v0.2.0/src/errors.ts).

The AST preserves FILE declarations, track order, all INDEX entries as minute/second/frame tuples, and gap properties. It separates sheet and track titles/performers. Repeated metadata overwrites earlier metadata, and REM comments lose track scope. Couch ignores REM content. [AST definitions](https://github.com/g-plane/cue/blob/v0.2.0/src/types.ts), [upstream fixtures](https://github.com/g-plane/cue/blob/v0.2.0/tests/parser_integration.test.ts).

Fatal parsing still accepts missing indexes and decreasing timestamps. Numeric tokens use `parseInt`, so suffixes can disappear, and unknown bare commands can disappear too. Couch rejects unknown directives and malformed TRACK/INDEX number tokens before parsing, then validates indexes from the AST. It does not build a second grammar parser. Regressions exercise the published package under Bun, including these tolerant behaviors. [Parser implementation](https://github.com/g-plane/cue/blob/v0.2.0/src/parser.ts).

The native alternative, libcue, has upstream parser work from February 2026 but requires a bridge into the Bun sidecar. Its 2.3.0 release also predates a bounds correction. It offers no advantage for this bounded TypeScript slice. [Release](https://github.com/lipnitsk/libcue/releases/tag/v2.3.0), [subsequent bounds fix](https://github.com/lipnitsk/libcue/commit/0d121303285df1b9f3099e99c168af52f2e41dd9), [2026 parser change](https://github.com/lipnitsk/libcue/commit/dd35d8392bb8ff98083e2fe34ce589e24fc7875a).

## Supported subset

- UTF-8, with optional BOM, LF or CRLF line endings. At most 256 KiB, 2,048 lines, 2,048 characters per line, and 99 TRACK directives. Check these limits before parsing. Read at most the byte limit plus one detection byte from the sheet.
- One FILE declaration, even if repeated declarations name the same file. Its type is WAVE and its filename ends in `.flac` or `.wav`. The existing music-metadata dependency must recognize lossless FLAC or WAVE content and a positive duration. Audio is limited to 512 MiB, with cover extraction skipped above 64 MiB, matching the existing music metadata bounds.
- Consecutive AUDIO tracks numbered 01 through 99, starting at 01. Each has exactly one INDEX 01. The first starts at zero; later starts strictly increase. Convert timestamps to integer frames with `(minutes * 60 + seconds) * 75 + frames`; seconds are 0–59 and frames 0–74. Ends come from the next track start or the measured file duration. Every segment has positive duration and fits inside the audio file.
- Album/track TITLE and PERFORMER override audio tags. Missing track titles become `Track 01`, and a missing album title falls back to the audio album tag or cue filename. CATALOG, SONGWRITER, ISRC and REM are parsed but do not affect playback.
- FILE references use relative local paths. A parent directory reference is valid only when its resolved file remains inside the same source. Absolute paths, URLs, drive/UNC paths, symlinks and missing files fail. Check the cue file and referenced audio before opening them. CDTEXTFILE, FLAGS, PREGAP, POSTGAP, INDEX 00, extra indexes, multiple files, data tracks and other encodings are unsupported and produce errors.

## Identity and playback integration

The module derives a cue album ID from source ID and source-relative cue path. A track ID also includes TRACK number. Titles, source filenames, timestamps and modification times do not enter identity. Rescan keeps the identity when those values change; moving the cue sheet or changing its track number creates a different identity.

The planned catalog integration retains existing `library:<id>` queue, saved playlist and progress references. The resolver supplies the current source and segment at Play. Absolute host filenames remain host-owned. Integration tests must verify rescans, persisted playlists/progress, restart without autoplay, and current duration refresh.

The native integration remains a separate stack layer. mpv documents start and end bounds, including playing ten seconds with start 30/end 40. A segment helper will translate resume/seek positions and observations between file time and segment time, and reset both bounds on each source replacement. It must preserve the existing playback-ID checks and ReplayGain reset/preload order. [mpv playback control](https://mpv.io/manual/stable/#playback-control).

The [fixture recipe](../../tests/fixtures/cue/README.md) records the generated lossless album, exact boundaries and hashes. Parser/metadata tests are local software evidence. Native end/seek/Next/Stop/replacement, actual TV and two HTTP controllers, reconnect and viewport qualification still require the integration layers and their resource grants. Gapless and physical audio qualification are separate.
