#!/usr/bin/env python3
"""Exact-current repair contracts; APT, signing and service calls are doubles here."""
from contextlib import contextmanager, nullcontext
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("repair_fixtures", Path(__file__).with_name("test-update-recovery.py"))
fixtures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixtures)
import receipt
import recovery
import system_packages
import ubuntu


class RepairTests(unittest.TestCase):
    def setUp(self):
        fixtures.fixtures.TransactionTests.setUp(self)
        self.platform.package_lock = nullcontext
        self.request = {"expectedCurrentId": self.previous["candidateId"], "requestId": "b" * 32, "confirmInterrupt": False, "repairRuntime": False}

    def execute(self):
        self.engine.submit(self.request, "repair-current")
        self.engine.execute()

    def test_same_current_receipt_is_reinstalled_without_reading_or_changing_newer_staging(self):
        before = {str(path): path.read_bytes() for path in self.stages.rglob("*") if path.is_file()}
        self.platform.staging = lambda: self.fail("Repair must never select the newer staged candidate")
        locked = False
        @contextmanager
        def lock():
            nonlocal locked
            locked = True
            try: yield
            finally: locked = False
        self.platform.package_lock = lock
        ready, commit = self.platform.ready, self.platform.commit
        self.platform.ready = lambda record: (self.assertTrue(locked), ready(record))
        self.platform.commit = lambda record: (self.assertTrue(locked), commit(record))
        self.execute()
        self.assertEqual(self.engine.status()["phase"], "succeeded")
        self.assertEqual(self.engine.status()["intent"], "repair-current")
        self.assertEqual(self.storage.current(b"fixture"), self.previous)
        self.assertIn("dpkg", self.platform.calls)
        self.assertEqual({str(path): path.read_bytes() for path in self.stages.rglob("*") if path.is_file()}, before)
        self.assertIsNone(self.engine.context())
        self.assertFalse(self.engine.submit(self.request, "repair-current")[1])
        for changed in ({**self.request, "repairRuntime": True}, {**self.request, "confirmInterrupt": True}):
            with self.assertRaises(receipt.Rejected): self.engine.submit(changed, "repair-current")

    def test_only_authenticated_current_can_use_expired_signed_metadata(self):
        retained = self.storage.receipts / self.previous["candidateId"]
        metadata = json.loads((retained / "InRelease").read_bytes())
        metadata["Date"] = format_datetime(datetime.now(timezone.utc) - timedelta(days=2))
        metadata["Valid-Until"] = format_datetime(datetime.now(timezone.utc) - timedelta(days=1))
        (retained / "InRelease").write_text(json.dumps(metadata))
        self.execute()
        self.assertEqual(self.engine.status()["phase"], "succeeded")
        with self.assertRaises(receipt.Rejected):
            receipt.copy_receipt(retained, None, b"fixture", True, self.previous["candidateId"])

    def test_missing_or_corrupt_archives_fail_before_any_maintenance_and_explicit_retry_is_possible(self):
        retained = self.storage.receipts / self.previous["candidateId"]
        path = next(retained.glob("couch_*.deb"))
        original = path.read_bytes()
        for request_id, missing in (("c", True), ("d", False)):
            self.request["requestId"] = request_id * 32
            if missing: path.unlink()
            else: path.write_bytes(b"x" * len(original))
            self.execute()
            self.assertEqual(self.engine.status()["phase"], "failed")
            self.assertIn("current-release receipt or archives are unavailable or failed authentication", self.engine.status()["error"])
            self.assertFalse(self.engine.record["disrupted"])
            self.assertEqual(self.platform.calls, [])
            self.assertFalse(self.engine.submit(self.request, "repair-current")[1])
            path.write_bytes(original)
        self.request["requestId"] = "e" * 32
        self.execute()
        self.assertEqual(self.engine.status()["phase"], "succeeded")

    def test_stale_current_and_arbitrary_inputs_are_not_accepted(self):
        for changes in ({"expectedCurrentId": self.candidate_id}, {"package": "ffmpeg"}, {"repairRuntime": "true"}, {"whenIdle": True}):
            with self.subTest(changes=changes), self.assertRaises(receipt.Rejected):
                self.engine.submit({**self.request, **changes}, "repair-current")
        self.assertIsNone(self.storage.read("active.json"))


class RepairRecoveryTests(unittest.TestCase):
    def setUp(self):
        fixtures.RecoveryTests.setUp(self)
        self.request = {"expectedCurrentId": self.previous["candidateId"], "requestId": "b" * 32, "confirmInterrupt": True, "repairRuntime": False}
        def ready(record):
            if record["phase"] != "restoring": raise receipt.Rejected("Package tool smoke failed")
            self.assertEqual(self.engine.context()["intent"], "recovery")
        self.platform.ready = ready

    def test_failed_tool_verification_restores_data_and_reports_restored_not_repaired(self):
        staged = {str(path): path.read_bytes() for path in self.stages.rglob("*") if path.is_file()}
        self.engine.submit(self.request, "repair-current")
        self.engine.execute()
        self.assertEqual(self.engine.status()["phase"], "restored")
        self.assertEqual(self.engine.record["automaticStarts"], 1)
        self.assertEqual(self.engine.record["updateError"], "Package tool smoke failed")
        self.assertEqual(self.platform.restores, 1)
        fixtures.RecoveryTests.preserved(self)
        self.assertEqual({str(path): path.read_bytes() for path in self.stages.rglob("*") if path.is_file()}, staged)
        restarted = fixtures.transactions.Transactions(self.storage, self.platform, lambda: b"fixture")
        self.assertEqual(restarted.status()["phase"], "restored")
        self.assertFalse(restarted.submit(self.request, "repair-current")[1])
        with self.assertRaisesRegex(receipt.Rejected, "Committed data"):
            recovery.restore(self.engine, self.engine.record["updateId"])


class UbuntuRepairTests(unittest.TestCase):
    def test_preflight_and_final_apt_reinstall_only_exact_current_and_optional_fixed_runtime(self):
        with tempfile.TemporaryDirectory() as directory:
            platform = ubuntu.Ubuntu.__new__(ubuntu.Ubuntu)
            platform.root = Path(directory)
            platform.data = lambda: Path(directory)
            build = {"version": "1.0", "revision": "a" * 40, "dataFormat": 1}
            record = {**build, "previous": build, "updateId": "b" * 32, "intent": "repair-current", "repairRuntime": True}
            platform.verify_current = lambda record: build
            capabilities = {"build": build, "nativeReadiness": "libmpv-v1", "toolRepair": "package-smoke-v1"}
            platform.coordinator = lambda *args: capabilities
            platform.system_status = lambda *args: {"ok": True, "version": "7:6.1.1-3ubuntu5", "installed": "7:6.1.1-3ubuntu5"}
            calls = []
            platform.apt = lambda record, arguments, hook=None: calls.append((arguments, hook))
            packages = [Path(directory) / name for name in ("couch.deb", "couch-appliance.deb")]
            def run(*args):
                if args[1] == "--print-architecture": return b"amd64"
                if args[1] == "--contents": return b"-rw-r--r-- root/root 64 2026-09-07 ./fixture"
                return b""
            with patch.object(ubuntu, "trusted_file", return_value=b'ID=ubuntu\nVERSION_ID="24.04"\n'), patch.object(ubuntu, "run", side_effect=run) as commands, patch.object(ubuntu.shutil, "disk_usage", return_value=SimpleNamespace(free=1024**3)), patch.object(ubuntu.maintenance, "inventory", return_value=([], 1024)):
                capabilities.pop("toolRepair")
                with self.assertRaisesRegex(receipt.Rejected, "cannot verify tool repair"): platform.preflight(record, {}, packages)
                self.assertEqual(calls, [])
                capabilities["toolRepair"] = "package-smoke-v1"
                platform.preflight(record, {}, packages)
                platform.install(record, packages)
            exact = ["--reinstall", "install", *map(str, packages), "ffmpeg=7:6.1.1-3ubuntu5"]
            self.assertEqual([value[0] for value in calls], [["--simulate", *exact], ["--download-only", *exact], exact])
            self.assertIsNotNone(calls[-1][1])
            self.assertIn(("/usr/bin/dpkg", "--compare-versions", "1.0", "eq", "1.0"), [value.args for value in commands.call_args_list])
            self.assertEqual(record["runtimePrevious"], "7:6.1.1-3ubuntu5")
            self.assertEqual(platform.runtime_arguments({"repairRuntime": False}), [])

    def test_final_hook_rejects_runtime_change_before_quiescing(self):
        platform = ubuntu.Ubuntu.__new__(ubuntu.Ubuntu)
        build = {"version": "1", "revision": "a" * 40, "dataFormat": 1}
        record = {"previous": build, "repairRuntime": True, "runtimePrevious": "1.0"}
        platform.system_status = lambda *args: {"ok": True, "installed": "2.0"}
        with patch.object(ubuntu, "installed", return_value=build), self.assertRaisesRegex(receipt.Rejected, "runtime changed"):
            platform.verify_current(record)

    def test_readiness_requires_fresh_tool_proof_and_runtime_package_integrity(self):
        platform = ubuntu.Ubuntu.__new__(ubuntu.Ubuntu)
        record = {"version": "1", "revision": "a" * 40, "dataFormat": 1, "intent": "repair-current", "phase": "trial"}
        build = {key: record[key] for key in ("version", "revision", "dataFormat")}
        result = {"build": build, "nativeBuild": build, "frontendBuild": build, "database": "ok", "nativeReadiness": "libmpv-v1", "frontendReady": True}
        platform.coordinator = lambda *args: result
        clock = SimpleNamespace(now=0)
        clock.monotonic = lambda: clock.now
        clock.sleep = lambda _: setattr(clock, "now", 91)
        with patch.object(ubuntu, "time", clock), self.assertRaises(receipt.Rejected): platform.ready(record)
        result["toolRepair"] = "verified-v1"
        platform.ready(record)
        record.update(repairRuntime=True, runtimeVersion="7:6.1.1-3ubuntu5")
        with patch.object(ubuntu, "run", side_effect=[b"7:6.1.1-3ubuntu5", b""]) as run:
            platform.ready(record)
            self.assertEqual(run.call_args_list[-1].args, ("/usr/bin/dpkg", "--verify", "ffmpeg"))
        clock.now = 0
        with patch.object(ubuntu, "time", clock), patch.object(ubuntu, "run", side_effect=[b"7:6.1.1-3ubuntu5", b"damaged"]), self.assertRaises(receipt.Rejected): platform.ready(record)
        record["phase"] = "restoring"
        result.pop("toolRepair")
        with patch.object(ubuntu, "run") as run:
            platform.ready(record)
            run.assert_not_called()

    def test_runtime_archive_selection_keeps_exact_installed_ubuntu_version(self):
        origin = SimpleNamespace(origin="Ubuntu", trusted=True, archive="noble-security")
        old = SimpleNamespace(version="7:6.1.1-3ubuntu5", downloadable=True, origins=[origin])
        newer = SimpleNamespace(version="7:6.1.1-3ubuntu6", downloadable=True, origins=[origin])
        package = SimpleNamespace(installed=old, candidate=newer, versions=[newer, old])
        with patch.dict(sys.modules, {"apt": SimpleNamespace(Cache=lambda: {"ffmpeg": package})}):
            self.assertEqual(system_packages.inspect(True), {"version": old.version, "installed": old.version})
            for field, value in (("downloadable", False), ("origins", [SimpleNamespace(origin="Third-party", trusted=True)])):
                previous = getattr(old, field)
                setattr(old, field, value)
                with self.assertRaisesRegex(ValueError, "exact Ubuntu ffmpeg archive"): system_packages.inspect(True)
                setattr(old, field, previous)
            package.installed = None
            self.assertEqual(system_packages.inspect(True), {"version": newer.version, "installed": None})

    def test_ubuntu_status_is_only_cached_package_and_security_counts(self):
        def package(origin, archive, trusted=True):
            return SimpleNamespace(is_installed=True, is_upgradable=True, candidate=SimpleNamespace(origins=[SimpleNamespace(origin=origin, archive=archive, trusted=trusted)]))
        class Cache(list): broken_count = 1
        cache = Cache([package("Ubuntu", "noble-security"), package("Ubuntu", "noble-updates"), package("Third-party", "noble-security"), package("Ubuntu", "noble-security", False)])
        with patch.dict(sys.modules, {"apt": SimpleNamespace(Cache=lambda: cache)}), patch.object(system_packages.Path, "exists", return_value=False):
            self.assertEqual(system_packages.inspect(), {"available": 2, "security": 1, "broken": 1, "indexUpdatedAt": None})


if __name__ == "__main__":
    unittest.main()
