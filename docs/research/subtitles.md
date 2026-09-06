# Subtitle corpus and qualification

This is corpus preparation for [Qualify styled and image subtitle playback in
the packaged native app](https://github.com/avoid-quest/couch/issues/33), checked
2026-09-06. The initial source base is
`b7031b9258b385371e1f09df0f325a19c3e2c093`.
The [CI gate is closed](https://github.com/avoid-quest/couch/issues/43#issuecomment-5555040631)
and [that base passed Check](https://github.com/avoid-quest/couch/actions/runs/33996451171).
[Production packaging](https://github.com/avoid-quest/couch/issues/2) remains an
open native blocker. No packaged app, Docker, HTTP remote, native screenshot,
physical display or audio test ran for this corpus slice.

## Reproduce the inputs

Run from the repository root. Python 3.12, the pinned dependencies below and an
FFmpeg build with libx264, libass, PGS decoding and DVD subtitle encoding are
required. The imageio wheel supplies a local FFmpeg executable when the host has
none. Dependencies and generated outputs stay under the ignored artifact path.
The committed subset font makes normal generation offline after tool setup.

```sh
python3 -m venv .artifacts/subtitles/venv
.artifacts/subtitles/venv/bin/python -m pip install -r tests/fixtures/subtitles/requirements.txt
SUBTITLE_FFMPEG=$(.artifacts/subtitles/venv/bin/python -c 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())')
curl -fL https://github.com/dejavu-fonts/dejavu-fonts/releases/download/version_2_37/dejavu-sans-ttf-2.37.zip -o .artifacts/subtitles/dejavu-sans-ttf-2.37.zip
.artifacts/subtitles/venv/bin/python tests/fixtures/subtitles/generate.py .artifacts/subtitles/corpus --ffmpeg "$SUBTITLE_FFMPEG"
.artifacts/subtitles/venv/bin/python tests/fixtures/subtitles/verify.py .artifacts/subtitles/corpus --ffmpeg "$SUBTITLE_FFMPEG" --font-archive .artifacts/subtitles/dejavu-sans-ttf-2.37.zip
.artifacts/subtitles/venv/bin/python tests/fixtures/subtitles/negative-controls.py .artifacts/subtitles/negative-controls --ffmpeg "$SUBTITLE_FFMPEG" --font-archive .artifacts/subtitles/dejavu-sans-ttf-2.37.zip
```

To rebuild the committed font, run `prepare-font.py` with the downloaded ZIP as
its single argument, then regenerate and verify the corpus. The script checks
the archive SHA before opening it. Preserve the archive and complete license
when moving reference artifacts. Generator commands, source hashes, tool version
and every generated input hash are in `corpus/manifest.json`. Decoder results,
comparison frames and libass logs are in `corpus/verification/`. These images
are 640×360 FFmpeg reference composites, not Couch screenshots.

The scripts are opt-in. Existing runners, application source, native helpers,
upload paths and dependency manifests are unchanged. Each generation overwrites
its named output files, so give it a dedicated artifact directory.
Negative controls require a new output directory and mutate only their own
copied sources and media. They refresh manifest hashes before invoking the real
verifier, so rejection must come from a semantic assertion.

## Exact corpus subset

All video backgrounds, captions and the diagnostic marker are authored for this
test. No movie, provider or disc sample is redistributed. All three playable
MKVs contain 14 seconds of silent 640×360 H.264 at 24 fps. There is no audio track.
Generated MKVs stay out of Git; sources and the 44,240-byte subset font are kept.

| Input | Tracks and visible reference |
| --- | --- |
| `text.mkv` | English ASS default=1, forced=0. Cyan three-bar U+E000 marker, outline and synthesized italic at 2–6s. Latin, decomposed accent, Greek, Cyrillic and Arabic joining/marks/lam–alef/digits at 8–12s. |
| `text.mkv` | Italian ASS default=0, forced=1, yellow `ITALIANO FORZATO` at 3–5s. Russian SRT default=0, forced=0, numbered cues at 2–6s and 8–12s. |
| `bitmap.mkv` | English embedded PGS default=0, forced=1. Italian embedded DVD/VobSub default=1, forced=0. Both display authored `IMAGE 1` at 2–6s and `IMAGE 2` at 8–12s, with blank intervals before, between and after. The second image alone also has the codec's forced-event flag. |
| `replacement.mkv` | Blue background without subtitle tracks or attachments, for later source-cleanup and selection-reset checks. |

The PGS writer emits one window and one complete uncropped object per display
set, a transparent/white palette and explicit empty compositions at cue ends.
FFmpeg performs the DVD bitmap conversion and Matroska muxing. VobSub has four
local palette slots and 4-bit alpha; its control timing is quantized to roughly
11.38 ms. The verifier checks the initial display date, ordinary/forced commands,
stop date and container flags. This is embedded `S_VOBSUB`, not an external
`.idx`/`.sub` pair.
[PGS decoder](https://github.com/FFmpeg/FFmpeg/blob/n7.1/libavcodec/pgssubdec.c),
[SUP muxer](https://github.com/FFmpeg/FFmpeg/blob/n7.1/libavformat/supenc.c),
[DVD encoder](https://github.com/FFmpeg/FFmpeg/blob/n7.1/libavcodec/dvdsubenc.c),
[Matroska codec mapping](https://www.matroska.org/technical/codec_specs.html#s_vobsub).

Matroska default and forced flags guide automatic selection in conjunction with
language and user preferences. A forced flag does not establish what Couch's
explicit Off setting does. Each eventual result must name its profile,
language/mode preferences and observed track.
[Track flags](https://www.matroska.org/technical/notes.html#track-flags).

## Font provenance and reference checks

The font derives from the full DejaVu Sans 2.37 release, not its Latin/Greek/
Cyrillic-only distribution. The upstream license permits modification and
redistribution with its notices and naming restrictions. The complete release
license is [preserved beside the font](../../tests/fixtures/subtitles/FONT-LICENSE.txt)
and embedded as a second attachment in `text.mkv`. Internal names are changed
to `Couch Corpus Sans`/`CouchCorpusSans`; copyright and license records remain.
This is the Bitstream/Arev license, not OFL.
[Upstream release](https://github.com/dejavu-fonts/dejavu-fonts/releases/tag/version_2_37),
[release license](https://github.com/dejavu-fonts/dejavu-fonts/blob/version_2_37/LICENSE).

| Bytes | SHA-256 |
| --- | --- |
| Release ZIP, 417,746 | `5c6e497a2f36552cb5ffb112c413a6af39c0f3c47653662b90b4fa6499822fd7` |
| Original TTF, 757,076 | `7da195a74c55bef988d0d48f9508bd5d849425c1770dba5d7bfc6ce9ed848954` |
| Complete license, 8,816 | `7a083b136e64d064794c3419751e5c7dd10d2f64c108fe5ba161eae5e5958a93` |
| Renamed subset TTF, 44,240 | `58dc71b30cd29c1ca2e68f162f3f176e067db87ac3ec6854fdeced2627408f41` |

FontTools keeps layout closure, all layout features and the required GSUB/GPOS/
GDEF tables. It rejects missing requested code points. The selected Arabic
presentation-form mappings and zero-width filler glyphs are retained too.
The authored U+E000 glyph is three ascending bars; its unique family and visible
shape help distinguish attachment use from system fallback. Font matching uses
internal names, and missing glyphs can still fall back independently.
[FontTools subset implementation](https://github.com/fonttools/fonttools/blob/4.61.1/Lib/fontTools/subset/__init__.py),
[Matroska font attachments](https://www.matroska.org/technical/attachments.html#font-files),
[OpenType names](https://learn.microsoft.com/en-us/typography/opentype/spec/name).

The first local pass exposed two fixture defects. Muxing normalized the bitmap
start from 2s to 0s; explicit `-copyts` now preserves the authored clock. GSUB
closure alone retained Arabic outlines but omitted presentation-form cmap
entries and a zero-width filler used by simple shaping. That produced visible
missing-glyph boxes. After retaining those mappings, the mixed-script frame
matches the complete upstream font under both simple and complex libass shaping.
These fixes concern fixture preparation, not a demonstrated Couch defect.
[FFmpeg timestamp and subtitle-duration options](https://ffmpeg.org/ffmpeg.html),
[libass shaping](https://github.com/libass/libass/blob/0.17.1/libass/ass_shaper.c).

The measured local environment is macOS arm64, Python 3.12.14, imageio FFmpeg
7.1 with libass 0.17.1, FriBidi 1.0.13 and HarfBuzz 9.0.0. PyAV 16.1.0 supplies
separate FFmpeg 8-era decoder libraries. The machine-readable
[local result](../../tests/fixtures/subtitles/local-result.json) records exact
input and executable hashes, assertions and reproducibility results. FFmpeg
warns that the `font/ttf` and `text/plain` attachment codec parameters are unknown;
its libass filter nevertheless loads the named font, and extracted bytes match.
This warning is a local tool observation, not an Ubuntu package result.

## Verifier review corrections

The [review of the initial corpus](https://github.com/avoid-quest/couch/issues/33#issuecomment-5555446193)
found three false-pass paths. The original 94-check report remains available at
[its immutable revision](https://github.com/avoid-quest/couch/blob/34d8fedd4aabacfe8a96d55fe3d7e1d150772b4f/tests/fixtures/subtitles/local-result.json).
Before correction, its sources, corpus and raw reports were copied to
`.artifacts/subtitles/baseline-34d8fed/`. The supplied media and font bytes have
not changed. The updated verifier passes 102 checks on them.

| Mutated input, with refreshed manifest | Old verifier | Corrected assertion |
| --- | --- | --- |
| PGS transparent palette entry becomes opaque black | Passed | Full composite comparison detects a 46-level RGB error. Every pixel/channel must remain within the measured two-level conversion tolerance, including background under transparent pixels. |
| First DVD display-control date becomes 44 ticks, about 501 ms | Passed | The start command must have zero display delay; packet PTS alone is insufficient. Stop timing remains checked separately. |
| Attached font loses `u` from the styled cue; Helvetica fallback succeeds | Passed | Both attached-font logs reject any fallback request or unexpected resolved font. |

Simple and complex subset references also reject fallback requests and foreign
font selections. The original reference must select only DejaVu Sans. Separate
negative probes remove Greek lambda from the subset while leaving the original
font and system fallback available. Both shaping modes resolve Helvetica, and
both logs fail the shared font assertion. Removing either the request line or
the foreign selection from the captured log still fails on the remaining signal.
The complete upstream font remains available in the reference directory; its
presence cannot excuse fallback in a subset reference.
[DVD display-control dates](https://github.com/FFmpeg/FFmpeg/blob/n7.1/libavcodec/dvdsubdec.c),
[libass fallback selection](https://github.com/libass/libass/blob/0.17.1/libass/ass_fontselect.c).

`negative-controls.py --verifier path/to/old/verify.py` replays the counterexamples
against a saved verifier and exits nonzero when corrupt inputs pass. The current
[local result](../../tests/fixtures/subtitles/local-result.json) records the red
and green commands, semantic failures, timing/composite measurements and artifact
hashes. These corrections strengthen local evidence; packaged acceptance is
still pending.

## Remaining qualification

| Issue 33 criterion | Current evidence and remaining work |
| --- | --- |
| Corpus, fonts, scripts and flags | Authored sources, licensed derived font, decoded streams/display times, attachment hashes, full bitmap composites and exclusive-font reference comparisons. |
| Selection, Off, timing, seek, source replacement, profile language, portals | Pending in Couch. Reference frames and container flags do not exercise TV/phone selectors or native controls. |
| Packaged Ubuntu player and exact unsupported formats/fonts | Blocked by issue 2 and a coordinated native run. Every corpus sample remains unqualified in the packaged app. |
| Bounded private text uploads, cleanup and restart defaults | Existing checks in `tests/linux/subtitles.ts` are preserved, with no new run claimed. Rerun them alongside this corpus after saved-preference integration. |

The future qualification layer must record app/package/source/binary versions,
the active renderer and actual screenshots. Preserve the native test's hardcoded
1600×1000 capture size and report it separately from the 640×360 input. Observe
the TV selector and portals over video, two controllers, reconnect snapshots,
profile-language defaults, Off, delayed cues, forward/backward seeks, replacement
and stopped restart. Capture HTTP widths 320, 375, 390, 768, 1024, 1440 and 1920,
plus the packaged Ubuntu app and real TV pixels. Keep native dependencies open
until those observations pass.

This subset excludes other font families/code points, CJK/Indic/emoji coverage,
ASS inline `[Fonts]`, animation/karaoke and complex positioning, multiple PGS
objects, cropping, split ODS, palette animation, external bitmap uploads,
external VobSub indexing and disc playback/conformance. No renderer or font
outside these exact samples is qualified by this work. Silent software reference
frames provide no physical audio, GPU or hardware evidence.
