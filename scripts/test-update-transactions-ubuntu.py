#!/usr/bin/env python3
"""Disposable APT/worker proof with a coordinator fixture, never a real TV app."""
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import sqlite3
import subprocess
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest

spec = importlib.util.spec_from_file_location("fixtures", Path(__file__).with_name("test-update-retention.py"))
fixtures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixtures)
import maintenance
from retention import Retention, installed
from transactions import Transactions
from ubuntu import Ubuntu
from serve import Handler, Server
from receipt import Rejected


def run(*arguments):
    return subprocess.check_output(arguments, stderr=subprocess.DEVNULL)


def helper_bytes(name, version):
    # These tiny package-owned executables test real dpkg replacement only.
    # Actual yt-dlp/Deno smoke is qualified from the final Package artifacts.
    return f"#!/bin/sh\nprintf '%s\\n' '{name} {version}'\n".encode()


def call(request, disconnect=False):
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
        connection.settimeout(10)
        connection.connect("/run/couch-updater/control.sock")
        connection.sendall(json.dumps(request).encode() + b"\n")
        if disconnect:
            return
        return json.loads(connection.makefile("rb").readline(65536))


class CoordinatorFixture(Ubuntu):
    """Only session/native/browser operations are doubles; Ubuntu APT is real."""
    def __init__(self, root, data):
        self.root, self.data_path = root, data
        self.calls, self.bad_readiness, self.bad_checkpoint = [], False, False
        self.child = None
        self.apt_pid = None
        self.missing_dependency = None
        self.interruption_marker = None
        self.interrupted_audit = None
        self.defer_idle = False
        self.idle_install = threading.Event()
        self.idle_lock = threading.Event()

    def preserve_worker(self, record):
        pass

    def release_worker(self, record):
        pass

    def data(self):
        return self.data_path

    def coordinator(self, operation, record, timeout=5):
        self.calls.append(operation)
        if record.get("whenIdle") and self.defer_idle and operation in ("capabilities", "quiesce"):
            return {"idleDeferred": True, "admissionClosed": False}
        build = {key: installed()[key] for key in ("version", "revision", "dataFormat")}
        if operation == "capabilities":
            return {"nativeReadiness": "libmpv-v1", "build": build, "toolRepair": "package-smoke-v1"}
        if operation == "quiesce":
            return {"progressSaved": not self.bad_checkpoint, "admissionClosed": True}
        if operation == "readiness":
            if self.bad_readiness:
                # A valid response for an old build must never count as success.
                return {"build": {**build, "version": "0.1.0+build.1.1"}}
            proof = {}
            if record.get("intent") == "repair-current" and record["phase"] != "restoring":
                for name in ("yt-dlp", "deno"):
                    path = Path("/usr/lib/couch-fixture-tools") / name
                    if hashlib.sha256(path.read_bytes()).digest() != hashlib.sha256(helper_bytes(name, build["version"])).digest():
                        raise Rejected("Fixture package helper hash mismatch")
                    if subprocess.check_output([str(path)], timeout=2).decode().strip() != f'{name} {build["version"]}':
                        raise Rejected("Fixture package helper smoke mismatch")
                proof["toolRepair"] = "verified-v1"
            return {"build": build, "nativeBuild": build, "frontendBuild": build, "database": "ok", "nativeReadiness": "libmpv-v1", "frontendReady": True, **proof}
        if operation == "commit":
            return {"admissionOpen": True}
        raise AssertionError(operation)

    def systemctl(self, *arguments):
        if arguments[0] == "stop":
            self.calls.append("stop-fixture")
            if self.child:
                self.child.terminate()
                self.child.wait(timeout=5)
                self.child = None
            return ""
        if arguments[0] in ("start", "reset-failed", "mask", "unmask"):
            self.calls.append(arguments[0] + "-fixture")
            return ""
        if "--property=MainPID" in arguments:
            return "0"
        if "--property=ActiveState" in arguments:
            return "inactive"
        if "--property=ControlGroup" in arguments:
            return ""
        raise AssertionError(arguments)

    def ready(self, record):
        if self.bad_readiness:
            # Keep this fault bounded without waiting the production 90 seconds.
            from unittest.mock import patch
            clock = SimpleNamespace(now=0)
            clock.monotonic = lambda: clock.now
            clock.sleep = lambda _: setattr(clock, "now", 91)
            with patch("ubuntu.time", clock):
                return super().ready(record)
        return super().ready(record)

    def install(self, record, packages):
        if record.get("whenIdle"):
            self.idle_install.set()
            if not self.idle_lock.wait(10):
                raise AssertionError("Fixture did not acquire the final APT lock")
        if self.missing_dependency:
            # Remove a dependency after real simulate/download-only succeeded.
            self.missing_dependency.unlink()
            for path in Path("/var/cache/apt/archives").glob("couch-fixture-dependency*.deb"):
                path.unlink()
        try:
            return super().install(record, packages)
        except Rejected:
            if self.interruption_marker and self.interruption_marker.exists():
                # Recovery must use root retention even after staged downloads vanish.
                shutil.rmtree(self.data() / "updates/staged")
            raise

    def package_command(self, record, command, **options):
        if command[:2] == ["/usr/bin/dpkg", "--audit"] and self.interruption_marker:
            self.interrupted_audit = run("/usr/bin/dpkg", "--audit").decode()
        return super().package_command(record, command, **options)


class RealTransactions(unittest.TestCase):
    def test_unknown_protocol_and_wrong_nonce_on_real_socket(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = str(Path(temporary) / "maintenance.sock")
            for response in ({"protocol": "maintenance-v0", "nonce": "a", "ok": True}, {"protocol": "maintenance-v1", "nonce": "wrong", "ok": True}):
                with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as listener:
                    listener.bind(path)
                    listener.listen(1)
                    def reply():
                        with listener.accept()[0] as peer:
                            peer.recv(4096)
                            peer.sendall(json.dumps(response).encode() + b"\n")
                    thread = threading.Thread(target=reply)
                    thread.start()
                    try:
                        with self.assertRaises(Rejected):
                            maintenance.request({"nonce": "a"}, path, uid=0)
                    finally:
                        thread.join()
                Path(path).unlink()

    def test_real_apt_lock_hook_disconnect_and_failed_trial(self):
        with tempfile.TemporaryDirectory(prefix="couch-transaction-proof-") as temporary:
            root = Path(temporary)
            root.chmod(0o755)  # The disposable file repository is read by _apt.
            print("APT version:", run("apt-get", "--version").decode().splitlines()[0], flush=True)
            keys = root / "keys"
            keys.mkdir(mode=0o700)
            run("gpg", "--homedir", str(keys), "--batch", "--passphrase", "", "--quick-generate-key", "Couch disposable transaction fixture", "ed25519", "sign", "1d")
            public_key = run("gpg", "--homedir", str(keys), "--armor", "--export")
            receipts = [self.receipt(root, keys, number) for number in (1, 2, 3)]
            dependency = self.dependency(root)
            missing_receipt = self.receipt(root, keys, 4, "couch-fixture-dependency (= 1.0)")
            # The tools image excludes /usr/share/doc by default. Keep the two
            # fixture build identities, as the production package requires.
            Path("/etc/dpkg/dpkg.cfg.d/zz-couch-fixture").write_text("path-include=/usr/share/doc/couch\npath-include=/usr/share/doc/couch/*\npath-include=/usr/share/doc/couch-appliance\npath-include=/usr/share/doc/couch-appliance/*\n")
            run("apt-get", "-y", "--no-install-recommends", "install", *[str(path) for path in receipts[0].glob("*.deb")])
            data = root / "data"
            (data / "updates/staged").mkdir(parents=True)
            (data / "preferences.json").write_text('{"pairing":"fixture-only","preserved":true}')
            writer = root / "writer.py"
            writer.write_text("import sqlite3,time\nfrom pathlib import Path\ndb=sqlite3.connect(" + repr(str(data / "couch.sqlite")) + ")\ndb.execute('PRAGMA journal_mode=WAL')\ndb.execute('PRAGMA wal_autocheckpoint=0')\ndb.execute('CREATE TABLE progress (position INTEGER)')\ndb.execute('INSERT INTO progress VALUES (99)')\ndb.commit()\nPath(" + repr(str(root / "writer-ready")) + ").touch()\nwhile True: time.sleep(1)\n")
            platform = CoordinatorFixture(root / "state", data)
            platform.child = subprocess.Popen(["python3", str(writer)])
            self.addCleanup(lambda: platform.child and platform.child.kill())
            self.until(lambda: (root / "writer-ready").exists())
            storage = Retention(platform.root)
            storage.enroll(receipts[0], public_key)
            engine = Transactions(storage, platform, lambda: public_key)
            hook = Path("/usr/lib/couch-appliance/updater/hook.py")
            hook.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(Path(__file__).resolve().parents[1] / "packaging/appliance/root/usr/lib/couch-appliance/updater/hook.py", hook)
            Path("/run/couch-updater").mkdir(mode=0o755, exist_ok=True)
            with Server("/run/couch-updater/control.sock", Handler) as server:
                server.app_uid, server.transactions = 0, engine
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                try:
                    missing = self.stage(missing_receipt, data)
                    platform.missing_dependency = dependency
                    call({"op": "install", "candidateId": missing, "requestId": "d" * 32, "confirmInterrupt": True})
                    self.until(lambda: engine.status() and engine.status()["phase"] in ("failed", "operator-required", "succeeded"), 30)
                    server.worker.join(timeout=5)
                    self.assertFalse(server.worker.is_alive())
                    self.assertEqual(engine.status()["phase"], "failed", engine.status())
                    self.assertNotIn("quiesce", platform.calls)
                    self.assertIsNone(platform.child.poll())
                    self.assertEqual(installed()["version"], "0.1.0+build.1.1")
                    acquisition_log = (storage.root / "logs" / (engine.record["updateId"] + ".log")).read_text()
                    self.assertIn("Download complete and in download only mode", acquisition_log)
                    self.assertIn("Failed to fetch", acquisition_log)
                    print("Verified acquisition failure before quiesce:", engine.status(), flush=True)
                    platform.missing_dependency = None
                    candidate = self.stage(receipts[1], data)
                    request = {"op": "install", "candidateId": candidate, "requestId": "a" * 32, "confirmInterrupt": True}
                    with open("/var/lib/dpkg/lock-frontend", "w") as lock:
                        fcntl.lockf(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                        call(request, disconnect=True)
                        self.until(lambda: engine.record is not None and engine.record["requestId"] == request["requestId"])
                        update_id = engine.record["updateId"]
                        duplicate = call(request)
                        self.assertEqual(duplicate["transaction"]["updateId"], update_id)
                        time.sleep(1)
                        self.assertNotIn("quiesce", platform.calls)
                        self.assertIsNone(platform.child.poll())
                    self.until(lambda: engine.status()["phase"] in ("succeeded", "failed", "operator-required"), 60)
                    server.worker.join(timeout=5)
                    self.assertFalse(server.worker.is_alive())
                    self.assertEqual(engine.status()["phase"], "succeeded", engine.status())
                    self.assertEqual(installed()["version"], "0.1.0+build.2.1")
                    with sqlite3.connect(storage.root / "backups" / update_id / "data/couch.sqlite") as backup:
                        self.assertEqual(backup.execute("SELECT position FROM progress").fetchall(), [(99,)])
                    self.assertEqual((data / "preferences.json").read_text(), '{"pairing":"fixture-only","preserved":true}')
                    self.assertTrue(call({"op": "status", "requestId": "a" * 32})["ok"])
                    self.assertFalse(call({"op": "hook", "updateId": "f" * 32})["ok"])
                    second = self.stage(receipts[2], data)
                    signed = data / "updates/staged" / second / "InRelease"
                    original = signed.read_bytes()
                    signed.write_bytes(original.replace(b"Origin: Couch", b"Origin: forged"))
                    before = len(platform.calls)
                    call({"op": "install", "candidateId": second, "requestId": "b" * 32, "confirmInterrupt": True})
                    self.until(lambda: engine.status()["phase"] == "failed")
                    server.worker.join(timeout=5)
                    self.assertFalse(server.worker.is_alive())
                    self.assertEqual(len(platform.calls), before)
                    signed.write_bytes(original)
                    platform.bad_readiness = True
                    call({"op": "install", "candidateId": second, "requestId": "c" * 32, "confirmInterrupt": True})
                    self.until(lambda: engine.status()["phase"] in ("operator-required", "succeeded"), 60)
                    self.assertEqual(engine.status()["phase"], "operator-required")
                    self.assertFalse(storage.read("active.json")["committed"])
                    self.assertEqual(storage.current(public_key)["version"], "0.1.0+build.2.1")
                    self.assertEqual(installed()["version"], "0.1.0+build.2.1")
                    self.assertEqual(engine.record["automaticStarts"], 1)
                    self.assertTrue(engine.record["automaticFailed"])
                    print("Verified lock, frozen hook, disconnected caller, WAL backup and failed trial:", engine.status(), flush=True)
                    server.worker.join()
                    failed_id = engine.record["updateId"]
                    with sqlite3.connect(data / "couch.sqlite") as trial:
                        trial.execute("UPDATE progress SET position = 1234")
                    (data / "preferences.json").write_text('{"failedTrial":true}')
                    platform.bad_readiness = False
                    restored = call({"op": "restore", "updateId": failed_id})
                    self.assertTrue(restored["ok"], restored)
                    self.assertEqual(restored["transaction"]["phase"], "restored", restored)
                    self.assertEqual(installed()["version"], "0.1.0+build.2.1")
                    with sqlite3.connect(data / "couch.sqlite") as previous:
                        self.assertEqual(previous.execute("SELECT position FROM progress").fetchall(), [(99,)])
                    self.assertEqual((data / "preferences.json").read_text(), '{"pairing":"fixture-only","preserved":true}')
                    failed_data = Path(engine.record["failedTrialData"])
                    self.assertEqual((failed_data / "preferences.json").read_text(), '{"failedTrial":true}')
                    self.assertFalse(call({"op": "restore", "updateId": failed_id})["ok"])
                    platform.bad_checkpoint = True
                    platform.bad_readiness = True
                    candidate = self.stage(receipts[2], data)
                    call({"op": "install", "candidateId": candidate, "requestId": "e" * 32, "confirmInterrupt": True})
                    self.until(lambda: engine.status()["phase"] == "operator-required", 30)
                    server.worker.join()
                    checkpoint_id = engine.record["updateId"]
                    self.assertFalse(engine.record["hookComplete"])
                    self.assertFalse((storage.root / "backups" / checkpoint_id).exists())
                    self.assertEqual(installed()["version"], "0.1.0+build.2.1")
                    platform.bad_checkpoint = False
                    platform.bad_readiness = False
                    resumed = call({"op": "restore", "updateId": checkpoint_id})
                    self.assertEqual(resumed["transaction"]["phase"], "restored", resumed)
                    self.assertIsNone(storage.read("active.json"))
                    print("Verified authenticated package downgrade, saved data restoration, retained failed data, and unchanged-app resume without a snapshot.", flush=True)
                    platform.interruption_marker = root / "interrupted-dpkg-once"
                    interrupted_receipt = self.receipt(root, keys, 5, interrupt=platform.interruption_marker)
                    candidate = self.stage(interrupted_receipt, data)
                    call({"op": "install", "candidateId": candidate, "requestId": "f" * 32, "confirmInterrupt": True})
                    self.until(lambda: engine.status()["phase"] in ("restored", "operator-required", "failed", "succeeded"), 60)
                    server.worker.join()
                    self.assertEqual(engine.status()["phase"], "restored", engine.status())
                    self.assertTrue(platform.interruption_marker.exists())
                    self.assertTrue(platform.interrupted_audit, "Real interrupted dpkg must leave audited unfinished work")
                    self.assertEqual(engine.record["automaticStarts"], 1)
                    self.assertEqual(run("dpkg", "--audit").strip(), b"")
                    self.assertEqual(installed()["version"], "0.1.0+build.2.1")
                    self.assertFalse((data / "updates/staged").exists())
                    with sqlite3.connect(data / "couch.sqlite") as previous:
                        self.assertEqual(previous.execute("SELECT position FROM progress").fetchall(), [(99,)])
                    self.assertEqual((data / "preferences.json").read_text(), '{"pairing":"fixture-only","preserved":true}')
                    print("Verified real dpkg interruption, package-manager repair and automatic retained-package/snapshot recovery without staged downloads.", flush=True)
                    platform.interruption_marker = None
                    candidate = self.stage(receipts[2], data)
                    calls_before = len(platform.calls)
                    platform.child = subprocess.Popen(["/bin/sleep", "30"])
                    try:
                        call({"op": "install", "candidateId": candidate, "requestId": "0" * 32, "confirmInterrupt": False, "whenIdle": True})
                        self.assertTrue(platform.idle_install.wait(10))
                        with open("/var/lib/dpkg/lock-frontend", "w") as lock:
                            fcntl.lockf(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                            platform.idle_lock.set()
                            self.until(lambda: platform.apt_pid is not None)
                            time.sleep(1)
                            self.assertNotIn("quiesce", platform.calls[calls_before:])
                            self.assertIsNone(platform.child.poll())
                            # New controller activity arrives after preflight,
                            # while the final real APT process waits for its lock.
                            platform.defer_idle = True
                        self.until(lambda: engine.status()["phase"] in ("failed", "operator-required", "succeeded", "restored"), 30)
                        server.worker.join()
                        self.assertEqual(engine.status()["phase"], "failed", engine.status())
                        self.assertTrue(engine.status()["idleDeferred"])
                        self.assertFalse(engine.record["disrupted"])
                        self.assertFalse(engine.record["hookComplete"])
                        self.assertNotIn("automaticStarts", engine.record)
                        self.assertIn("quiesce", platform.calls[calls_before:])
                        self.assertNotIn("stop-fixture", platform.calls[calls_before:])
                        self.assertIsNone(platform.child.poll())
                        self.assertEqual(installed()["version"], "0.1.0+build.2.1")
                        self.assertIsNone(storage.read("active.json"))
                        print("Verified new activity during the actual APT lock wait defers without service stop, dpkg mutation or recovery.", flush=True)
                    finally:
                        platform.idle_lock.set()
                        if platform.child:
                            platform.child.terminate(); platform.child.wait(timeout=5); platform.child = None

                    staged = {str(path): path.read_bytes() for path in (data / "updates/staged").rglob("*") if path.is_file()}
                    current = storage.current(public_key)
                    preferences = (data / "preferences.json").read_bytes()
                    with sqlite3.connect(data / "couch.sqlite") as database:
                        database_before = database.execute("SELECT * FROM progress").fetchall()
                    (data / "custom-tool-override").write_text("administrator's separate executable")
                    Path("/usr/lib/couch-fixture-tools/yt-dlp").unlink()
                    Path("/usr/lib/couch-fixture-tools/deno").write_bytes(b"corrupt")
                    calls_before = len(platform.calls)
                    response = call({"op": "repair-current", "expectedCurrentId": current["candidateId"], "requestId": "1" * 32, "confirmInterrupt": True, "repairRuntime": False})
                    self.assertTrue(response["ok"], response)
                    self.until(lambda: engine.status()["phase"] in ("failed", "operator-required", "succeeded", "restored"), 30)
                    server.worker.join()
                    self.assertEqual(engine.status()["phase"], "succeeded", engine.status())
                    self.assertEqual(engine.status()["intent"], "repair-current")
                    self.assertIn("quiesce", platform.calls[calls_before:])
                    self.assertTrue(engine.record["hookComplete"])
                    self.assertEqual(storage.current(public_key), current)
                    self.assertEqual((data / "preferences.json").read_bytes(), preferences)
                    self.assertEqual((data / "custom-tool-override").read_text(), "administrator's separate executable")
                    with sqlite3.connect(data / "couch.sqlite") as database:
                        self.assertEqual(database.execute("SELECT * FROM progress").fetchall(), database_before)
                        self.assertEqual(database.execute("PRAGMA quick_check").fetchall(), [("ok",)])
                    self.assertEqual({str(path): path.read_bytes() for path in (data / "updates/staged").rglob("*") if path.is_file()}, staged)
                    for name in ("yt-dlp", "deno"):
                        path = Path("/usr/lib/couch-fixture-tools") / name
                        self.assertEqual(path.read_bytes(), helper_bytes(name, current["version"]))
                    self.assertIsNone(storage.read("active.json"))
                    print("Verified signed exact-current real APT --reinstall restores missing/corrupt dummy helpers; fresh hash/smoke, saved data, override and newer staging preserved. App/native readiness remains doubled.", flush=True)


                except Exception:
                    print("Fixture worker state:", engine.status(), flush=True)
                    for log in (storage.root / "logs").glob("*.log"):
                        print(log.read_text()[-16000:], flush=True)
                    raise
                finally:
                    if server.worker:
                        server.worker.join()
                    server.shutdown()
                    thread.join(timeout=5)
            Path("/run/couch-updater/control.sock").unlink(missing_ok=True)

    def dependency(self, root):
        stage = root / "dependency"
        (stage / "DEBIAN").mkdir(parents=True)
        (stage / "DEBIAN/control").write_text("Package: couch-fixture-dependency\nVersion: 1.0\nArchitecture: all\nMaintainer: Fixture <fixture@example.invalid>\nDescription: Missing acquisition fixture\n")
        repository = root / "repository"
        repository.mkdir()
        archive = repository / "dependency.deb"
        run("dpkg-deb", "--root-owner-group", "--build", str(stage), str(archive))
        (repository / "Packages").write_text(f"Package: couch-fixture-dependency\nVersion: 1.0\nArchitecture: all\nFilename: dependency.deb\nSize: {archive.stat().st_size}\nSHA256: {hashlib.sha256(archive.read_bytes()).hexdigest()}\nDescription: Missing acquisition fixture\n\n")
        source = Path("/etc/apt/sources.list.d/couch-fixture.list")
        source.write_text(f"deb [trusted=yes] file:{repository} ./\n")
        run("apt-get", "-o", f"Dir::Etc::sourcelist={source}", "-o", "Dir::Etc::sourceparts=-", "update")
        return archive

    def receipt(self, root, keys, number, dependency=None, interrupt=None):
        directory = root / f"receipt-{number}"
        manifest = fixtures.fixture(directory, number)
        for package in manifest["packages"]:
            stage = root / f'{package["name"]}-{number}'
            (stage / "DEBIAN").mkdir(parents=True)
            (stage / "DEBIAN/control").write_text(f'Package: {package["name"]}\nVersion: {package["version"]}\nArchitecture: {package["architecture"]}\nMaintainer: Fixture <fixture@example.invalid>\nDescription: Disposable transaction fixture\n')
            if dependency and package["name"] == "couch":
                with (stage / "DEBIAN/control").open("a") as control:
                    control.write(f"Depends: {dependency}\n")
            if interrupt and package["name"] == "couch":
                postinst = stage / "DEBIAN/postinst"
                postinst.write_text('#!/bin/sh\nset -eu\nif [ ! -e "' + str(interrupt) + '" ]; then\n  touch "' + str(interrupt) + '"\n  kill -KILL "$PPID"\nfi\n')
                postinst.chmod(0o755)
            document = stage / "usr/share/doc" / package["name"] / "build-info.json"
            document.parent.mkdir(parents=True)
            document.write_text(json.dumps(manifest["build"] if package["name"] == "couch" else {"package": "couch-appliance", "version": package["version"], "sourceCommit": manifest["build"]["revision"]}))
            if package["name"] == "couch":
                tools = stage / "usr/lib/couch-fixture-tools"
                tools.mkdir(parents=True)
                for name in ("yt-dlp", "deno"):
                    path = tools / name
                    path.write_bytes(helper_bytes(name, package["version"]))
                    path.chmod(0o755)
            archive = directory / package["filename"]
            run("dpkg-deb", "--root-owner-group", "--build", str(stage), str(archive))
            package.update(size=archive.stat().st_size, sha256=hashlib.sha256(archive.read_bytes()).hexdigest())
        (directory / "release.json").write_text(json.dumps(manifest))
        (directory / "Packages").write_text("\n".join(f'Package: {p["name"]}\nVersion: {p["version"]}\nArchitecture: {p["architecture"]}\nFilename: releases/{number}.1/{p["filename"]}\nSize: {p["size"]}\nSHA256: {p["sha256"]}\n' for p in manifest["packages"]))
        now = datetime.now(timezone.utc)
        metadata = f"Origin: Couch\nSuite: preview\nCodename: preview\nArchitectures: amd64\nComponents: main\nDate: {format_datetime(now)}\nValid-Until: {format_datetime(now + timedelta(days=1))}\nSHA256:\n"
        metadata += "\n".join(f" {hashlib.sha256((directory / path).read_bytes()).hexdigest()} {(directory / path).stat().st_size} {name}" for path, name in (("release.json", "release.json"), ("Packages", "main/binary-amd64/Packages"))) + "\n"
        release = root / f"release-{number}"
        release.write_text(metadata)
        run("gpg", "--homedir", str(keys), "--batch", "--yes", "--digest-algo", "SHA256", "--clearsign", "--output", str(directory / "InRelease"), str(release))
        return directory

    def stage(self, receipt, data):
        candidate = hashlib.sha256((receipt / "release.json").read_bytes()).hexdigest()
        shutil.copytree(receipt, data / "updates/staged" / candidate)
        return candidate

    def until(self, condition, seconds=10):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if condition():
                return
            time.sleep(0.05)
        self.fail("Fixture condition timed out")


if __name__ == "__main__":
    if os.geteuid() != 0:
        raise SystemExit("Run only in a disposable root Ubuntu container or dedicated CI runner.")
    unittest.main()
