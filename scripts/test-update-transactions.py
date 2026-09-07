#!/usr/bin/env python3
"""Transaction and backup checks without system services or package mutations."""
import hashlib
from contextlib import contextmanager, nullcontext, redirect_stderr
import importlib.util
from importlib.machinery import SourceFileLoader
import io
import json
import os
import select
from pathlib import Path
import shutil
import sqlite3
import socket
import socketserver
import struct
import tempfile
import threading
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
import serve
import bridge
import recovery
import operator_client


class Platform:
    def __init__(self, stages):
        self.stages, self.calls = stages, []
        self.supported = True
        self.failure = None

    def preserve_worker(self, record):
        pass

    def release_worker(self, record):
        pass

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

    def verify_current(self, record):
        if self.failure == "current-changed":
            raise receipt.Rejected("Installed release changed after preflight")

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
        patch("transactions.HOOK_DRAIN_SECONDS", 0).start()
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

    def prepare_recovery(self, failure):
        self.platform.failure = failure
        self.engine.submit(self.request)
        self.engine.execute()
        self.assertEqual(self.engine.record["phase"], "operator-required")
        self.platform.failure = None
        self.platform.stop_for_restore = lambda: self.platform.calls.append("restore-stop")
        self.platform.unchanged_previous = lambda previous: failure == "snapshot"
        locked = False
        @contextmanager
        def package_lock():
            nonlocal locked
            self.assertFalse(locked)
            locked = True
            try:
                yield
            finally:
                locked = False
        def require_lock():
            self.assertTrue(locked, "Restoration work must retain the final package locks")
        self.platform.package_lock = package_lock
        self.platform.package_health = require_lock
        original_ready, original_commit = self.platform.ready, self.platform.commit
        self.platform.ready = lambda record: (require_lock(), original_ready(record))
        self.platform.commit = lambda record: (require_lock(), original_commit(record))
        self.platform.restore_packages = lambda record, packages: self.platform.calls.append("restore-apt")
        self.platform.restore_data = lambda backup, state, persist: self.platform.calls.append("restore-data") or "/fixture/failed-trial"
        def start(record):
            require_lock()
            context = self.engine.context()
            self.assertEqual(context["phase"], "trial")
            self.assertEqual(context["version"], self.previous["version"])
            self.assertEqual(context["nonce"], record["nonce"])
            self.assertNotEqual(context["nonce"], self.engine.record["nonce"])
            self.platform.calls.append("restore-trial")
        self.platform.start_restored_trial = start
        patch.object(recovery, "installed", side_effect=lambda: (require_lock(), self.previous)[1]).start()
        return self.engine.record["updateId"]

    def test_checkpoint_failure_without_backup_can_resume_verified_unchanged_previous(self):
        update_id = self.prepare_recovery("snapshot")
        self.assertFalse((self.storage.root / "backups").exists())
        result = recovery.restore(self.engine, update_id)
        self.assertEqual(result["phase"], "restored")
        self.assertEqual(result["restoredVersion"], self.previous["version"])
        self.assertNotIn("restore-apt", self.platform.calls)
        self.assertNotIn("restore-data", self.platform.calls)
        self.assertIsNone(self.storage.read("active.json"))
        self.assertIsNone(self.engine.context())

    def test_failed_trial_restores_packages_and_snapshot_before_previous_readiness(self):
        update_id = self.prepare_recovery("readiness")
        with patch.object(recovery, "verify_backup", return_value={}):
            result = recovery.restore(self.engine, update_id)
        self.assertEqual(result["phase"], "restored")
        calls = self.platform.calls
        self.assertLess(calls.index("restore-apt"), calls.index("restore-data"))
        self.assertLess(calls.index("restore-data"), calls.index("restore-trial"))
        self.assertTrue(self.engine.record["committed"])
        self.assertEqual(self.storage.current(b"fixture"), self.previous)

    def test_incomplete_snapshot_or_changed_pre_hook_installation_never_guesses_restoration(self):
        update_id = self.prepare_recovery("snapshot")
        self.platform.unchanged_previous = lambda previous: False
        result = recovery.restore(self.engine, update_id)
        self.assertEqual(result["phase"], "operator-required")
        self.assertNotIn("restore-apt", self.platform.calls)
        self.assertNotIn("restore-trial", self.platform.calls)

    def test_committed_data_and_wrong_transaction_id_cannot_be_restored(self):
        update_id = self.prepare_recovery("readiness")
        with self.assertRaises(receipt.Rejected):
            recovery.restore(self.engine, "0" * 32)
        self.engine.record["committed"] = True
        with self.assertRaisesRegex(receipt.Rejected, "Committed data"):
            recovery.restore(self.engine, update_id)
        self.assertNotIn("restore-stop", self.platform.calls)

    def test_restoration_rechecks_identity_and_package_health_under_final_lock(self):
        update_id = self.prepare_recovery("snapshot")
        self.platform.package_health = lambda: (_ for _ in ()).throw(receipt.Rejected("unhealthy"))
        self.assertEqual(recovery.restore(self.engine, update_id)["phase"], "operator-required")
        self.assertNotIn("restore-trial", self.platform.calls)
        self.platform.package_health = lambda: None
        with patch.object(recovery, "installed", return_value={**self.previous, "revision": "0" * 40}):
            self.assertEqual(recovery.restore(self.engine, update_id)["phase"], "operator-required")
        self.assertNotIn("restore-trial", self.platform.calls)

    def test_enable_requires_current_manual_capability_and_no_active_transaction(self):
        calls = []
        flag = SimpleNamespace(parent=SimpleNamespace(lstat=lambda: SimpleNamespace(st_mode=0o40755, st_uid=0)))
        with patch.object(operator_client, "FLAG", flag), patch.object(operator_client, "enrolled_key", return_value=b"fixture"), patch.object(operator_client, "installed", return_value={**self.previous, "maintenanceProtocol": "maintenance-v1"}) as build, patch.object(operator_client, "run", side_effect=lambda *args: calls.append(args) or ""), patch.object(operator_client, "trusted_file", return_value=b"fixture"), patch.object(operator_client, "save", side_effect=lambda *args: calls.append(("flag",))), patch.object(operator_client, "Ubuntu") as platform:
            build.return_value = self.previous
            with self.assertRaisesRegex(receipt.Rejected, "manual-update-capable"):
                operator_client.enable(self.storage)
            self.assertEqual(calls, [])
            build.return_value = {**self.previous, "maintenanceProtocol": "maintenance-v1"}
            for value in (True, 1.0):
                build.return_value = {**self.previous, "maintenanceProtocol": "maintenance-v1", "dataFormat": value}
                with self.assertRaisesRegex(receipt.Rejected, "manual-update-capable"):
                    operator_client.enable(self.storage)
                build.return_value = {**self.previous, "maintenanceProtocol": "maintenance-v1"}
                with patch.object(self.storage, "current", return_value={**self.previous, "dataFormat": value}), self.assertRaisesRegex(receipt.Rejected, "manual-update-capable"):
                    operator_client.enable(self.storage)
            self.engine.submit(self.request)
            with self.assertRaisesRegex(receipt.Rejected, "active transaction"):
                operator_client.enable(self.storage)
            self.assertEqual(calls, [])
            self.engine.clear_active()
            self.assertEqual(operator_client.enable(self.storage)["phoneUpdates"], "enabled")
            self.assertEqual(calls, [("/usr/bin/dpkg", "--audit"), ("flag",), ("/usr/bin/systemctl", "enable", "--now", "couch-updater.socket")])
            platform.return_value.systemctl.assert_called_once_with("restart", "couch-tv.service")

    def test_failed_restore_rpc_and_cli_report_failure_with_durable_state(self):
        update_id = self.prepare_recovery("snapshot")
        self.platform.unchanged_previous = lambda previous: False
        replies = []
        peer = SimpleNamespace(
            getsockopt=lambda *args: struct.pack("3i", 1, 0, 0), settimeout=lambda value: None,
            recv=lambda count: json.dumps({"op": "restore", "updateId": update_id}).encode() + b"\n",
            sendall=lambda data: replies.append(json.loads(data)),
        )
        with patch.object(serve.socket, "SO_PEERCRED", 17, create=True):
            serve.Handler(peer, "fixture", SimpleNamespace(app_uid=0, transactions=self.engine))
        self.assertFalse(replies[0]["ok"])
        self.assertEqual(self.storage.read("active.json")["phase"], "operator-required")
        path = Path(__file__).resolve().parents[1] / "packaging/appliance/root/usr/sbin/couch-update"
        cli_spec = importlib.util.spec_from_loader("operator_cli", SourceFileLoader("operator_cli", str(path)))
        cli = importlib.util.module_from_spec(cli_spec)
        cli_spec.loader.exec_module(cli)
        with patch.object(cli.os, "geteuid", return_value=0), patch.object(cli, "Retention", return_value=self.storage), patch.object(cli, "request", side_effect=receipt.Rejected(replies[0]["error"])), patch.object(cli.sys, "argv", ["couch-update", "restore", update_id]), redirect_stderr(io.StringIO()):
            self.assertEqual(cli.main(), 1)

    def test_operator_client_rejects_incomplete_or_mismatched_success_receipts(self):
        for transaction in ({"phase": "operator-required", "updateId": "a" * 32}, {"phase": "restored", "updateId": "b" * 32}):
            with self.subTest(transaction=transaction), patch.object(operator_client, "run"), patch.object(operator_client.socket, "SO_PEERCRED", 17, create=True), patch.object(operator_client.socket, "socket") as connect:
                peer = connect.return_value.__enter__.return_value
                peer.getsockopt.return_value = struct.pack("3i", 1, 0, 0)
                peer.recv.return_value = json.dumps({"ok": True, "transaction": transaction}).encode() + b"\n"
                with self.assertRaisesRegex(receipt.Rejected, "matching completed"):
                    operator_client.request({"op": "restore", "updateId": "a" * 32})

    def test_activation_status_rejects_unsafe_or_invalid_flags(self):
        flag = self.root / "enabled"
        lstat = Path.lstat
        parent = SimpleNamespace(st_mode=0o40755, st_uid=0)
        with patch.object(operator_client, "FLAG", flag), patch.object(Path, "lstat", autospec=True, side_effect=lambda path: parent if path == flag.parent else lstat(path)):
            self.assertEqual(operator_client.activation_status(), "disabled")
            flag.symlink_to(self.root / "missing")
            with self.assertRaises(OSError):
                operator_client.activation_status()
            flag.unlink()
            save(flag, {"protocol": "maintenance-v1"})
            for uid, mode in ((1000, 0o100644), (0, 0o100666), (0, 0o040755)):
                with patch.object(receipt.os, "fstat", return_value=SimpleNamespace(st_uid=uid, st_mode=mode)), self.assertRaises(receipt.Rejected):
                    operator_client.activation_status()
            with patch.object(receipt.os, "fstat", return_value=SimpleNamespace(st_uid=0, st_mode=0o100644)):
                self.assertEqual(operator_client.activation_status(), "enabled")
                for uid, mode in ((1000, 0o40755), (0, 0o40777), (0, 0o120755)):
                    parent.st_uid, parent.st_mode = uid, mode
                    with self.assertRaisesRegex(receipt.Rejected, "configuration directory"):
                        operator_client.activation_status()
                parent.st_uid, parent.st_mode = 0, 0o40755
                save(flag, {"protocol": "unsupported"})
                with self.assertRaisesRegex(receipt.Rejected, "activation flag"):
                    operator_client.activation_status()

    def test_private_context_contains_nonce_but_public_status_never_does(self):
        self.assertIsNone(self.engine.context())
        self.engine.submit(self.request)
        context = self.engine.context()
        self.assertEqual(context["nonce"], self.engine.record["nonce"])
        self.assertEqual(context["updateId"], self.engine.record["updateId"])
        self.assertNotIn("nonce", self.engine.status())
        self.assertNotIn("nonce", self.engine.status(self.request["requestId"]))
        context["nonce"] = "forged"
        self.assertNotEqual(self.engine.context()["nonce"], "forged")
        self.engine.execute()
        self.assertIsNone(self.engine.context())

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

    def test_restart_before_authenticated_hook_keeps_unchanged_playback_running(self):
        self.request["confirmInterrupt"] = False
        self.engine.submit(self.request)
        self.engine.transition("installing", previous=self.previous)
        self.platform.unchanged_previous = lambda previous: previous == self.previous
        restarted = Transactions(self.storage, self.platform, lambda: b"fixture")
        self.assertEqual(restarted.status()["phase"], "failed")
        self.assertFalse(restarted.record["recoveryPending"])
        self.assertIsNone(restarted.context())
        self.assertEqual(self.platform.calls, [])
        self.assertEqual(self.storage.current(b"fixture"), self.previous)

    def test_restart_before_hook_keeps_changed_or_locked_packages_fenced_without_recovery(self):
        for changed in (False, receipt.Rejected("package manager busy")):
            with self.subTest(changed=changed):
                self.engine.submit(self.request)
                self.engine.transition("installing", previous=self.previous)
                with patch.object(self.platform, "unchanged_previous", create=True, side_effect=changed if isinstance(changed, Exception) else None, return_value=changed):
                    restarted = Transactions(self.storage, self.platform, lambda: b"fixture")
                self.assertEqual(restarted.status()["phase"], "operator-required")
                self.assertFalse(restarted.record["recoveryPending"])
                self.assertIsNotNone(restarted.context())
                self.assertEqual(self.platform.calls, [])
                with self.assertRaises(receipt.Rejected):
                    restarted.submit({**self.request, "requestId": "b" * 32})

    def test_restart_preserves_terminal_journal_before_active_marker_cleanup(self):
        for phase in ("succeeded", "restored", "failed"):
            for stale in (False, True):
                with self.subTest(phase=phase, stale_marker=stale):
                    self.engine.record = {**self.request, "updateId": "c" * 32, "phase": "trial", "committed": False}
                    self.engine.persist()
                    marker = self.storage.read("active.json")
                    self.engine.transition(phase, committed=phase != "failed")
                    if stale:
                        save(self.storage.root / "active.json", marker)
                    journal = (self.engine.directory / (self.request["requestId"] + ".json")).read_bytes()
                    restarted = Transactions(self.storage, self.platform)
                    self.assertEqual(restarted.status()["phase"], phase)
                    self.assertIsNone(restarted.context())
                    self.assertIsNone(self.storage.read("active.json"))
                    self.assertEqual((self.engine.directory / (self.request["requestId"] + ".json")).read_bytes(), journal)

    def test_restart_uses_journal_commit_boundary_even_when_marker_is_stale(self):
        self.engine.submit(self.request)
        marker = self.storage.read("active.json")
        self.engine.transition("committing", committed=True, disrupted=True)
        save(self.storage.root / "active.json", marker)
        restarted = Transactions(self.storage, self.platform)
        self.assertEqual(restarted.status()["phase"], "operator-required")
        self.assertTrue(restarted.record["committed"])
        with self.assertRaisesRegex(receipt.Rejected, "Committed data"):
            recovery.restore(restarted, restarted.record["updateId"])

    def test_restart_recovers_journal_written_before_first_active_marker(self):
        self.engine.submit(self.request)
        self.engine.clear_active()
        restarted = Transactions(self.storage, self.platform)
        self.assertEqual(restarted.status()["phase"], "failed")
        self.assertIsNone(self.storage.read("active.json"))

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

    def test_changed_installation_inside_apt_lock_fails_before_quiesce(self):
        self.platform.failure = "current-changed"
        self.engine.submit(self.request)
        self.engine.execute()
        self.assertEqual(self.platform.calls, ["preflight", "apt-lock"])
        self.assertFalse(self.engine.record["disrupted"])
        self.assertEqual(self.engine.status()["phase"], "failed")
        self.assertEqual(self.storage.current(b"fixture"), self.previous)

    def test_late_quiesce_cannot_overwrite_apt_failure(self):
        entered, release = threading.Event(), threading.Event()
        failures = []
        def hook():
            try:
                self.engine.hook(self.engine.record["updateId"])
            except receipt.Rejected as error:
                failures.append(error)
        worker = threading.Thread(target=hook)
        def install(record, packages):
            worker.start()
            self.assertTrue(entered.wait(2))
            raise receipt.Rejected("APT process exited during quiesce")
        def quiesce(record):
            entered.set()
            release.wait(2)
        self.platform.install, self.platform.quiesce = install, quiesce
        self.engine.submit(self.request)
        try:
            self.engine.execute()
            self.assertEqual(self.engine.status()["phase"], "operator-required")
        finally:
            release.set()
            worker.join(2)
        self.assertFalse(worker.is_alive())
        self.assertEqual(len(failures), 1)
        self.assertEqual(self.engine.status()["phase"], "operator-required")
        self.assertFalse(self.engine.record["hookComplete"])

    def test_idle_request_cannot_authorize_playback_interruption(self):
        for value in (False, "true", True):
            with self.assertRaises(receipt.Rejected):
                self.engine.submit({**self.request, "whenIdle": value, "confirmInterrupt": True})
        self.assertIsNone(self.engine.status())

    def test_idle_refusal_aborts_before_dpkg_without_recovery_or_service_stop(self):
        self.request.update(whenIdle=True, confirmInterrupt=False)
        self.platform.quiesce = lambda record: (_ for _ in ()).throw(receipt.IdleDeferred("new controller input"))
        self.engine.submit(self.request)
        with patch.object(recovery, "restore") as restoring:
            self.engine.execute()
            restoring.assert_not_called()
        self.assertEqual(self.engine.status()["phase"], "failed")
        self.assertTrue(self.engine.status()["idleDeferred"])
        self.assertFalse(self.engine.record["disrupted"])
        self.assertFalse(self.engine.record["hookComplete"])
        self.assertEqual(self.platform.calls, ["preflight", "apt-lock"])
        self.assertIsNone(self.storage.read("active.json"))
        self.assertEqual(self.storage.current(b"fixture"), self.previous)
        with self.assertRaises(receipt.Rejected):
            self.engine.submit({key: value for key, value in self.request.items() if key != "whenIdle"})

    def test_late_authenticated_idle_refusal_cancels_pending_recovery_after_apt_exits(self):
        entered, release = threading.Event(), threading.Event()
        errors = []
        def hook():
            try: self.engine.hook(self.engine.record["updateId"])
            except receipt.IdleDeferred as error: errors.append(error)
        hook_thread = threading.Thread(target=hook)
        def install(record, packages):
            hook_thread.start()
            self.assertTrue(entered.wait(2))
            raise receipt.Rejected("APT exited while awaiting idle admission")
        def quiesce(record):
            entered.set()
            self.assertTrue(release.wait(2))
            raise receipt.IdleDeferred("Idle admission was never closed")
        self.request.update(whenIdle=True, confirmInterrupt=False)
        self.platform.install, self.platform.quiesce = install, quiesce
        self.engine.submit(self.request)
        execution = threading.Thread(target=self.engine.execute)
        with patch("transactions.HOOK_DRAIN_SECONDS", 2), patch.object(recovery, "restore") as restoring:
            execution.start()
            try:
                self.assertTrue(entered.wait(2))
                deadline = time.monotonic() + 2
                while self.engine.record["phase"] != "operator-required" and time.monotonic() < deadline:
                    time.sleep(0.001)
                self.assertEqual(self.engine.record["phase"], "operator-required")
            finally:
                release.set(); hook_thread.join(2); execution.join(2)
            restoring.assert_not_called()
        self.assertFalse(execution.is_alive()); self.assertFalse(hook_thread.is_alive())
        self.assertEqual(len(errors), 1)
        self.assertEqual(self.engine.status()["phase"], "failed")
        self.assertTrue(self.engine.status()["idleDeferred"])
        self.assertFalse(self.engine.record["disrupted"])
        self.assertIsNone(self.storage.read("active.json"))

    def test_only_an_idle_transaction_accepts_authenticated_no_admission_deferral(self):
        platform = Ubuntu.__new__(Ubuntu)
        platform.coordinator = lambda *args: {"idleDeferred": True, "admissionClosed": False}
        platform.systemctl = lambda *args: self.fail("A refused idle admission must not stop the service")
        with self.assertRaises(receipt.IdleDeferred): platform.quiesce({"whenIdle": True})
        with self.assertRaises(receipt.Rejected) as failure: platform.quiesce({})
        self.assertNotIsInstance(failure.exception, receipt.IdleDeferred)

    def test_quiesce_completion_rechecks_live_apt_ancestry(self):
        authorizations = []
        def authorize(peer_pid):
            authorizations.append(peer_pid)
            if len(authorizations) == 2:
                raise receipt.Rejected("APT exited while stopping the app")
        self.platform.authorize_hook = authorize
        self.engine.submit(self.request)
        self.engine.execute()
        self.assertEqual(len(authorizations), 2)
        self.assertEqual(self.engine.status()["phase"], "operator-required")
        self.assertFalse(self.engine.record["hookComplete"])
        self.assertNotIn("dpkg", self.platform.calls)

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
        clock = SimpleNamespace(now=0)
        clock.monotonic = lambda: clock.now
        clock.sleep = lambda _: setattr(clock, "now", 91)
        original_clock = time.monotonic
        with patch.object(ubuntu, "time", clock):
            with self.assertRaisesRegex(receipt.Rejected, "bounded startup trial"):
                platform.ready(record)
            self.assertIs(time.monotonic, original_clock)

    def test_readiness_request_uses_remaining_trial_budget(self):
        platform = Ubuntu.__new__(Ubuntu)
        timeouts = []
        def coordinator(operation, record, timeout):
            timeouts.append(timeout)
            raise receipt.Rejected("Not ready")
        platform.coordinator = coordinator
        clock = SimpleNamespace(now=0)
        clock.monotonic = lambda: clock.now
        clock.sleep = lambda _: setattr(clock, "now", 91)
        def monotonic():
            value = clock.now
            clock.now = 89
            return value
        clock.monotonic = monotonic
        record = {"version": "new", "revision": "a" * 40, "dataFormat": 1}
        with patch.object(ubuntu, "time", clock), self.assertRaises(receipt.Rejected):
            platform.ready(record)
        self.assertEqual(timeouts, [1])


class SocketTests(unittest.TestCase):
    def test_slow_coordinator_cannot_extend_total_request_deadline(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = str(Path(temporary) / "maintenance.sock")
            stop = threading.Event()
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as listener:
                listener.bind(path)
                listener.listen(1)
                def drip():
                    with listener.accept()[0] as peer:
                        peer.recv(4096)
                        for _ in range(20):
                            if stop.wait(0.025):
                                return
                            try:
                                peer.sendall(b" ")
                            except OSError:
                                return
                thread = threading.Thread(target=drip)
                thread.start()
                start = time.monotonic()
                try:
                    with self.assertRaises(receipt.Rejected):
                        maintenance.request({"nonce": "fixture"}, path, timeout=0.1)
                    self.assertLess(time.monotonic() - start, 0.4)
                finally:
                    stop.set()
                    thread.join(2)

    def test_slow_client_cannot_extend_worker_ingestion_deadline(self):
        finished = threading.Event()
        client, worker = socket.socketpair()
        class Peer:
            def getsockopt(self, *args):
                return struct.pack("3i", 1, 0, 0)
            def __getattr__(self, name):
                return getattr(worker, name)
        def handle():
            try:
                serve.Handler(Peer(), "fixture", SimpleNamespace(app_uid=0))
            finally:
                worker.close()
                finished.set()
        with client, patch.object(serve.Handler, "request_timeout", 0.1), patch.object(serve.socket, "SO_PEERCRED", 17, create=True):
            thread = threading.Thread(target=handle)
            thread.start()
            start = time.monotonic()
            try:
                while not finished.wait(0.025) and time.monotonic() - start < 0.5:
                    try:
                        client.sendall(b" ")
                    except OSError:
                        break
                self.assertTrue(finished.wait(0.1))
                self.assertLess(time.monotonic() - start, 0.4)
            finally:
                client.close()
                thread.join(2)

    def test_live_handlers_are_bounded_and_slots_are_released(self):
        release, changed = threading.Event(), threading.Condition()
        entered = []
        class BlockingHandler(socketserver.BaseRequestHandler):
            def handle(self):
                with changed:
                    entered.append(True)
                    changed.notify_all()
                release.wait(2)
        class TwoHandlers(serve.Server):
            max_handlers = 2
        with tempfile.TemporaryDirectory() as temporary, TwoHandlers(str(Path(temporary) / "worker.sock"), BlockingHandler) as server:
            thread = threading.Thread(target=server.serve_forever)
            thread.start()
            clients = []
            try:
                for _ in range(2):
                    client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                    client.connect(server.server_address)
                    clients.append(client)
                with changed:
                    self.assertTrue(changed.wait_for(lambda: len(entered) == 2, 1))
                with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as extra:
                    extra.settimeout(0.5)
                    extra.connect(server.server_address)
                    self.assertEqual(extra.recv(1), b"")
                self.assertEqual(len(entered), 2)
                release.set()
                for client in clients:
                    client.settimeout(0.5)
                    self.assertEqual(client.recv(1), b"")
                self.assertTrue(server.slots.acquire(timeout=1))
                server.slots.release()
                with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as next_client:
                    next_client.connect(server.server_address)
                    with changed:
                        self.assertTrue(changed.wait_for(lambda: len(entered) == 3, 1))
            finally:
                release.set()
                for client in clients:
                    client.close()
                server.shutdown()
                thread.join(2)


class BridgeTests(unittest.TestCase):
    def test_forged_peer_and_oversized_frames_are_rejected(self):
        connection = SimpleNamespace(getsockopt=lambda *args: struct.pack("3i", 10, 123, 123))
        with patch.object(socket, "SO_PEERCRED", 17, create=True):
            with self.assertRaisesRegex(ValueError, "Unexpected local peer"):
                bridge.peer(connection, 0)
        with self.assertRaisesRegex(ValueError, "Oversized"):
            bridge.frame({"nonce": "a" * 65536})

    @unittest.skipUnless(hasattr(socket, "SO_PEERCRED"), "Linux peer credentials")
    def test_real_socket_peer_cannot_impersonate_another_uid(self):
        first, second = socket.socketpair()
        with first, second:
            bridge.peer(first, os.getuid())
            with self.assertRaisesRegex(ValueError, "Unexpected local peer"):
                bridge.peer(first, os.getuid() + 1)

    def test_private_bridge_correlates_replies_and_rejects_late_duplicate(self):
        with tempfile.TemporaryDirectory() as directory:
            listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            listener.bind(directory + "/bridge.sock")
            listener.listen(1)
            source, writer = os.pipe()
            reader, sink = os.pipe()
            instance = bridge.Bridge(listener, source, sink)
            failures = []
            def run():
                try:
                    instance.run()
                except Exception as error:
                    failures.append(error)
                finally:
                    instance.close()
            def receive():
                self.assertTrue(select.select([reader], [], [], 1)[0], "Bridge reply deadline")
                return json.loads(os.read(reader, 65536))
            thread = threading.Thread(target=run)
            try:
                with patch.object(bridge, "peer"):
                    thread.start()
                    self.assertEqual(receive(), {"kind": "ready"})
                    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as root:
                        root.settimeout(1)
                        root.connect(directory + "/bridge.sock")
                        root.sendall(bridge.frame({"op": "readiness", "nonce": "private"}))
                        request = receive()
                        self.assertEqual(request["kind"], "request")
                        reply = {"kind": "reply", "id": request["id"], "payload": {"ok": True, "nonce": "private"}}
                        os.write(writer, bridge.frame(reply))
                        self.assertEqual(json.loads(root.recv(65536)), reply["payload"])
                        os.write(writer, bridge.frame(reply))
                        thread.join(1)
                        self.assertFalse(thread.is_alive())
                        self.assertRegex(str(failures[0]), "Unmatched private reply")
            finally:
                os.close(writer)
                thread.join(1)
                listener.close()
                for descriptor in (source, reader, sink):
                    os.close(descriptor)
                self.assertFalse(thread.is_alive())


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

    def test_modified_snapshot_is_rejected_before_restoration(self):
        backup = self.root / "backup"
        maintenance.snapshot(self.data, backup)
        (backup / "data/preferences.json").write_text("modified")
        with self.assertRaisesRegex(receipt.Rejected, "verification"):
            recovery.verify_backup(backup)
        self.assertEqual((self.data / "preferences.json").read_text(), '{"unchanged":true}')

    @unittest.skipUnless(Path("/proc/self/fd").exists(), "Linux descriptor-pinned restoration")
    def test_restoration_preserves_previous_data_ownership_and_external_media(self):
        outside = self.root / "media"
        outside.mkdir()
        (outside / "movie").write_bytes(b"external media")
        (self.data / "media").symlink_to(outside, target_is_directory=True)
        backup = self.root / "backup"
        maintenance.snapshot(self.data, backup)
        self.database.close()
        (self.data / "preferences.json").write_text("failed trial")
        previous_mode = self.data.stat().st_mode & 0o777
        failed = Path(recovery.restore_data(self.data, backup, {"nonce": "a" * 32}, lambda: None))
        self.assertEqual((self.data / "preferences.json").read_text(), '{"unchanged":true}')
        self.assertEqual((failed / "preferences.json").read_text(), "failed trial")
        self.assertEqual(self.data.stat().st_mode & 0o777, previous_mode)
        self.assertEqual(self.data.stat().st_uid, os.geteuid())
        self.assertTrue((self.data / "media").is_symlink())
        self.assertEqual((outside / "movie").read_bytes(), b"external media")
        stages = list(self.root.glob(".couch-restore-*"))
        self.assertEqual(len(stages), 1)
        self.assertEqual(list(stages[0].iterdir()), [])

    def test_space_failure_does_not_touch_live_data_or_leave_partial_backup(self):
        with patch.object(maintenance.shutil, "disk_usage", return_value=shutil._ntuple_diskusage(100, 100, 0)), self.assertRaises(receipt.Rejected):
            maintenance.snapshot(self.data, self.root / "backup")
        self.assertFalse((self.root / "backup").exists())
        self.assertEqual(self.database.execute("SELECT value FROM preserved").fetchall(), [("pairing and progress",)])


def load_tests(loader, tests, pattern):
    # The existing CI entry point owns both suites. Importing its fixtures from
    # the standalone recovery script does not invoke unittest discovery.
    recovery_spec = importlib.util.spec_from_file_location("recovery_tests", Path(__file__).with_name("test-update-recovery.py"))
    recovery_tests = importlib.util.module_from_spec(recovery_spec)
    recovery_spec.loader.exec_module(recovery_tests)
    return unittest.TestSuite((tests, loader.loadTestsFromModule(recovery_tests)))


if __name__ == "__main__":
    unittest.main()
