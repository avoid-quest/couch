"""Run with: python tests/audio-roundtrip.test.py (NumPy + SciPy required)."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import numpy as np

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/audio-roundtrip.py"
spec = importlib.util.spec_from_file_location("audio_roundtrip", SCRIPT)
audio = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audio)


class RoundtripTests(unittest.TestCase):
    rate = 48000

    def signals(self, delay_ms, seconds=1):
        rng = np.random.default_rng(417)
        reference = rng.normal(0, 0.03, round(seconds * self.rate))
        delay = round(abs(delay_ms) * self.rate / 1000)
        returned = np.zeros_like(reference)
        if delay_ms >= 0:
            returned[delay:] = reference[:len(reference) - delay]
        else:
            returned[:len(reference) - delay] = reference[delay:]
        return reference, returned

    def test_known_delays_and_sign(self):
        for delay in (90, 101):
            with self.subTest(delay=delay):
                result = audio.measure(*self.signals(delay))
                self.assertTrue(result["accepted"], result)
                self.assertAlmostEqual(result["lag_ms"], delay, delta=0.03)

    def test_reversed_and_out_of_range_do_not_report_sidelobes(self):
        for delay in (-90, 300):
            with self.subTest(delay=delay):
                result = audio.measure(*self.signals(delay))
                self.assertFalse(result["accepted"])
                self.assertEqual(result["reason"], "out_of_range")

    def test_silence_and_unrelated(self):
        a, _ = self.signals(90)
        b = np.random.default_rng(908).normal(0, 0.03, len(a))
        self.assertEqual(audio.measure(a, b)["reason"], "low_correlation")
        self.assertEqual(audio.measure(a, a * 0)["reason"], "silence")
        self.assertEqual(audio.measure(a * 0, a * 0)["reason"], "silence")

    def test_boundaries_and_duplicate_routing(self):
        for delay in (0, 250):
            with self.subTest(delay=delay):
                self.assertEqual(audio.measure(*self.signals(delay))["reason"], "boundary")

    def test_periodic_tone_is_ambiguous(self):
        t = np.arange(self.rate) / self.rate
        reference = 0.03 * np.sin(2 * np.pi * 1000 * t)
        self.assertEqual(audio.measure(reference, np.roll(reference, 4320))["reason"], "ambiguous")

    def test_clipping_and_nonfinite(self):
        a, b = self.signals(90)
        b[0] = 1
        self.assertEqual(audio.measure(a, b)["reason"], "clipping")
        b[0] = np.nan
        self.assertEqual(audio.measure(a, b)["reason"], "nonfinite")

    def fixture(self, directory, delay_ms):
        a, c = self.signals(delay_ms, seconds=3)
        rng = np.random.default_rng(51)
        b = rng.normal(0, 0.03, len(a))
        delay = round(delay_ms * self.rate / 1000)
        d = np.concatenate([np.zeros(delay), b[:-delay]])
        path = Path(directory) / "capture.s32le"
        (np.column_stack([a, b, c, d]) * 2147483648).astype("<i4").tofile(path)
        return path

    def test_full_report_pass90_fail101_and_preserve_input(self):
        for delay, passed in ((90, True), (101, False)):
            with self.subTest(delay=delay), tempfile.TemporaryDirectory() as directory:
                path = self.fixture(directory, delay)
                before = hashlib.sha256(path.read_bytes()).hexdigest()
                report = audio.analyze(path, duration=3)
                self.assertEqual(report["diagnostic_pass"], passed)
                self.assertFalse(report["physical_qualification"])
                self.assertEqual(report["source"]["sha256"], before)
                self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), before)
                self.assertEqual(len(report["windows"]), 10)
                self.assertEqual([x["pair"] for x in report["pairs"]], ["1:3", "2:4"])
                self.assertTrue(all(x["coverage"] == 1 for x in report["pairs"]))
                self.assertEqual(report["detector"]["upstream_commit"], audio.UPSTREAM_COMMIT)

    def test_unknown_windows_remain_and_fail_coverage(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self.fixture(directory, 90)
            raw = np.fromfile(path, dtype="<i4").reshape(-1, 4)
            raw[self.rate:, 2:] = 0
            raw.tofile(path)
            report = audio.analyze(path, duration=3)
            self.assertFalse(report["diagnostic_pass"])
            self.assertEqual(len(report["windows"]), 10)
            self.assertTrue(any(x["reason"] == "silence" for x in report["windows"]))
            self.assertTrue(all(x["coverage"] < 0.95 for x in report["pairs"]))

    def test_confident_invalid_lag_fails_despite_sufficient_coverage(self):
        for invalid_lag in (300, -90):
            with self.subTest(invalid_lag=invalid_lag), tempfile.TemporaryDirectory() as directory:
                rng = np.random.default_rng(971)
                blocks = []
                for lag in [90] * 20 + [invalid_lag]:
                    reference = rng.normal(0, 0.03, (self.rate, 2))
                    returned = np.zeros_like(reference)
                    delay = round(abs(lag) * self.rate / 1000)
                    if lag > 0:
                        returned[delay:] = reference[:-delay]
                    else:
                        returned[:-delay] = reference[delay:]
                    blocks.append(np.column_stack([reference, returned]))
                path = Path(directory) / "mixed.s32le"
                (np.concatenate(blocks) * 2147483648).astype("<i4").tofile(path)
                report = audio.analyze(path, duration=21, step=1)
                self.assertTrue(all(x["coverage"] >= 0.95 for x in report["pairs"]))
                self.assertFalse(report["diagnostic_pass"])
                self.assertTrue(all(x["invalid_lag_windows"] == 1 for x in report["pairs"]))

    def test_non_aligned_tail_is_inspected_and_bounds_are_reported(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self.fixture(directory, 90)
            raw = np.fromfile(path, dtype="<i4").reshape(-1, 4)
            raw[self.rate:] = 0
            raw.tofile(path)
            report = audio.analyze(path, duration=1.49)
            self.assertEqual(max(x["end_frame"] for x in report["windows"]), 71520)
            self.assertEqual(len(report["windows"]), 4)
            self.assertEqual(report["inspection"], {"start_frame": 0, "end_frame": 71520,
                                                   "covered_frames": 71520, "uninspected_frames": 0})

    def test_gapped_schedule_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self.fixture(directory, 90)
            with self.assertRaisesRegex(ValueError, "step.*window"):
                audio.analyze(path, duration=3, step=1.5)

    def test_ambiguous_reversed_peak_is_not_a_confident_invalid_lag(self):
        a, delayed = self.signals(90)
        _, advanced = self.signals(-90)
        result = audio.measure(a, advanced + 0.85 * delayed)
        self.assertFalse(result["accepted"])
        self.assertEqual(result["reason"], "ambiguous")
        self.assertLess(result["lag_ms"], 0)

    def test_fractional_delays_on_both_sides_of_threshold(self):
        for delay, passed in ((4799.5, True), (4800.5, False)):
            with self.subTest(delay_samples=delay), tempfile.TemporaryDirectory() as directory:
                rng = np.random.default_rng(840)
                spectrum = np.fft.rfft(rng.normal(0, 0.03, (self.rate * 3, 2)), axis=0)
                frequency = np.fft.rfftfreq(self.rate * 3)
                spectrum[frequency > 16000 / self.rate] = 0
                reference = np.fft.irfft(spectrum, n=self.rate * 3, axis=0)
                returned = np.fft.irfft(spectrum * np.exp(-2j * np.pi * frequency[:, None] * delay),
                                        n=self.rate * 3, axis=0)
                path = Path(directory) / "fractional.s32le"
                (np.column_stack([reference, returned]) * 2147483648).astype("<i4").tofile(path)
                report = audio.analyze(path, duration=3)
                self.assertEqual(report["diagnostic_pass"], passed)
                for pair in report["pairs"]:
                    self.assertEqual(pair["coverage"], 1)
                    self.assertAlmostEqual(pair["max_ms"], delay * 1000 / self.rate, delta=0.001)

    def test_bad_format_duration_and_configuration(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self.fixture(directory, 90)
            for config in ({"duration": 4}, {"duration": 0.5},
                           {"duration": 3, "max_lag_ms": 500},
                           {"duration": 3, "pairs": ((1, 1),)},
                           {"duration": 3, "min_coverage": 0}):
                with self.subTest(config=config), self.assertRaises(ValueError):
                    audio.analyze(path, **config)
            with path.open("ab") as stream:
                stream.write(b"!")
            with self.assertRaises(ValueError):
                audio.analyze(path, duration=3)

    def test_cli_exit_codes_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self.fixture(directory, 101)
            output = Path(directory) / "result.json"
            argv = [sys.executable, str(SCRIPT), str(path), "--duration", "3", "--output", str(output)]
            result = subprocess.run(argv, capture_output=True, text=True)
            self.assertEqual(result.returncode, 1, result.stderr)
            self.assertFalse(json.loads(output.read_text())["diagnostic_pass"])
            before = output.read_bytes()
            result = subprocess.run(argv, capture_output=True, text=True)
            self.assertEqual(result.returncode, 2)
            self.assertEqual(output.read_bytes(), before)
            result = subprocess.run(argv[:-1] + [str(output.with_name("invalid.json")), "--pairs", "1:3:2"],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 2)


if __name__ == "__main__":
    unittest.main()
