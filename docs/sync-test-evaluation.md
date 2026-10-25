# Sendspin sync-test evaluation

Evaluated 25 October 2026 at **`abb99c0bb7c6e4dee95c5b174181db76aa96a31c`** (cloned into `/tmp/couch-sync-test-research/sync-test`; upstream tracked files unchanged).

**Recommendation:** reuse its small numerical detector offline, with explicit sample rate, wider lag search and rejection gates. Stock sync-test is useful for relative output synchronization; it cannot directly qualify Couch's ≤100 ms full live-input-to-Mac-analog-output goal. The implemented [offline adapter](../scripts/audio-roundtrip.py) reads retained four-channel recordings without PortAudio, hardware access or product changes. Its independent diagnostic reproduces the existing **~101.34 ms red baseline**. A new detector does not lower product latency or erase the earlier qualification failure.

## What upstream actually measures

The README describes two devices playing the same content, with one analog output from each fed into a common stereo USB capture. The detector measures their **relative waveform lag**. Shared end-to-end latency cancels: two outputs can be perfectly aligned while both are late. Analyzer “absolute offset” is `abs(relative_offset)`, not independently measured absolute roundtrip latency. With one channel instead wired to the actual electrical input reference and the other to the corresponding headphone return, correlation can measure that route's electrical delay, subject to capture-path bias/calibration. That wiring and a wider search are required adaptations.[1][2][3]

Production defaults are 96 kHz capture, a **750 ms window**, processing roughly every 500 ms, **±5 ms** lag search, correlation ≥0.5, and 100× FFT sinc peak interpolation. The README/docstring's 500 ms capture-window description is stale. Nominal sample spacing is 10.42 µs; interpolation grid spacing of ~0.104 µs does **not** establish calibrated accuracy. Analyzer statistics round offsets to whole microseconds.[2][3]

The generator actually creates a 48 kHz mono, one-hour FLAC: 50 ms linear **100 Hz→18 kHz** chirps, 5 ms fades, repeated every 500 ms. Its docstring incorrectly says 10 kHz. Generation writes `sync_test_chirps.flac`; the repository also includes `sync_test_chirps_18khz.flac`. It does not play the file, publish into Couch, control a browser, record raw audio, calibrate hardware or measure packet deadlines.[4][5]

## Hardware, platform and calibration

- Stock capture opens exactly **two channels at 96 kHz** with a numeric device ID. There is no channel/rate selector, calibration option or offline raw-file input. Existing ADC1/2 source plus ADC3/4 return routing therefore needs a remap or an adapter; pointing stock capture at the first two UMC inputs would compare source left/right instead of input/output.[2]
- For Couch stereo, keep a **single coherent four-channel ADC recording**: ADC1 reference L→ADC3 Mac headphone L, ADC2 reference R→ADC4 headphone R. Split/witness the physical signal entering Couch, then return the Mac's real analog output. Use appropriate line levels, independent channel content, and a route with no direct-monitor/loopback signal masquerading as the browser return. The existing Linux UMC capture and separate wired Mac headphone route already provide this topology; the latest report records the exact audio-stack substitutions.[6]
- A common ADC clock removes capture-start timestamp uncertainty between channels. It does not establish ADC channel skew/filter phase, source/return path bias, absolute sample-rate accuracy, SNR or isolation. Establish current same-signal channel calibration and channel-swap controls, and report an uncertainty budget before claiming a calibrated ≤100 ms bound. Keep the configured **100 ms sender lead** separate; subtracting it from analog lag would discard actual route latency.[6]
- Python **≥3.11**, NumPy, SciPy, sounddevice, soundfile and matplotlib are declared dependencies. Upstream states no explicit tested-OS matrix. Its sounddevice/PortAudio dependency supports macOS, Windows and Linux; official installation docs say pip wheels bundle PortAudio on macOS/Windows, while Linux may need `libportaudio2`. Actual UMC device/rate availability, macOS recording permission and simultaneous capture access still need a host preflight; no Mac or hardware validation occurred in this research.[5][7]
- This host had Python 3.13.5 but no `uv`, no usable `ensurepip`, and no PortAudio. A standalone uv downloaded into the assigned scratch directory completed `uv sync --frozen`. The unmodified `python -m sync_test.test_measurement` command failed at import with **`OSError: PortAudio library not found`**. The maintained adapter uses only NumPy/SciPy and requires none of these audio-library workarounds.

## Failure and false-positive traps

1. **Wrong range or ambiguous content:** ±5 ms cannot locate ~101 ms. A periodic waveform may align at the wrong whole period; duplicated routing can look perfectly synchronized. Upstream has no peak-boundary or competing-peak rejection. Tonal/narrow-band content can also have many plausible peaks.[2][4]
2. **Missing signal can disappear from headline statistics:** below-0.5 correlations are retained in CSV but filtered from analysis. There is no minimum coverage, count, duration or ≤100 ms acceptance gate. One surviving valid row permits a summary. “Drift stability” is standard deviation of non-snap deltas, excluding jumps >8 µs; a constant drift can have zero delta variance. Neither that label nor “excellent” proves an affine clock model or continuous fidelity.[2][3]
3. **Duration trap:** the low-correlation branch continues before checking `--duration`, so silent/uncorrelated capture can run indefinitely. Stop an owned run by PID; do not rely on the duration option as a hard deadline. The CSV is opened/truncated before checking device selection. Use a new output path.[2]
4. **Weak automation contract:** upstream synthetic tests print failure markers/return a Boolean that the script ignores; exit 0 is not a sufficient test verdict. The analyzer reports statistics rather than threshold qualification. `--plot` writes beside its CSV; `--last-seconds` can conceal earlier failures and should not replace a prospectively fixed interval.[3][8]

The first-party GitHub issues endpoint returned an empty list on the evaluation date; there was no issue evidence supplying additional guarantees.[9]

## Minimal offline integration implemented

[The adapter](../scripts/audio-roundtrip.py) explicitly adapts upstream mean/std normalization, SciPy FFT correlation and its FFT sinc peak helper at the pinned commit. It computes at the supplied **48 kHz directly**; there is no need to upsample the retained recording. Upstream has **no sample-rate/resampling helper**. An alternative that preserves its 96 kHz arithmetic is identical `scipy.signal.resample_poly(pair, 2, 1, axis=0)` on both channels, followed by adjusted search limits; resampling adds no new measured timing information. Direct parameterization is smaller.[2][10]

The adapter reads interleaved four-channel **S32_LE** using a read-only memmap, normalizes integer samples, and analyzes default pairs `1:3,2:4`. CLI duration is mandatory; start/duration are validated against the raw frame count. Default windows are 1 s every 0.5 s. A nonaligned interval adds a final full window ending exactly at the requested frame boundary; `step > window` is rejected to prevent interior gaps. JSON records actual inspected bounds and covered/uninspected frame counts. Positive lag means the return follows the reference. Acceptance is **0..250 ms**, with a one-sample margin at either boundary. The detector inspects both signs out to half a window (±500 ms by default), rejecting a confidently established stronger reversed/out-of-range peak instead of choosing an in-range sidelobe. Ambiguity is checked before range classification.

Each window, including each rejection, retains frame coordinates, lag when available, correlation, competing-peak separation and reason. Default confidence is correlation ≥0.5 and separation ≥6 dB from competing peaks outside a ±1 ms same-lobe exclusion. Silence, clipping, nonfinite samples, ambiguity and search boundaries reject. Each pair's diagnostic passes only with **≥95% accepted windows, every accepted lag ≤100 ms, and zero confidently established range/boundary violations**. Such violations are counted as `invalid_lag_windows` and hard-fail independently of the unknown-window allowance. JSON also records source path/hash/size/format/duration, configuration, upstream pin/source URL, adapter hash and dependency versions. Existing output files are refused. Exit codes: **0 diagnostic pass, 1 diagnostic failure, 2 invalid input/configuration**. Reports use schema `couch-offline-roundtrip/2`, always with `physical_qualification: false` and `calibration: uncalibrated`.

The correlation routine has no chirp-template dependency: it can compare **old arbitrary pilots or ordinary common audio** when both observed signals have sufficient shared waveform structure. It does not prove that *any* stimulus is suitable. Pure tones, repeated identical pilots, codec changes, insufficient overlap, crosstalk and unequal filtering can cause ambiguous or biased peaks. The one-second analysis is a separate detector from the old 10 ms pilot method. Window acceptance/coverage is not independent pilot identity, calibrated SNR/isolation, sample-perfect delivery, continuous dropout detection, clock-drift qualification or per-packet deadline evidence. For fresh tests, prefer independent broadband left/right content with unique/nonperiodic structure; keep startup, quiet/isolation and tail phases rather than silently trimming them. Physical route/disconnection controls remain necessary even when digital negative controls pass.

The [15 deterministic tests](../tests/audio-roundtrip.test.py) exercise 90 ms success, 101 ms threshold failure, reversed and 300 ms out-of-range paths, unrelated signals, silence, duplicated/zero-delay routing, boundary lag, tonal ambiguity, clipping/nonfinite samples, missing coverage, raw-format/duration errors, metadata/input preservation and CLI failure/no-overwrite behavior. They include mixed 20×90 ms + one 300/−90 ms aggregate failures despite 95.238% accepted coverage, ambiguous reversed peaks, nonaligned interval tails, rejected gapped schedules, and FFT-generated broadband delays at 4,799.5/4,800.5 samples (99.989583/100.010417 ms) on opposite sides of the threshold. All passed. Attribution and modification notice are in the adapter; the complete upstream Apache-2.0 license is retained in [LICENSE.sync-test](../scripts/LICENSE.sync-test). The upstream tree contains no NOTICE file.[5][11]

## Read-only cf267-s1 comparison

The existing [validation record](audio-video-refactor-validation.md#latest-cf267-s1-diagnostic-sustained-recording-complete) reports 610 sample seconds, with steady **[30,590)** fixed before acquisition. Its pilot-based results are median **101.339039/101.337865 ms**, p95 **101.475196/101.477313 ms**, 98.8393%/99.3750% pilot coverage and failed ≤1-sample affine residuals (**29.870465/29.780547 samples**). The original outcome stays failed/unqualified; calibrated uncertainty, continuous fidelity and packet deadlines remain unknown.[6]

The new offline diagnostic used that same fixed steady interval, without editing the recording or old reports:

- Raw: `/home/avoid/.t3/worktrees/couch/t3-9bc48314/.scratch/playback-refactor/physical-mac/cf267-s1/runs/sustained/capture.s32le`; **468,480,000 bytes**, SHA-256 **`872b8bd9648e77b329ae2fff0459ee919c29e41823885fc81e6d23ec17f8aef5`**, matching the original record.
- Both intended pairs accepted **1,096/1,119 windows (97.9446%)**, with 23 low-correlation rejections each. Median L/R **101.3396875/101.3391667 ms**; p95 **101.4740625/101.4744792 ms**; maximum **101.591875/101.5925 ms**. Both fail ≤100 ms; process exit **1**.
- Reversed `3:1,4:2`: **zero accepted** of 1,119 each; 1,096 out-of-range and 23 low-correlation rejections. Cross pairs `1:4,2:3`: **zero accepted**, all low-correlation. This supports correspondence for this recording, without furnishing calibrated channel isolation or arbitrary-stimulus guarantees.
- New reports only: `/tmp/couch-sync-test-research/cf267-s1-offline-v1.json` (SHA-256 `ade0b469b1b6c342343ddb928cc3158b63bff66ae3338584ab976155df449c52`) and `cf267-s1-negative-v1.json` (`a9d228dfdf86c8f63250b6bf388b512d74f768f9a2a5295fcac2e7373cd6abfa`). Test receipt: `adapter-tests.log` in the same scratch directory. These are local artifacts, not committed prior physical evidence.

This agreement is evidence that the adapted detector can recover the old waveform's electrical lag. It is **not stock sync-test validation at 101 ms**, nor a second physical acquisition, nor a replacement pass for the affine gate.

## Fresh baseline-01 analysis

After the hardware owner reported the new 60-second witness/generator complete (both exit 0) and root opened the software window, the unchanged adapter analyzed `.scratch/audio-roundtrip-sync/runs/baseline-01/capture.s32le`, fixed **[20,48)**. Both intended pairs accepted **54/55 windows (98.1818%)**, with one low-correlation rejection each. Median L/R was **100.1150000/100.1151042 ms**, p95 **100.5759583/100.5761667 ms**, maximum **100.5970833 ms** on both channels. Coverage passes; the ≤100 ms gate fails, with exit **1**. Reversed pairs accept zero (54 out-of-range and one low-correlation each); cross pairs accept zero (all 55 low-correlation each).

Immutable new outputs in that run directory: `roundtrip-v1.json` (SHA-256 `fcd7f88a6ecdc095577f1376ad70e8dba830d59ccdb3bbc25c54e242ac50bc54`) and `roundtrip-negative-v1.json` (`b1bc0d062b47265db28e7aafb8c4d6e1365c5835295bb153429eb5f0a8fa3d28`). This is an offline electrical diagnostic of the newly supplied recording, with the same uncalibrated/continuous-fidelity limitations; hardware-route, lifecycle and acquisition qualification belong to the hardware owner's separate receipts.

Independent review R1 reproduced two detector defects: a confident invalid lag could hide within the coverage allowance, and nonaligned tails or a step larger than the window could leave samples uninspected. Both failures were reproduced by regressions before their fixes; targeted regressions then passed, followed by all 15 tests. Red/green receipts are `/tmp/couch-sync-test-research/review-r1-p1-{red,green}.log`, `review-r1-p2-{red,green}.log` and `review-r1-all-green.log`.

After those corrections, the unchanged raw was analyzed **once** again over the same [20,48) interval, with one corresponding negative-control run. `roundtrip-v2.json` (SHA-256 `eea9e6ff513a6d68fbdc14bf20b95b12f3c05b05ecb62c7eed6b3749b9387726`) retains exactly the same accepted counts and lag statistics: both intended pairs still **fail** ≤100 ms. Inspection covers raw frames **[960000,2304000)**, all **1,344,000 frames**, with no uninspected frames. `roundtrip-negative-v2.json` (`4ef5425e9257cacc7ac565c0389793b2b22f02886e98899f9a817d3f9f69c1a8`) again accepts zero windows in every control pair; each reversed pair explicitly counts 54 confidently invalid lags. Both v2 commands exit 1. The v1 files/hashes and original red baseline are preserved. The corrected adapter is frozen at SHA-256 `9c6fb9f9b01656850b8961b04813f33b6856d5f397398df9627434f68b53668d`.

## Exact setup and commands

Upstream inspection/install, with `uv` already available (official installation: [uv docs](https://docs.astral.sh/uv/getting-started/installation/)):

```bash
git clone https://github.com/Sendspin/sync-test.git /tmp/sync-test-pinned
cd /tmp/sync-test-pinned
git checkout --detach abb99c0bb7c6e4dee95c5b174181db76aa96a31c
uv sync --frozen
uv run --frozen python -m sync_test.test_measurement
uv run --frozen sync-generate-chirp
uv run --frozen sync-measure --list
# Set CAPTURE_DEVICE_ID to the chosen numeric ID; requires separately arranged playback/wiring.
uv run --frozen sync-measure --device "$CAPTURE_DEVICE_ID" --duration 60 --output new-sync.csv
uv run --frozen sync-analyze new-sync.csv --plot
```

These are stock commands, **not** the recommended absolute-delay test, and no capture/playback command above was executed in this research. The duration and output caveats above apply. For a live-Couch test, the generator signal must enter actual physical Live capture→Couch→Sendspin browser→analog return; loading the FLAC as a shared URL bypasses live capture and tests a different path.[1][2][4]

Minimal offline dependency setup, from the Couch checkout (no system install, Couch build or sounddevice needed):

```bash
uv venv --python 3.13 /tmp/couch-roundtrip-venv
uv pip install --python /tmp/couch-roundtrip-venv/bin/python numpy==2.3.5 scipy==1.16.3
PYTHONDONTWRITEBYTECODE=1 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 \
  /tmp/couch-roundtrip-venv/bin/python tests/audio-roundtrip.test.py
PYTHONDONTWRITEBYTECODE=1 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 \
  /tmp/couch-roundtrip-venv/bin/python scripts/audio-roundtrip.py \
  /home/avoid/.t3/worktrees/couch/t3-9bc48314/.scratch/playback-refactor/physical-mac/cf267-s1/runs/sustained/capture.s32le \
  --sample-rate 48000 --pairs 1:3,2:4 --start 30 --duration 560 \
  --min-lag-ms 0 --max-lag-ms 250 --threshold-ms 100 --min-coverage 0.95 \
  --output /tmp/cf267-s1-new-roundtrip.json
```

The final command intentionally returns **1** for the retained baseline. Our executed commands used the identically pinned NumPy/SciPy in `/tmp/couch-sync-test-research/sync-test/.venv/bin/python`; the standalone uv binary/cache and every analysis result stayed under the assigned scratch directory. Controls and old-raw analysis finished before fresh acquisition was authorized; do not run analysis/tests/builds during an acquisition quiet window.

Remaining dependencies for a new **physical qualification** are a separately coordinated four-channel recording, verified actual product input/output routing and independent analog controls, current calibration/uncertainty, agreed startup/recovery and continuity criteria, and an actual product change if the measured path remains over 100 ms. The adapter supplies measurement diagnostics; it supplies no capture driver, product latency fix or hardware qualification.

## Primary sources

[1]: https://github.com/Sendspin/sync-test/blob/abb99c0bb7c6e4dee95c5b174181db76aa96a31c/README.md
[2]: https://github.com/Sendspin/sync-test/blob/abb99c0bb7c6e4dee95c5b174181db76aa96a31c/src/sync_test/measure_sync.py#L31-L49
[3]: https://github.com/Sendspin/sync-test/blob/abb99c0bb7c6e4dee95c5b174181db76aa96a31c/src/sync_test/analyze.py#L56-L138
[4]: https://github.com/Sendspin/sync-test/blob/abb99c0bb7c6e4dee95c5b174181db76aa96a31c/src/sync_test/generate_chirp.py
[5]: https://github.com/Sendspin/sync-test/blob/abb99c0bb7c6e4dee95c5b174181db76aa96a31c/pyproject.toml
[6]: audio-video-refactor-validation.md#latest-cf267-s1-diagnostic-sustained-recording-complete
[7]: https://python-sounddevice.readthedocs.io/en/latest/installation.html
[8]: https://github.com/Sendspin/sync-test/blob/abb99c0bb7c6e4dee95c5b174181db76aa96a31c/src/sync_test/test_measurement.py#L58-L190
[9]: https://api.github.com/repos/Sendspin/sync-test/issues?state=all&per_page=100
[10]: https://docs.scipy.org/doc/scipy/reference/generated/scipy.signal.resample_poly.html
[11]: https://github.com/Sendspin/sync-test/blob/abb99c0bb7c6e4dee95c5b174181db76aa96a31c/LICENSE
