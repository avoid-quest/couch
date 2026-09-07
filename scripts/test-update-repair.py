#!/usr/bin/env python3
"""Exact-current repair contracts; APT, signing and service calls are doubles here."""
from contextlib import contextmanager, nullcontext
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import socket
import socketserver
import select
import struct
import threading
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
import serve
import operator_client
import worker
import bridge


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
        self.assertEqual(self.engine.status()["error"], "Package tool smoke failed")
        self.assertEqual(self.platform.restores, 1)
        fixtures.RecoveryTests.preserved(self)
        self.assertEqual({str(path): path.read_bytes() for path in self.stages.rglob("*") if path.is_file()}, staged)
        restarted = fixtures.transactions.Transactions(self.storage, self.platform, lambda: b"fixture")
        self.assertEqual(restarted.status()["phase"], "restored")
        self.assertEqual(restarted.status()["error"], "Package tool smoke failed")
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
        timeouts = []
        platform.coordinator = lambda operation, record, timeout: timeouts.append(timeout) or result
        clock = SimpleNamespace(now=0)
        clock.monotonic = lambda: clock.now
        clock.sleep = lambda _: setattr(clock, "now", 91)
        with patch.object(ubuntu, "time", clock), self.assertRaises(receipt.Rejected): platform.ready(record)
        self.assertEqual(timeouts, [25])
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
        with patch.dict(sys.modules, {"apt": SimpleNamespace(Cache=lambda: cache)}), patch.object(system_packages, "Path") as path:
            path.return_value.exists.return_value = True
            path.return_value.stat.return_value.st_mtime = 1234
            self.assertEqual(system_packages.inspect()["indexUpdatedAt"], 1234000)
            path.assert_called_once_with("/var/lib/apt/periodic/update-stamp")


class WorkerLifetimeTests(unittest.TestCase):
    def test_terminal_latch_rejects_a_new_transaction_while_an_old_reply_drains(self):
        fixtures.fixtures.TransactionTests.setUp(self)
        self.platform.package_lock = nullcontext
        self.engine.submit(self.request)
        self.engine.execute()
        previous = dict(self.engine.record)
        with serve.Server(str(self.root / "listener"), serve.Handler) as server:
            server.transactions = self.engine
            server.app_uid = 0
            server.retire_enabled = True
            server.handlers = 1  # The previous terminal reply is still draining.
            responses = []
            payload = {"op": "repair-current", "expectedCurrentId": self.candidate_id, "requestId": "c" * 32, "confirmInterrupt": True, "repairRuntime": False}
            peer = SimpleNamespace(getsockopt=lambda *args: struct.pack("3i", 1, 0, 0), settimeout=lambda value: None, recv=lambda count: json.dumps(payload).encode() + b"\n", sendall=lambda data: responses.append(json.loads(data)))
            with patch.object(serve.socket, "SO_PEERCRED", 17, create=True): serve.Handler(peer, "fixture", server)
            self.assertFalse(responses[0]["ok"])
            self.assertIn("handing over", responses[0]["error"])
            self.assertTrue(server.retiring)
            self.assertEqual(self.engine.record, previous)
            self.assertFalse((self.engine.directory / ("c" * 32 + ".json")).exists())

    def test_retirement_reloads_even_if_a_previous_exit_already_removed_the_override(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(worker, "OVERRIDE", Path(directory) / "missing"), patch.object(worker, "run") as systemctl:
            worker.release(Path(directory), "a" * 32)
            systemctl.assert_called_once_with("/usr/bin/systemctl", "daemon-reload")

    def test_terminal_retirement_waits_for_the_reply_and_execution_thread(self):
        entered, reply, execution = threading.Event(), threading.Event(), threading.Event()
        finalized = []
        class Handler(socketserver.BaseRequestHandler):
            def handle(self):
                self.server.transactions.record = {"phase": "succeeded"}
                entered.set()
                if reply.wait(2): self.request.sendall(b"terminal receipt\n")
        with tempfile.TemporaryDirectory() as directory, serve.Server(directory + "/socket", Handler) as server:
            server.transactions = SimpleNamespace(record=None, mutex=threading.RLock())
            server.worker = threading.Thread(target=lambda: execution.wait(2))
            server.worker.start()
            thread = threading.Thread(target=lambda: server.serve_until_idle(lambda: finalized.append(True)))
            thread.start()
            try:
                with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                    client.settimeout(2); client.connect(server.server_address)
                    self.assertTrue(entered.wait(2))
                    self.assertEqual(finalized, [])
                    reply.set()
                    self.assertEqual(client.recv(1024), b"terminal receipt\n")
                    self.assertTrue(thread.is_alive())
                    self.assertEqual(finalized, [])
                execution.set(); server.worker.join(2); thread.join(2)
                self.assertFalse(thread.is_alive())
                self.assertEqual(finalized, [True])
            finally:
                reply.set(); execution.set(); server.worker.join(2); thread.join(2)

    def test_unresolved_and_installing_workers_do_not_retire(self):
        with tempfile.TemporaryDirectory() as directory, serve.Server(directory + "/socket", serve.Handler) as server:
            phases = iter(("installing", "quiescing", "trial", "operator-required", "restoring", "committing", "succeeded"))
            server.transactions = SimpleNamespace(record=None, mutex=threading.RLock())
            observed = []
            def next_phase():
                phase = next(phases)
                observed.append(phase)
                server.transactions.record = {"phase": phase}
            server.handle_request = next_phase
            server.serve_until_idle(lambda: self.assertEqual(observed[-1], "succeeded"))
            self.assertEqual(len(observed), 7)

    def test_frozen_startup_without_active_record_hands_queued_requests_to_fresh_code(self):
        with tempfile.TemporaryDirectory() as directory, serve.Server(directory + "/socket", serve.Handler) as server:
            server.transactions = SimpleNamespace(record=None, mutex=threading.RLock())
            finalized = []
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                client.settimeout(2); client.connect(server.server_address); client.sendall(b"queued status\n")
                server.serve_until_idle(lambda: finalized.append(True), retained_idle=True)
                self.assertEqual(finalized, [True])
                # The listening socket belongs to systemd, independent of the
                # retiring process. The fresh process can accept this same queue.
                with server.socket.accept()[0] as fresh:
                    self.assertEqual(fresh.recv(1024), b"queued status\n")
                    fresh.sendall(b"fresh repair capability\n")
                self.assertEqual(client.recv(1024), b"fresh repair capability\n")

    def test_main_marks_terminal_frozen_startup_for_handover_even_with_record_none(self):
        root = Path("/fixture/state")
        transaction = SimpleNamespace(record=None, context=lambda: None, platform=SimpleNamespace(release_worker=lambda record: released.append(record)))
        released = []
        with patch.object(serve.os, "geteuid", return_value=0), patch.object(serve.os, "umask"), patch.dict(serve.os.environ, {"LISTEN_PID": str(serve.os.getpid()), "LISTEN_FDS": "1"}), patch.object(serve, "Retention", return_value=SimpleNamespace(root=root)), patch.object(serve, "Ubuntu"), patch.object(serve, "Transactions", return_value=transaction), patch.object(serve, "__file__", str(root / "workers" / ("a" * 32) / "serve.py")), patch.object(serve, "Server") as factory, patch.object(serve.socket, "socket"), patch.object(serve.pwd, "getpwnam", return_value=SimpleNamespace(pw_uid=1000)):
            serve.main()
            finalize, retained_idle = factory.return_value.__enter__.return_value.serve_until_idle.call_args.args
            self.assertTrue(retained_idle)
            finalize()
        self.assertEqual(released, [{"updateId": "a" * 32}])


class WorkerRefreshTests(unittest.TestCase):
    def setUp(self):
        fixtures.fixtures.TransactionTests.setUp(self)
        self.locked = False
        @contextmanager
        def package_lock():
            self.locked = True
            try: yield
            finally: self.locked = False
        self.calls = []
        self.platform.package_lock = package_lock
        self.platform.package_health = lambda: self.assertTrue(self.locked)
        self.override = self.root / "override.conf"
        patch.object(worker, "OVERRIDE", self.override).start()
        patch.object(operator_client, "Ubuntu", return_value=self.platform).start()
        patch.object(operator_client, "activation_status", return_value="enabled").start()
        patch.object(operator_client, "enrolled_key", return_value=b"fixture").start()
        patch.object(operator_client, "installed", return_value=self.previous).start()
        patch.object(operator_client, "trusted_file", side_effect=lambda path: Path(path).read_bytes()).start()
        def run(*args):
            self.calls.append(args)
            if "start" in args:
                self.assertFalse(self.locked)
                with self.storage.lock(): pass
            else:
                self.assertTrue(self.locked)
                with self.assertRaises(receipt.Rejected), self.storage.lock(): pass
            return b""
        patch.object(operator_client, "run", side_effect=run).start()
        patch.object(worker, "run", side_effect=run).start()

    def rpc(self, payload):
        replies = []
        peer = SimpleNamespace(getsockopt=lambda *args: struct.pack("3i", 1, 0, 0), settimeout=lambda value: None, recv=lambda count: json.dumps(payload).encode() + b"\n", sendall=lambda data: replies.append(json.loads(data)))
        server = SimpleNamespace(app_uid=0, transactions=self.engine, worker=None)
        with patch.object(serve.socket, "SO_PEERCRED", 17, create=True): serve.Handler(peer, "fixture", server)
        if server.worker: server.worker.join(2)
        return replies[0]

    def test_explicit_old_worker_transition_restarts_only_its_existing_socket_after_locks_release(self):
        # Old worker status lacked current/repairCurrent and rejected repair.
        # The fixed operator transition is independent of that old RPC protocol.
        result = operator_client.refresh_worker(self.storage)
        self.assertEqual(result["worker"], "refreshed")
        self.assertEqual(self.calls, [("/usr/bin/systemctl", "is-active", "--quiet", "couch-updater.socket"), ("/usr/bin/systemctl", "stop", "couch-updater.socket", "couch-updater.service"), ("/usr/bin/systemctl", "daemon-reload"), ("/usr/bin/systemctl", "start", "couch-updater.socket")])
        status = self.rpc({"op": "status"})
        self.assertTrue(status["repairCurrent"])
        self.assertEqual(status["current"]["candidateId"], self.previous["candidateId"])
        request = {"op": "repair-current", "expectedCurrentId": self.previous["candidateId"], "requestId": "b" * 32, "confirmInterrupt": False, "repairRuntime": False}
        self.assertTrue(self.rpc(request)["ok"])
        self.assertEqual(self.engine.status()["phase"], "succeeded")

    def test_refresh_refuses_active_unhealthy_unenrolled_and_disabled_states_without_service_changes(self):
        fixtures.save(self.storage.root / "active.json", {"phase": "installing"})
        with self.assertRaisesRegex(receipt.Rejected, "active transaction"): operator_client.refresh_worker(self.storage)
        (self.storage.root / "active.json").unlink()
        for target, options in (("activation_status", {"return_value": "disabled"}), ("installed", {"return_value": {**self.previous, "revision": "0" * 40}})):
            with patch.object(operator_client, target, **options), self.assertRaises(receipt.Rejected): operator_client.refresh_worker(self.storage)
        self.platform.package_health = lambda: (_ for _ in ()).throw(receipt.Rejected("Interrupted package work"))
        with self.assertRaises(receipt.Rejected): operator_client.refresh_worker(self.storage)
        self.assertEqual(self.calls, [])


    def test_unmatched_override_is_not_stopped_or_removed(self):
        self.override.write_bytes(worker.configuration(self.storage.root, "c" * 32))
        with self.assertRaisesRegex(receipt.Rejected, "no matching terminal"): operator_client.refresh_worker(self.storage)
        self.assertTrue(self.override.exists())
        self.assertEqual(self.calls, [])

    def test_matching_terminal_override_is_removed_before_socket_reactivation(self):
        update_id = "c" * 32
        fixtures.save(self.engine.directory / ("c" * 32 + ".json"), {"phase": "restored", "updateId": update_id})
        self.override.write_bytes(worker.configuration(self.storage.root, update_id))
        with patch.object(worker, "trusted_file", side_effect=lambda path: Path(path).read_bytes()):
            operator_client.refresh_worker(self.storage)
        self.assertFalse(self.override.exists())
        self.assertIn(("/usr/bin/systemctl", "daemon-reload"), self.calls)
        self.assertEqual(self.calls[-1], ("/usr/bin/systemctl", "start", "couch-updater.socket"))

    def test_package_lock_failure_never_stops_the_worker(self):
        self.platform.package_lock = lambda: (_ for _ in ()).throw(receipt.Rejected("APT is active"))
        with self.assertRaisesRegex(receipt.Rejected, "APT is active"): operator_client.refresh_worker(self.storage)
        self.assertEqual(self.calls, [])


class BridgeHandoverTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.listener.bind(str(self.root / "maintenance")); self.listener.listen(1)
        self.source, self.writer = os.pipe()
        self.reader, self.sink = os.pipe()
        self.instance = bridge.Bridge(self.listener, self.source, self.sink)
        self.errors = []
        self.thread = threading.Thread(target=self.run_bridge)
        self.addCleanup(self.close)

    def run_bridge(self):
        try: self.instance.run()
        except Exception as error: self.errors.append(error)
        finally: self.instance.close()

    def close(self):
        os.close(self.writer)
        if self.thread.ident: self.thread.join(2)
        else: self.instance.close()
        self.listener.close()
        for descriptor in (self.source, self.reader, self.sink): os.close(descriptor)
        self.assertFalse(self.thread.is_alive())

    def receive(self):
        self.assertTrue(select.select([self.reader], [], [], 2)[0], "Private pipe reply deadline")
        return json.loads(os.read(self.reader, 65536))

    def send(self, value):
        os.write(self.writer, bridge.frame(value))

    def handover(self, payload):
        path = str(self.root / "worker")
        absent = threading.Event()
        connect = self.instance.open_worker
        def opening(token):
            if not Path(path).exists(): absent.set()
            connect(token)
        self.instance.open_worker = opening
        with patch.object(bridge, "WORKER", path), patch.object(bridge, "peer"):
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as old:
                old.bind(path); old.listen(1); old.settimeout(2)
                self.thread.start(); self.assertEqual(self.receive(), {"kind": "ready"})
                request = {"kind": "worker", "id": "a" * 32, "payload": payload}
                self.send(request)
                peer, _ = old.accept()
                peer.settimeout(2)
                self.assertEqual(json.loads(peer.recv(4096)), request["payload"])
                deadline = self.instance.connections[request["id"]]["deadline"]
                old.close(); Path(path).unlink(); peer.close()
                self.assertTrue(absent.wait(2), "The status reply must be lost during the socket gap")
                self.assertTrue(self.thread.is_alive()); self.assertEqual(self.errors, [])
                with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as fresh:
                    fresh.bind(path); fresh.listen(1); fresh.settimeout(2)
                    with fresh.accept()[0] as peer:
                        peer.settimeout(2)
                        self.assertEqual(json.loads(peer.recv(4096)), request["payload"])
                        self.assertEqual(self.instance.connections[request["id"]]["deadline"], deadline)
                        peer.sendall(bridge.frame({"ok": True, "transaction": None, "repairCurrent": True}))
                    result = self.receive()
                    self.assertEqual(result, {"kind": "result", "id": request["id"], "payload": {"ok": True, "transaction": None, "repairCurrent": True}})
                    self.send({**request, "id": "b" * 32, "payload": {"op": "context"}})
                    with fresh.accept()[0] as peer:
                        peer.settimeout(2)
                        self.assertEqual(json.loads(peer.recv(4096)), {"op": "context"})
                        peer.sendall(bridge.frame({"ok": True, "context": None}))
                    self.assertEqual(self.receive()["payload"], {"ok": True, "context": None})
            self.assertTrue(self.thread.is_alive()); self.assertEqual(self.errors, [])

    def test_inflight_status_survives_listener_removal_and_lost_reply_without_bridge_loss(self):
        self.handover({"op": "status"})

    def test_mutation_replay_keeps_the_exact_durable_request_identity_and_choices(self):
        self.handover({"op": "repair-current", "expectedCurrentId": "c" * 64, "requestId": "d" * 32, "confirmInterrupt": False, "repairRuntime": True})

    def test_transport_retry_has_one_absolute_budget_and_then_fails_closed(self):
        with patch.object(bridge, "WORKER", str(self.root / "missing")), patch.object(bridge, "WORKER_TIMEOUT", 0.2):
            self.thread.start(); self.receive()
            self.send({"kind": "worker", "id": "a" * 32, "payload": {"op": "status"}})
            self.thread.join(1)
            self.assertFalse(self.thread.is_alive())
            self.assertIsInstance(self.errors[0], TimeoutError)

    def test_complete_malformed_worker_reply_still_terminates_the_private_bridge(self):
        path = str(self.root / "worker")
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as root, patch.object(bridge, "WORKER", path), patch.object(bridge, "peer"):
            root.bind(path); root.listen(1); root.settimeout(2)
            self.thread.start(); self.receive()
            self.send({"kind": "worker", "id": "a" * 32, "payload": {"op": "status"}})
            with root.accept()[0] as peer:
                peer.recv(4096); peer.sendall(b"malformed JSON\n")
                self.thread.join(1)
            self.assertFalse(self.thread.is_alive())
            self.assertIsInstance(self.errors[0], ValueError)

    def test_unauthenticated_worker_peer_is_fatal_without_transport_retry(self):
        path = str(self.root / "worker")
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as root, patch.object(bridge, "WORKER", path), patch.object(bridge, "peer", side_effect=ValueError("Unexpected local peer")) as authenticate:
            root.bind(path); root.listen(1)
            self.thread.start(); self.receive()
            self.send({"kind": "worker", "id": "a" * 32, "payload": {"op": "status"}})
            self.thread.join(1)
            self.assertFalse(self.thread.is_alive())
            self.assertIsInstance(self.errors[0], ValueError)
            authenticate.assert_called_once()



if __name__ == "__main__":
    unittest.main()
