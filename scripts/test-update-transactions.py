#!/usr/bin/env python3
"""Transaction and backup checks without system services or package mutations."""
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import sqlite3
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("fixtures", Path(__file__).with_name("test-update-retention.py"))
fixtures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixtures)
import maintenance
import receipt
from retention import Retention, save
from transactions import Transactions
from ubuntu import Ubuntu
import ubuntu


class Platform:
    def __init__(self, stages):
        self.stages, self.calls = stages, []
        self.supported = True
        self.failure = None

    def staging(self):
        return self.stages

    def preflight(self, record, manifest, packages):
        self.calls.append("preflight")
        if not self.supported:
            raise receipt.Rejected("Maintenance protocol unavailable")
        if self.failure == "preflight":
            raise receipt.Rejected("No storage")

    def install(self, record, packages):
        self.calls.append("apt-lock")
        if self.failure == "lock":
            raise receipt.Rejected("Package manager is locked")
        if self.failure == "acquisition":
            raise receipt.Rejected("Dependency archive acquisition failed")
        self.engine.hook(record["updateId"])
        self.calls.append("dpkg")

    def quiesce(self, record):
        self.calls.extend(["admit", "progress", "stop", "snapshot"])
        if self.failure == "snapshot":
            raise receipt.Rejected("Backup failed")

    def authorize_hook(self, peer_pid):
        pass

    def start_trial(self, record):
        self.calls.append("start-trial")

    def ready(self, record):
        self.calls.append("readiness")
        if self.failure == "readiness":
            raise receipt.Rejected("Wrong running build")

    def commit(self, record):
        self.calls.append("commit")
        if not self.engine.storage.read("active.json")["committed"]:
            raise AssertionError("Commit boundary must precede new writes")


class TransactionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.addCleanup(patch.stopall)
        patch.object(receipt, "signed_fields", side_effect=lambda data, key: json.loads(data)).start()
        patch.object(receipt, "run", side_effect=fixtures.fake_control).start()
        self.storage = Retention(self.root / "state")
        old = self.root / "old"
        first = fixtures.fixture(old)
        self.previous = self.storage.enroll(old, b"fixture", first["build"])
        self.stages = self.root / "staged"
        self.stages.mkdir()
        candidate = self.stages / "candidate"
        self.manifest = fixtures.fixture(candidate, 2)
        self.candidate_id = hashlib.sha256((candidate / "release.json").read_bytes()).hexdigest()
        candidate.rename(self.stages / self.candidate_id)
        self.platform = Platform(self.stages)
        self.engine = Transactions(self.storage, self.platform, lambda: b"fixture")
        self.platform.engine = self.engine
        self.request = {"candidateId": self.candidate_id, "requestId": "a" * 32, "confirmInterrupt": True}

    def test_success_has_durable_identity_order_and_retained_previous(self):
        accepted, started = self.engine.submit(self.request)
        self.assertTrue(started)
        self.assertEqual(self.storage.read("active.json")["updateId"], accepted["updateId"])
        self.assertNotIn("nonce", accepted)
        self.engine.execute()
        self.assertEqual(self.platform.calls, ["preflight", "apt-lock", "admit", "progress", "stop", "snapshot", "dpkg", "start-trial", "readiness", "commit"])
        self.assertEqual(self.engine.status()["phase"], "succeeded")
        self.assertEqual(self.storage.current(b"fixture")["candidateId"], self.candidate_id)
        self.assertTrue((self.storage.receipts / self.previous["candidateId"]).exists())
        restarted = Transactions(self.storage, self.platform, lambda: b"fixture")
        self.assertEqual(restarted.status(self.request["requestId"])["updateId"], accepted["updateId"])
        self.assertEqual(restarted.status()["phase"], "succeeded")

    def test_retry_during_active_work_returns_same_id_without_starting_again(self):
        first, _ = self.engine.submit(self.request)
        with self.storage.lock():
            second, started = self.engine.submit(self.request)
        self.assertFalse(started)
        self.assertEqual(first["updateId"], second["updateId"])
        with self.assertRaises(receipt.Rejected):
            self.engine.submit({**self.request, "candidateId": "f" * 64})

    def test_second_remote_cannot_create_another_transaction(self):
        self.engine.submit(self.request)
        with self.assertRaises(receipt.Rejected):
            self.engine.submit({**self.request, "requestId": "b" * 32})

    def test_no_app_protocol_fails_before_disruption(self):
        self.platform.supported = False
        self.engine.submit(self.request)
        self.engine.execute()
        self.assertEqual(self.platform.calls, ["preflight"])
        self.assertEqual(self.engine.status()["phase"], "failed")
        self.assertIsNone(self.storage.read("active.json"))
        self.assertEqual(self.storage.current(b"fixture"), self.previous)

    def test_apt_lock_failure_never_reaches_quiescing(self):
        self.platform.failure = "lock"
        self.engine.submit(self.request)
        self.engine.execute()
        self.assertEqual(self.platform.calls, ["preflight", "apt-lock"])
        self.assertEqual(self.engine.status()["phase"], "failed")

    def test_failed_backup_never_reaches_dpkg(self):
        self.platform.failure = "snapshot"
        self.engine.submit(self.request)
        self.engine.execute()
        self.assertNotIn("dpkg", self.platform.calls)
        self.assertEqual(self.engine.status()["phase"], "operator-required")
        self.assertEqual(self.storage.current(b"fixture"), self.previous)

    def test_acquisition_failure_keeps_app_running_and_current_receipt(self):
        self.platform.failure = "acquisition"
        self.engine.submit(self.request)
        self.engine.execute()
        self.assertEqual(self.platform.calls, ["preflight", "apt-lock"])
        self.assertFalse(self.engine.record["disrupted"])
        self.assertEqual(self.engine.status()["phase"], "failed")
        self.assertEqual(self.storage.current(b"fixture"), self.previous)

    def test_wrong_build_cannot_report_success_or_commit_new_data(self):
        self.platform.failure = "readiness"
        self.engine.submit(self.request)
        self.engine.execute()
        self.assertEqual(self.engine.status()["phase"], "operator-required")
        self.assertNotIn("commit", self.platform.calls)
        self.assertFalse(self.storage.read("active.json")["committed"])
        self.assertEqual(self.storage.current(b"fixture"), self.previous)

    def test_restart_before_disruption_deduplicates_with_truthful_failure(self):
        first, _ = self.engine.submit(self.request)
        restarted = Transactions(self.storage, self.platform, lambda: b"fixture")
        duplicate, start = restarted.submit(self.request)
        self.assertFalse(start)
        self.assertEqual(first["updateId"], duplicate["updateId"])
        self.assertEqual(duplicate["phase"], "failed")

    def test_restart_during_install_requires_operator_without_reinstall_loop(self):
        self.engine.submit(self.request)
        self.engine.transition("installing")
        restarted = Transactions(self.storage, self.platform, lambda: b"fixture")
        self.assertEqual(restarted.status()["phase"], "operator-required")
        self.assertEqual(self.platform.calls, [])
        with self.assertRaises(receipt.Rejected):
            restarted.submit({**self.request, "requestId": "b" * 32})

    def test_hook_requires_exact_active_transaction(self):
        with self.assertRaises(receipt.Rejected):
            self.engine.hook("a" * 32)
        self.engine.submit(self.request)
        with self.assertRaises(receipt.Rejected):
            self.engine.hook(self.engine.record["updateId"])
        self.engine.transition("installing")
        with self.assertRaises(receipt.Rejected):
            self.engine.hook("b" * 32)
        self.assertEqual(self.platform.calls, [])

    def test_browser_cannot_supply_a_path_command_package_or_url(self):
        for field in ("path", "command", "package", "url"):
            with self.subTest(field=field), self.assertRaises(receipt.Rejected):
                self.engine.submit({**self.request, field: "anything"})
        with self.assertRaises(receipt.Rejected):
            self.engine.submit({**self.request, "candidateId": "../receipt"})


class ReadinessTests(unittest.TestCase):
    def test_wrong_identity_uses_local_clock_without_affecting_other_threads(self):
        platform = Ubuntu.__new__(Ubuntu)
        platform.coordinator = lambda *args: {"build": {"version": "old"}}
        record = {"version": "new", "revision": "a" * 40, "dataFormat": 1}
        ticks = iter([0, 0, 91])
        original_clock = time.monotonic
        with patch.object(ubuntu, "time", SimpleNamespace(monotonic=lambda: next(ticks), sleep=lambda _: None)):
            with self.assertRaisesRegex(receipt.Rejected, "bounded startup trial"):
                platform.ready(record)
            self.assertIs(time.monotonic, original_clock)


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.data = self.root / "data"
        self.data.mkdir()
        self.database = sqlite3.connect(self.data / "couch.sqlite")
        self.addCleanup(self.database.close)
        self.database.execute("PRAGMA journal_mode=WAL")
        self.database.execute("PRAGMA wal_autocheckpoint=0")
        self.database.execute("CREATE TABLE preserved (value TEXT)")
        self.database.execute("INSERT INTO preserved VALUES ('pairing and progress')")
        self.database.commit()
        (self.data / "preferences.json").write_text('{"unchanged":true}')
        (self.data / "updates/staged").mkdir(parents=True)
        (self.data / "updates/staged/cache").write_bytes(b"not user state")
        (self.data / "updates/settings.json").write_text('{"channel":"preview"}')

    def test_backup_includes_committed_wal_and_preserves_other_state(self):
        before = (self.data / "couch.sqlite-wal").read_bytes()
        backup = self.root / "backup"
        maintenance.snapshot(self.data, backup)
        with sqlite3.connect(backup / "data/couch.sqlite") as database:
            self.assertEqual(database.execute("SELECT value FROM preserved").fetchall(), [("pairing and progress",)])
            self.assertEqual(database.execute("PRAGMA quick_check").fetchall(), [("ok",)])
        self.assertEqual((self.data / "couch.sqlite-wal").read_bytes(), before)
        self.assertEqual((backup / "data/preferences.json").read_bytes(), (self.data / "preferences.json").read_bytes())
        self.assertTrue((backup / "data/updates/settings.json").exists())
        self.assertFalse((backup / "data/updates/staged").exists())
        hashes = json.loads((backup / "hashes.json").read_bytes())
        self.assertEqual(hashes["data/couch.sqlite"], hashlib.sha256((backup / "data/couch.sqlite").read_bytes()).hexdigest())

    def test_external_media_symlink_is_preserved_without_following(self):
        outside = self.root / "media"
        outside.mkdir()
        (outside / "movie").write_bytes(b"external media")
        (self.data / "media").symlink_to(outside, target_is_directory=True)
        maintenance.snapshot(self.data, self.root / "backup")
        self.assertTrue((self.root / "backup/data/media").is_symlink())
        self.assertNotIn("data/media/movie", json.loads((self.root / "backup/hashes.json").read_bytes()))

    def test_space_failure_does_not_touch_live_data_or_leave_partial_backup(self):
        with patch.object(maintenance.shutil, "disk_usage", return_value=shutil._ntuple_diskusage(100, 100, 0)), self.assertRaises(receipt.Rejected):
            maintenance.snapshot(self.data, self.root / "backup")
        self.assertFalse((self.root / "backup").exists())
        self.assertEqual(self.database.execute("SELECT value FROM preserved").fetchall(), [("pairing and progress",)])


if __name__ == "__main__":
    unittest.main()
