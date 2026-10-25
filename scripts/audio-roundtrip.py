#!/usr/bin/env python3
"""Offline electrical reference-to-return delay from interleaved four-channel S32_LE.

Normalization, FFT correlation and sinc interpolation adapted from Kevin Ahrendt's
Sendspin/sync-test, commit abb99c0bb7c6e4dee95c5b174181db76aa96a31c,
src/sync_test/measure_sync.py (Apache-2.0; see LICENSE.sync-test).
Changes: explicit rate/lag limits, offline input, confidence guards and fail gates.
This reports a sampled, uncalibrated electrical diagnostic, not physical qualification.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys

import numpy as np
import scipy
from scipy import signal

UPSTREAM_COMMIT = "abb99c0bb7c6e4dee95c5b174181db76aa96a31c"
UPSTREAM_SOURCE = f"https://github.com/Sendspin/sync-test/blob/{UPSTREAM_COMMIT}/src/sync_test/measure_sync.py"


def sinc_offset(correlation, peak, factor=100, radius=50):
    """Upstream's FFT sinc peak refinement, in original sample coordinates."""
    start = max(0, peak - radius)
    window = correlation[start:min(len(correlation), peak + radius + 1)]
    n = len(window)
    if n < 3:
        return 0.0
    spectrum = np.fft.fft(window)
    padded = np.zeros(n * factor, dtype=complex)
    padded[:(n + 1) // 2] = spectrum[:(n + 1) // 2]
    padded[-(n // 2):] = spectrum[-(n // 2):]
    refined = np.argmax(np.fft.ifft(padded).real)
    return float(refined / factor - (peak - start))


def measure(reference, returned, sample_rate=48000, min_lag_ms=0, max_lag_ms=250,
            min_correlation=0.5, min_separation_db=6):
    """Find delay; inspect both signs and longer delays before accepting a peak."""
    result = {"accepted": False, "reason": None, "lag_ms": None,
              "correlation": None, "separation_db": None}
    if len(reference) != len(returned) or len(reference) < 3:
        raise ValueError("equal nonempty windows required")
    channels = [np.asarray(x, dtype=np.float64) for x in (reference, returned)]
    if not all(np.all(np.isfinite(x)) for x in channels):
        result["reason"] = "nonfinite"
        return result
    if any(np.max(np.abs(x)) >= 0.999999 for x in channels):
        result["reason"] = "clipping"
        return result
    channels = [x - np.mean(x) for x in channels]
    scales = [np.std(x) for x in channels]
    if min(scales) < 1e-7:
        result["reason"] = "silence"
        return result
    reference, returned = [x / scale for x, scale in zip(channels, scales)]
    n = len(reference)
    # Swapping upstream's correlate arguments gives positive reference->return delay.
    corr = signal.correlate(returned, reference, mode="full", method="fft") / n
    # At least half a window overlaps. Looking outside the acceptance range catches
    # reversed paths and stronger out-of-range peaks instead of reporting a sidelobe.
    guard = n // 2
    center = n - 1
    correlation = corr[center - guard:center + guard + 1]
    peak = int(np.argmax(correlation))
    strength = float(correlation[peak])
    lag_samples = peak - guard
    result["correlation"] = strength
    if strength < min_correlation:
        result["reason"] = "low_correlation"
        return result
    lag_ms = lag_samples * 1000 / sample_rate
    result["lag_ms"] = lag_ms
    # Ignore the same correlation lobe within 1 ms, then compare competing peaks.
    competitors = correlation.copy()
    radius = max(1, round(sample_rate / 1000))
    competitors[max(0, peak - radius):peak + radius + 1] = -np.inf
    second = max(0.0, float(np.max(competitors)))
    separation = 20 * math.log10(strength / max(second, 1e-15))
    result["separation_db"] = separation
    if separation < min_separation_db:
        result["reason"] = "ambiguous"
        return result
    refined = lag_samples + sinc_offset(correlation, peak)
    lag_ms = refined * 1000 / sample_rate
    result["lag_ms"] = lag_ms
    if not min_lag_ms <= lag_ms <= max_lag_ms:
        result["reason"] = "out_of_range"
        return result
    margin = 1000 / sample_rate
    if lag_ms <= min_lag_ms + margin or lag_ms >= max_lag_ms - margin:
        result["reason"] = "boundary"
        return result
    result.update(accepted=True, reason="accepted")
    return result


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def analyze(path, *, sample_rate=48000, pairs=((1, 3), (2, 4)), start=0,
            duration, window=1, step=0.5, min_lag_ms=0, max_lag_ms=250,
            threshold_ms=100, min_coverage=0.95, min_correlation=0.5,
            min_separation_db=6):
    path = Path(path).resolve()
    if sample_rate <= 0 or start < 0 or duration <= 0 or window <= 0 or step <= 0:
        raise ValueError("rate/duration/window/step must be positive; start must be nonnegative")
    if step > window:
        raise ValueError("step must not exceed window (uninspected gaps)")
    if not all(math.isfinite(x) for x in (start, duration, window, step, min_lag_ms,
                                         max_lag_ms, threshold_ms, min_coverage,
                                         min_correlation, min_separation_db)):
        raise ValueError("configuration must be finite")
    if not 0 <= min_lag_ms < max_lag_ms < window * 500:
        raise ValueError("require 0 <= min lag < max lag < half the window in ms")
    if not min_lag_ms <= threshold_ms <= max_lag_ms:
        raise ValueError("threshold must lie within lag range")
    if not 0 < min_coverage <= 1 or not 0 < min_correlation <= 1 or min_separation_db <= 0:
        raise ValueError("invalid confidence or coverage threshold")
    if not pairs or any(a == b or not 1 <= a <= 4 or not 1 <= b <= 4 for a, b in pairs):
        raise ValueError("pairs must name distinct channels in 1..4")
    size = path.stat().st_size
    if not size or size % 16:
        raise ValueError("input must contain complete four-channel S32_LE frames")
    frames = size // 16
    first, count = round(start * sample_rate), round(duration * sample_rate)
    width, stride = round(window * sample_rate), round(step * sample_rate)
    if width < 3 or stride < 1 or count < width or first + count > frames:
        raise ValueError("requested interval must fit input and contain a full window")
    starts = list(range(first, first + count - width + 1, stride))
    if starts[-1] + width < first + count:
        starts.append(first + count - width)
    raw = np.memmap(path, dtype="<i4", mode="r", shape=(frames, 4))
    windows = []
    for begin in starts:
        block = raw[begin:begin + width].astype(np.float64) / 2147483648
        for a, b in pairs:
            result = measure(block[:, a - 1], block[:, b - 1], sample_rate,
                             min_lag_ms, max_lag_ms, min_correlation, min_separation_db)
            windows.append({"pair": f"{a}:{b}", "start_frame": begin,
                            "end_frame": begin + width, **result})
    summaries = []
    for a, b in pairs:
        rows = [x for x in windows if x["pair"] == f"{a}:{b}"]
        lags = [x["lag_ms"] for x in rows if x["accepted"]]
        coverage = len(lags) / len(rows)
        invalid_lags = sum(x["reason"] in ("out_of_range", "boundary") for x in rows)
        reasons = {reason: sum(x["reason"] == reason for x in rows)
                   for reason in sorted({x["reason"] for x in rows})}
        summaries.append({"pair": f"{a}:{b}", "expected_windows": len(rows),
                          "accepted_windows": len(lags), "coverage": coverage,
                          "invalid_lag_windows": invalid_lags,
                          "reasons": reasons,
                          "median_ms": float(np.median(lags)) if lags else None,
                          "p95_ms": float(np.percentile(lags, 95)) if lags else None,
                          "max_ms": max(lags) if lags else None,
                          "pass": bool(lags and not invalid_lags and coverage >= min_coverage
                                       and max(lags) <= threshold_ms)})
    return {"schema": "couch-offline-roundtrip/2", "diagnostic_pass": all(x["pass"] for x in summaries),
            "physical_qualification": False, "calibration": "uncalibrated",
            "inspection": {"start_frame": starts[0], "end_frame": starts[-1] + width,
                           "covered_frames": count, "uninspected_frames": 0},
            "source": {"path": str(path), "sha256": sha256(path), "bytes": size,
                       "frames": frames, "duration_seconds": frames / sample_rate,
                       "format": "S32_LE", "channels": 4},
            "detector": {"upstream_commit": UPSTREAM_COMMIT, "upstream_source": UPSTREAM_SOURCE,
                         "script_sha256": sha256(Path(__file__)),
                         "numpy": np.__version__, "scipy": scipy.__version__,
                         "interpolation_factor": 100, "competing_peak_exclusion_ms": 1,
                         "guard_lag_ms": [-width * 500 / sample_rate, width * 500 / sample_rate]},
            "config": {"sample_rate": sample_rate, "pairs": [f"{a}:{b}" for a, b in pairs],
                       "start_seconds": start, "duration_seconds": duration,
                       "first_frame": first, "interval_frames": count,
                       "window_frames": width, "step_frames": stride,
                       "min_lag_ms": min_lag_ms, "max_lag_ms": max_lag_ms,
                       "threshold_ms": threshold_ms, "min_coverage": min_coverage,
                       "min_correlation": min_correlation, "min_separation_db": min_separation_db},
            "pairs": summaries, "windows": windows}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--output", type=Path, required=True, help="new JSON file; never overwrite")
    parser.add_argument("--sample-rate", type=int, default=48000)
    parser.add_argument("--pairs", default="1:3,2:4")
    parser.add_argument("--start", type=float, default=0)
    parser.add_argument("--duration", type=float, required=True)
    parser.add_argument("--window", type=float, default=1)
    parser.add_argument("--step", type=float, default=0.5)
    parser.add_argument("--min-lag-ms", type=float, default=0)
    parser.add_argument("--max-lag-ms", type=float, default=250)
    parser.add_argument("--threshold-ms", type=float, default=100)
    parser.add_argument("--min-coverage", type=float, default=0.95)
    parser.add_argument("--min-correlation", type=float, default=0.5)
    parser.add_argument("--min-separation-db", type=float, default=6)
    args = parser.parse_args()
    try:
        if args.output.exists():
            raise ValueError("output already exists; choose a new evidence path")
        pairs = tuple(tuple(map(int, pair.split(":"))) for pair in args.pairs.split(","))
        if any(len(pair) != 2 for pair in pairs) or len(set(pairs)) != len(pairs):
            raise ValueError("pairs must be unique reference:return entries")
        config = vars(args).copy()
        del config["input"], config["output"], config["pairs"]
        report = analyze(args.input, pairs=pairs, **config)
        with args.output.open("x") as stream:
            json.dump(report, stream, indent=2, allow_nan=False)
            stream.write("\n")
    except (ValueError, OSError) as error:
        parser.error(str(error))
    print(json.dumps({"diagnostic_pass": report["diagnostic_pass"], "pairs": report["pairs"]}))
    return 0 if report["diagnostic_pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
