#!/usr/bin/env python3
"""Transaction and backup checks without system services or package mutations."""
import hashlib
import importlib.util
import json
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
