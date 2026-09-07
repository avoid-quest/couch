#!/usr/bin/env python3
"""Recovery journal faults with package, supervisor and native doubles unless stated."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("transaction_fixtures", Path(__file__).with_name("test-update-transactions.py"))
fixtures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixtures)
import maintenance
import receipt
import recovery
import transactions
import worker
from retention import save


class PowerLoss(BaseException):
    pass


class RecoveryPlatform(fixtures.Platform):
    def __init__(self, stages, data, current):
        super().__init__(stages)
        self.data, self.current = data, current
        self.failure = "readiness"
        self.restore_failure = None
        self.crash = None
        self.restores = 0

    def barrier(self, name):
        if self.crash == name:
            raise PowerLoss(name)
        if self.restore_failure == name:
            raise receipt.Rejected(name + " unavailable")

    def quiesce(self, record):
        super().quiesce(record)
        directory = self.engine.storage.root / "backups"
        directory.mkdir(exist_ok=True)
        maintenance.snapshot(self.data, directory / record["updateId"])

    def install(self, record, packages):
        super().install(record, packages)
        self.current = {key: record[key] for key in ("candidateId", "version", "revision", "dataFormat")}
        (self.data / "preferences.json").write_text('"candidate migration"')
        if self.failure == "install":
            raise receipt.Rejected("Interrupted dpkg")

    def stop_for_restore(self):
        self.calls.append("restore-stop")
        self.barrier("stop")

    def unchanged_previous(self, previous):
        return self.current == previous

    def package_lock(self):
        return fixtures.nullcontext()

    def package_health(self):
        self.barrier("health")

    def restore_packages(self, record, packages):
        self.barrier("packages")
        self.restores += 1
        self.current = {key: record[key] for key in ("candidateId", "version", "revision", "dataFormat")}
        self.barrier("after-packages")

    def restore_data(self, backup, state, persist):
        # Journal tests only. Linux tests below execute the real rename protocol.
        self.barrier("data")
        shutil.copytree(backup / "data", self.data, dirs_exist_ok=True)
        state["fixtureCopied"] = True
        persist()
        self.barrier("after-data")
        return str(self.data.parent / "retained-failed-trial-fixture")

    def start_restored_trial(self, record):
        self.calls.append("restore-trial")
        self.barrier("trial")
        context = self.engine.context()
        assert context["phase"] == "trial" and context["version"] == self.current["version"]
        assert not context["committed"]

    def ready(self, record):
        if record["version"] == "0.1.0+build.1.1":
            self.barrier("previous-readiness")
            return
        super().ready(record)


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        fixtures.TransactionTests.setUp(self)
        self.data = self.root / "application"
        self.data.mkdir()
        db = sqlite3.connect(self.data / "couch.sqlite")
        db.execute("CREATE TABLE preferences (key TEXT, value TEXT)")
        db.executemany("INSERT INTO preferences VALUES (?, ?)", [("credential", "private-token"), ("source", "/media"), ("progress", "37")])
        db.commit(); db.close()
        (self.data / "preferences.json").write_text('{"volume":42,"language":"ita"}')
        self.original = {path.name: path.read_bytes() for path in self.data.iterdir()}
        self.platform = RecoveryPlatform(self.stages, self.data, self.previous)
        self.engine = transactions.Transactions(self.storage, self.platform, lambda: b"fixture")
        self.platform.engine = self.engine
        patch.object(recovery, "installed", side_effect=lambda: self.platform.current).start()

    def restart(self):
        self.engine = transactions.Transactions(self.storage, self.platform, lambda: b"fixture")
        self.platform.engine = self.engine
        if self.engine.record and self.engine.record.get("recoveryPending"):
            self.engine.recover()

    def execute(self):
        self.engine.submit(self.request)
        self.engine.execute()

    def preserved(self):
        self.assertEqual((self.data / "preferences.json").read_bytes(), self.original["preferences.json"])
        with sqlite3.connect(self.data / "couch.sqlite") as db:
            self.assertEqual(db.execute("PRAGMA quick_check").fetchall(), [("ok",)])
            self.assertEqual(db.execute("SELECT key, value FROM preferences ORDER BY key").fetchall(), [("credential", "private-token"), ("progress", "37"), ("source", "/media")])
        self.assertEqual(self.storage.current(b"fixture"), self.previous)

    def test_failed_trial_automatically_restores_previous_and_keeps_request_identity(self):
        self.execute()
        self.assertEqual(self.engine.status()["phase"], "restored")
        self.assertEqual(self.engine.status()["restoredVersion"], self.previous["version"])
        self.assertEqual(self.engine.record["automaticStarts"], 1)
        self.assertEqual(self.engine.record["updateError"], "Wrong running build")
        self.assertFalse(self.engine.submit(self.request)[1])
        self.assertIsNone(self.engine.context())
        self.preserved()

    def test_interrupted_install_uses_the_same_authenticated_previous_snapshot(self):
        self.platform.failure = "install"
        self.execute()
        self.assertEqual(self.engine.status()["phase"], "restored")
        self.preserved()

    def test_predisruption_storage_download_and_package_lock_failures_do_not_restore(self):
        for failure in ("preflight", "acquisition", "lock"):
            with self.subTest(failure=failure):
                self.platform.failure = failure
                self.request["requestId"] = {"preflight": "b", "acquisition": "c", "lock": "d"}[failure] * 32
                self.execute()
                self.assertEqual(self.engine.status()["phase"], "failed")
                self.assertEqual(self.platform.restores, 0)
                self.assertNotIn("restore-stop", self.platform.calls)
                self.preserved()

    def test_automatic_failure_does_not_retry_on_boot_but_ssh_can_continue(self):
        for failure in ("packages", "data", "previous-readiness"):
            with self.subTest(failure=failure):
                self.platform.restore_failure = failure
                self.execute()
                self.assertEqual(self.engine.status()["phase"], "operator-required")
                starts, restores = self.engine.record["automaticStarts"], self.platform.restores
                for _ in range(3):
                    self.restart()
                self.assertEqual(self.engine.record["automaticStarts"], starts)
                self.assertEqual(self.platform.restores, restores)
                self.platform.restore_failure = None
                self.assertEqual(recovery.restore(self.engine, self.engine.record["updateId"])["phase"], "restored")
                self.preserved()
                # Each subcase needs a fresh newer update receipt and request.
                self.request["requestId"] = {"packages": "e", "data": "f", "previous-readiness": "0"}[failure] * 32

    def test_restart_during_each_precommit_recovery_stage_finishes_once(self):
        for point in ("stop", "after-packages", "after-data", "trial", "previous-readiness"):
            with self.subTest(point=point):
                self.platform.crash = point
                with self.assertRaises(PowerLoss):
                    self.execute()
                self.platform.crash = None
                self.restart()
                self.assertEqual(self.engine.status()["phase"], "restored")
                self.assertEqual(self.engine.record["automaticStarts"], 2)
                self.preserved()
                self.request["requestId"] = hashlib.md5(point.encode()).hexdigest()

    def test_repeated_power_loss_exhausts_durable_budget_without_a_boot_loop(self):
        self.platform.crash = "stop"
        with self.assertRaises(PowerLoss): self.execute()
        for _ in range(2):
            with self.assertRaises(PowerLoss): self.restart()
        self.restart()
        self.assertEqual(self.engine.record["automaticStarts"], 3)
        self.assertTrue(self.engine.record["automaticFailed"])
        self.assertFalse(self.engine.record["recoveryPending"])
        self.platform.crash = None
        self.assertEqual(recovery.restore(self.engine, self.engine.record["updateId"])["phase"], "restored")
        self.preserved()

    def test_committed_recovery_never_reinstalls_or_restores_after_current_receipt_fault(self):
        actual_save = recovery.save
        def fail_current(path, value):
            if path.name == "current.json":
                raise PowerLoss("current receipt")
            actual_save(path, value)
        with patch.object(recovery, "save", side_effect=fail_current):
            with self.assertRaises(PowerLoss): self.execute()
        restores = self.platform.restores
        self.assertTrue(self.engine.record["committed"])
        self.restart()
        self.assertFalse(self.engine.record["recoveryPending"])
        self.assertEqual(self.engine.status()["phase"], "operator-required")
        self.assertEqual(self.platform.restores, restores)
        with self.assertRaises(receipt.Rejected): recovery.restore(self.engine, self.engine.record["updateId"])
        self.preserved()

    def test_corrupt_snapshot_stops_before_packages_and_retains_ssh_evidence(self):
        original = self.platform.quiesce
        def corrupt(record):
            original(record)
            (self.storage.root / "backups" / record["updateId"] / "data/preferences.json").write_text("corrupted")
        self.platform.quiesce = corrupt
        self.execute()
        self.assertEqual(self.engine.status()["phase"], "operator-required")
        self.assertEqual(self.platform.restores, 0)
        self.assertTrue(self.engine.record["automaticFailed"])
        self.assertTrue((self.storage.root / "backups" / self.engine.record["updateId"]).exists())
        self.restart()
        self.assertEqual(self.platform.restores, 0)

    def test_restart_recovery_uses_root_retention_without_staging_or_feed(self):
        self.platform.crash = "stop"
        with self.assertRaises(PowerLoss): self.execute()
        shutil.rmtree(self.stages)
        self.platform.crash = None
        self.restart()
        self.assertEqual(self.engine.status()["phase"], "restored")
        self.preserved()

    def test_live_hook_must_finish_before_any_automatic_restore(self):
        self.engine.submit(self.request)
        self.engine.transition("operator-required", disrupted=True, recoveryPending=True)
        self.engine.hook_idle.clear()
        self.engine.recover()
        self.assertTrue(self.engine.record["automaticFailed"])
        self.assertFalse(self.engine.record["recoveryPending"])
        self.assertEqual(self.platform.restores, 0)
        self.assertNotIn("restore-stop", self.platform.calls)

    def test_normal_commit_current_receipt_fault_never_rolls_back_candidate_writes(self):
        self.platform.failure = None
        actual_save = transactions.save
        def crash(path, value):
            if path.name == "current.json":
                actual_save(path, value)
                raise PowerLoss("accepted current receipt is durable")
            actual_save(path, value)
        with patch.object(transactions, "save", side_effect=crash):
            with self.assertRaises(PowerLoss): self.execute()
        (self.data / "preferences.json").write_text("new accepted user preferences")
        self.restart()
        self.assertTrue(self.engine.record["committed"])
        self.assertFalse(self.engine.record["recoveryPending"])
        self.assertEqual(self.platform.restores, 0)
        self.assertEqual((self.data / "preferences.json").read_text(), "new accepted user preferences")
        with self.assertRaises(receipt.Rejected): recovery.restore(self.engine, self.engine.record["updateId"])

    def test_restored_terminal_journal_survives_old_active_marker_and_missing_clear(self):
        actual_save = transactions.save
        def crash(path, value):
            if path.name == "active.json" and value["phase"] == "restored":
                raise PowerLoss("restored journal durable before active marker")
            actual_save(path, value)
        with patch.object(transactions, "save", side_effect=crash):
            with self.assertRaises(PowerLoss): self.execute()
        restores = self.platform.restores
        self.restart()
        self.assertEqual(self.engine.status()["phase"], "restored")
        self.assertIsNone(self.engine.context())
        self.assertIsNone(self.storage.read("active.json"))
        self.assertEqual(self.platform.restores, restores)
        self.preserved()

    def test_restoration_commit_failure_preserves_boundary_after_current_receipt_write(self):
        original_commit = self.platform.commit
        def crash(record):
            original_commit(record)
            raise PowerLoss("admission may already be open")
        self.platform.commit = crash
        with self.assertRaises(PowerLoss): self.execute()
        restores = self.platform.restores
        (self.data / "preferences.json").write_text("accepted previous-build user writes")
        self.restart()
        self.assertFalse(self.engine.record["recoveryPending"])
        self.assertTrue(self.engine.record["committed"])
        self.assertEqual(self.platform.restores, restores)
        self.assertEqual((self.data / "preferences.json").read_text(), "accepted previous-build user writes")

    def test_ssh_retry_resumes_after_its_fresh_plan_journal_was_reset(self):
        self.platform.restore_failure = "previous-readiness"
        self.execute()
        # A prior SSH retry durably cleared its completed plan, then died before
        # assigning the replacement nonce. No new data was admitted or removed.
        self.engine.transition("operator-required", restoration=None)
        self.platform.restore_failure = None
        self.assertEqual(recovery.restore(self.engine, self.engine.record["updateId"])["phase"], "restored")
        self.preserved()


@unittest.skipUnless(Path("/proc/self/fd").exists(), "Pinned directory recovery requires Linux procfs")
class DataSwapTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.data, self.backup = self.root / "live", self.root / "backup"
        self.data.mkdir()
        with sqlite3.connect(self.data / "couch.sqlite") as db:
            db.execute("CREATE TABLE progress (position INTEGER)")
            db.execute("INSERT INTO progress VALUES (37)")
        (self.data / "credentials").write_text("original private token")
        maintenance.snapshot(self.data, self.backup)
        (self.data / "credentials").write_text("failed candidate token")
        self.state_file = self.root / "journal.json"
        self.state = {"nonce": "f" * 32}
        self.persist()
        self.hashes = (self.backup / "hashes.json").read_bytes()

    def persist(self):
        save(self.state_file, self.state)

    def resume(self):
        self.state = json.loads(self.state_file.read_bytes())
        return recovery.restore_data(self.data, self.backup, self.state, self.persist)

    def verify(self, failed):
        self.assertEqual((self.data / "credentials").read_text(), "original private token")
        self.assertEqual((Path(failed) / "credentials").read_text(), "failed candidate token")
        self.assertEqual((self.backup / "hashes.json").read_bytes(), self.hashes)
        recovery.verify_backup(self.backup)
        with sqlite3.connect(self.data / "couch.sqlite") as db:
            self.assertEqual(db.execute("SELECT position FROM progress").fetchall(), [(37,)])
        self.assertEqual(len(list(self.root.glob(".couch-failed-trial-*"))), 1)

    def interrupted_rename(self, number):
        rename, calls = os.rename, []
        def interrupted(*args, **kwargs):
            rename(*args, **kwargs)
            calls.append(args)
            if len(calls) == number:
                raise PowerLoss("rename completed before journal")
        with patch.object(os, "rename", side_effect=interrupted):
            with self.assertRaises(PowerLoss):
                recovery.restore_data(self.data, self.backup, self.state, self.persist)
        if number == 1:
            self.assertFalse(self.data.exists())
        installed_inode = self.data.stat().st_ino if self.data.exists() else None
        failed = self.resume()
        self.verify(failed)
        if installed_inode is not None:
            self.assertEqual(self.data.stat().st_ino, installed_inode)
        self.assertEqual(self.resume(), failed)
        self.verify(failed)

    def test_power_loss_after_moving_failed_data_retains_both_trees(self):
        self.interrupted_rename(1)

    def test_power_loss_after_installing_snapshot_reuses_installed_tree(self):
        self.interrupted_rename(2)

    def test_lost_prepared_journal_rebuilds_only_the_private_copy(self):
        def persist():
            if self.state.get("swap", {}).get("step") == "prepared":
                raise PowerLoss("copy durable but journal old")
            self.persist()
        with self.assertRaises(PowerLoss):
            recovery.restore_data(self.data, self.backup, self.state, persist)
        self.assertEqual((self.data / "credentials").read_text(), "failed candidate token")
        self.verify(self.resume())

    def test_restore_disk_exhaustion_preserves_live_data_and_snapshot_for_ssh_retry(self):
        with patch.object(shutil, "disk_usage", return_value=fixtures.SimpleNamespace(free=0)):
            with self.assertRaisesRegex(receipt.Rejected, "Free space"):
                recovery.restore_data(self.data, self.backup, self.state, self.persist)
        self.assertEqual((self.data / "credentials").read_text(), "failed candidate token")
        self.verify(self.resume())

    def test_changed_directory_type_after_interrupted_swap_is_not_followed(self):
        rename = os.rename
        def interrupted(*args, **kwargs):
            rename(*args, **kwargs)
            raise PowerLoss()
        with patch.object(os, "rename", side_effect=interrupted):
            with self.assertRaises(PowerLoss):
                recovery.restore_data(self.data, self.backup, self.state, self.persist)
        outside = self.root / "outside"
        outside.mkdir(); (outside / "untouched").write_text("keep")
        self.data.symlink_to(outside, target_is_directory=True)
        with self.assertRaises(receipt.Rejected): self.resume()
        self.assertEqual((outside / "untouched").read_text(), "keep")
        self.assertTrue(self.backup.exists())


class RetainedWorkerTests(unittest.TestCase):
    def test_frozen_worker_imports_survive_replacement_of_package_owned_sources(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, state, override = root / "package", root / "state", root / "units/drop-in.conf"
            source.mkdir(); state.mkdir()
            production = Path(__file__).resolve().parents[1] / "packaging/appliance/root/usr/lib/couch-appliance/updater"
            for name in worker.MODULES:
                shutil.copy2(production / (name + ".py"), source / (name + ".py"))
            with patch.object(worker, "SOURCE", source), patch.object(worker, "OVERRIDE", override), patch.object(worker, "trusted_file", side_effect=lambda path: Path(path).read_bytes()), patch.object(worker, "run") as systemctl:
                worker.preserve(state, "a" * 32)
                frozen = state / "workers" / ("a" * 32)
                shutil.rmtree(source)
                script = "import pathlib,sys; sys.path.insert(0,sys.argv[1]); import serve,recovery,transactions,system_packages; assert all(pathlib.Path(module.__file__).resolve().parent == pathlib.Path(sys.argv[1]).resolve() for module in (serve,recovery,transactions,system_packages))"
                subprocess.run([os.sys.executable, "-I", "-c", script, str(frozen)], check=True, timeout=5)
                self.assertIn(str(frozen / "serve.py"), override.read_text())
                self.assertEqual(systemctl.call_args.args, ("/usr/bin/systemctl", "daemon-reload"))
                worker.release(state, "a" * 32)
                self.assertFalse(override.exists())
                self.assertTrue((frozen / "recovery.py").exists())

    def test_another_service_override_is_preserved(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); override = root / "override.conf"
            override.write_text("administrator configuration")
            with patch.object(worker, "OVERRIDE", override), patch.object(worker, "trusted_file", side_effect=lambda path: Path(path).read_bytes()):
                with self.assertRaises(receipt.Rejected): worker.release(root, "a" * 32)
                self.assertEqual(override.read_text(), "administrator configuration")


if __name__ == "__main__":
    unittest.main()
