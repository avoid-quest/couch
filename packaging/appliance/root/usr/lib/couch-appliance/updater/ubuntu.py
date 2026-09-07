"""Ubuntu operations with fixed service, package and credential boundaries."""
import json
import re
import os
import fcntl
from contextlib import contextmanager
from pathlib import Path
import pwd
import shutil
import signal
import subprocess
import time

import maintenance
from receipt import ENV, IdleDeferred, Rejected, run, trusted_file
from retention import installed, sync_directory

class Ubuntu:
    def __init__(self, root):
        self.root = root
        self.uid = pwd.getpwnam("couch-tv").pw_uid
        self.runtime = Path(f"/run/user/{self.uid}")
        self.apt_pid = None

    def data(self):
        text = trusted_file("/etc/couch/appliance.env").decode()
        values = [line[len("COUCH_DATA_DIR="):] for line in text.splitlines() if line.startswith("COUCH_DATA_DIR=")]
        if len(values) != 1 or not values[0].startswith("/") or any(char in values[0] for char in "\x00\r\n\"'"):
            raise Rejected("The appliance needs one absolute data directory in its root-owned configuration.")
        return Path(values[0])

    def preserve_worker(self, record):
        import worker
        worker.preserve(self.root, record["updateId"])

    def release_worker(self, record):
        import worker
        worker.release(self.root, record["updateId"])

    def staging(self):
        return self.data() / "updates/staged"

    def coordinator(self, operation, record, timeout=5):
        return maintenance.request({"op": operation, "protocol": "maintenance-v1", "updateId": record["updateId"], "nonce": record["nonce"], "candidate": {key: record[key] for key in ("candidateId", "version", "revision", "dataFormat")}, "confirmInterrupt": record["confirmInterrupt"], **({"whenIdle": True} if record.get("whenIdle") and operation in ("capabilities", "quiesce") else {})}, str(self.runtime / "couch-maintenance.sock"), timeout, self.uid)

    def systemctl(self, *arguments):
        return run("/usr/sbin/runuser", "-u", "couch-tv", "--", "/usr/bin/env", f"XDG_RUNTIME_DIR={self.runtime}", f"DBUS_SESSION_BUS_ADDRESS=unix:path={self.runtime}/bus", "/usr/bin/systemctl", "--user", *arguments).decode().strip()

    def system_status(self, runtime=False):
        try:
            output = subprocess.check_output(["/usr/bin/python3", "-I", str(Path(__file__).with_name("system_packages.py")), *(["runtime"] if runtime else [])], env=ENV, stderr=subprocess.DEVNULL, timeout=5)
            if len(output) > 16384:
                raise ValueError()
            result = json.loads(output)
            if not isinstance(result, dict):
                raise ValueError()
            return result
        except (OSError, subprocess.SubprocessError, ValueError):
            return {"ok": False, "error": "Ubuntu package status did not finish. Check the package manager through system administration."}

    def runtime_arguments(self, record):
        return ["ffmpeg=" + record["runtimeVersion"]] if record.get("repairRuntime") else []

    def verify_current(self, record):
        current = installed()
        if any(current.get(key) != record["previous"].get(key) for key in ("version", "revision", "dataFormat")):
            raise Rejected("The installed release changed after its receipt was enrolled.")
        if record.get("repairRuntime") and "runtimePrevious" in record:
            info = self.system_status(True)
            if info.get("ok") is not True or info.get("installed") != record["runtimePrevious"]:
                raise Rejected("The Ubuntu media runtime changed before maintenance. Refresh Tools and retry.")
        return current

    def preflight(self, record, manifest, packages):
        os_release = trusted_file("/usr/lib/os-release").decode()
        if 'ID=ubuntu\n' not in os_release or 'VERSION_ID="24.04"' not in os_release or run("/usr/bin/dpkg", "--print-architecture").strip() != b"amd64":
            raise Rejected("This worker requires Ubuntu 24.04 amd64.")
        current = self.verify_current(record)
        result = self.coordinator("capabilities", record)
        if record.get("whenIdle") and result.get("idleDeferred") is True and result.get("admissionClosed") is False:
            raise IdleDeferred("Couch became active. Wait for five continuous idle minutes.")
        if result.get("nativeReadiness") != "libmpv-v1" or result.get("build") != {key: current[key] for key in ("version", "revision", "dataFormat")}:
            raise Rejected("This app cannot provide the required native startup trial.")
        repairing = record.get("intent") == "repair-current"
        if repairing and result.get("toolRepair") != "package-smoke-v1":
            raise Rejected("This installed release cannot verify tool repair. Install a newer qualified Couch release first.")
        try:
            run("/usr/bin/dpkg", "--compare-versions", record["version"], "eq" if repairing else "gt", current["version"])
        except Rejected as error:
            raise Rejected("Repair must match the installed release exactly." if repairing else "Only a newer verified Couch release can be installed.") from error
        if record.get("repairRuntime"):
            info = self.system_status(True)
            if info.get("ok") is not True or not isinstance(info.get("version"), str) or not re.fullmatch(r"[0-9][A-Za-z0-9.+:~\-]{0,150}", info["version"]):
                raise Rejected(info.get("error") or "The exact Ubuntu media runtime archive is unavailable.")
            record.update(runtimeVersion=info["version"], runtimePrevious=info.get("installed"))
        if run("/usr/bin/dpkg", "--audit").strip():
            raise Rejected("Repair the interrupted package operation through SSH before updating Couch.")
        try:
            unpacked = sum(int(line.split()[2]) for path in packages for line in run("/usr/bin/dpkg-deb", "--contents", str(path)).decode().splitlines())
        except (ValueError, IndexError) as error:
            raise Rejected("The release's unpacked installation size could not be verified.") from error
        if shutil.disk_usage("/usr").free < unpacked + 256 * 1024 * 1024:
            raise Rejected("The TV needs more installation storage before updating.")
        record["dataPath"] = str(self.data())
        _, backup_size = maintenance.inventory(self.data())
        if shutil.disk_usage(self.root).free < backup_size:
            raise Rejected("The TV needs more data-backup storage before updating.")
        # Download and dependency errors are resolved while the app is still running.
        arguments = [*(["--reinstall"] if repairing else []), "install", *map(str, packages), *self.runtime_arguments(record)]
        self.apt(record, ["--simulate", *arguments])
        self.apt(record, ["--download-only", *arguments])

    def apt(self, record, arguments, hook=None):
        options = ["/usr/bin/apt-get", "-y", "--no-remove", "--no-install-recommends", "-o", "APT::Get::Fix-Missing=false", "-o", "DPkg::Lock::Timeout=30", "-o", "DPkg::Options::=--force-confold"]
        if hook:
            options += ["-o", f"DPkg::Pre-Invoke::=/usr/bin/python3 -I {hook} {record['updateId']}"]
        self.package_command(record, options + arguments, hook=bool(hook))

    def package_command(self, record, command, hook=False, tolerate_failure=False):
        directory = self.root / "logs"
        directory.mkdir(mode=0o700, exist_ok=True)
        with (directory / (record["updateId"] + ".log")).open("ab") as log:
            try:
                with subprocess.Popen(command, env={**ENV, "DEBIAN_FRONTEND": "noninteractive"}, stdout=log, stderr=subprocess.STDOUT, start_new_session=True) as process:
                    self.apt_pid = process.pid if hook else None
                    try:
                        process.wait(timeout=30 * 60)
                    except subprocess.TimeoutExpired:
                        os.killpg(process.pid, signal.SIGKILL)
                        process.wait()
                        raise
            except subprocess.TimeoutExpired as error:
                raise Rejected("The package manager exceeded its deadline. Inspect the retained transaction through SSH.") from error
            finally:
                self.apt_pid = None
        if process.returncode != 0 and not tolerate_failure:
            raise Rejected("The package manager could not finish. Its log is retained for the administrator.")

    def authorize_hook(self, peer_pid):
        # A root peer and matching update ID alone are insufficient: the hook
        # must descend from this worker's currently running APT child.
        for _ in range(16):
            if not peer_pid or peer_pid <= 1 or self.apt_pid is None:
                break
            if peer_pid == self.apt_pid:
                return
            try:
                peer_pid = int(Path(f"/proc/{peer_pid}/stat").read_text().rsplit(")", 1)[1].split()[1])
            except (OSError, ValueError, IndexError):
                break
        raise Rejected("The maintenance hook does not belong to this worker's APT process.")

    def install(self, record, packages):
        hooks = self.root / "hooks"
        hooks.mkdir(mode=0o700, exist_ok=True)
        hook = hooks / (record["updateId"] + ".py")
        with hook.open("xb") as stream:
            stream.write(trusted_file("/usr/lib/couch-appliance/updater/hook.py"))
            stream.flush()
            os.fsync(stream.fileno())
        sync_directory(hooks)
        self.apt(record, [*(["--reinstall"] if record.get("intent") == "repair-current" else []), "install", *map(str, packages), *self.runtime_arguments(record)], hook)

    def quiesce(self, record):
        response = self.coordinator("quiesce", record, 30)
        if record.get("whenIdle") and response.get("idleDeferred") is True and response.get("admissionClosed") is False:
            raise IdleDeferred("Couch became active. Wait for five continuous idle minutes.")
        if response.get("progressSaved") is not True or response.get("admissionClosed") is not True:
            raise Rejected("Couch did not confirm saved progress and maintenance admission.")
        self.systemctl("stop", "couch-tv.service")
        if self.systemctl("show", "couch-tv.service", "--property=MainPID", "--value") != "0" or self.systemctl("show", "couch-tv.service", "--property=ActiveState", "--value") not in ("inactive", "failed"):
            raise Rejected("The native app did not stop completely before backup.")
        group = self.systemctl("show", "couch-tv.service", "--property=ControlGroup", "--value")
        if group:
            if not group.startswith("/") or ".." in Path(group).parts:
                raise Rejected("The app returned an invalid service process group.")
            root = Path("/sys/fs/cgroup") / group.lstrip("/")
            if root.exists() and any(path.read_text().strip() for path in root.rglob("cgroup.procs")):
                raise Rejected("Application writers remain in the service process group.")
        backups = self.root / "backups"
        backups.mkdir(mode=0o700, exist_ok=True)
        maintenance.snapshot(self.data(), backups / record["updateId"])

    def start_trial(self, record):
        current = installed()
        if any(current.get(key) != record[key] for key in ("version", "revision", "dataFormat")):
            raise Rejected("APT did not install the requested build identity.")
        # The upper app protocol reads the root worker's active transaction
        # before constructing its hub. No client-controlled environment is used.
        self.systemctl("reset-failed", "couch-tv.service")
        self.systemctl("start", "couch-tv.service")

    def ready(self, record):
        expected = {key: record[key] for key in ("version", "revision", "dataFormat")}
        deadline = time.monotonic() + 90
        while (remaining := deadline - time.monotonic()) > 0:
            try:
                # Repair adds fresh hashing and bounded helper smoke after native
                # initialization. Keep its reply inside the 30-second bridge bound.
                request_budget = 25 if record.get("intent") == "repair-current" and record.get("phase") != "restoring" else 5
                result = self.coordinator("readiness", record, min(request_budget, remaining))
                repair_verified = record.get("intent") != "repair-current" or record.get("phase") == "restoring" or result.get("toolRepair") == "verified-v1"
                if repair_verified and all(result.get(key) == expected for key in ("build", "nativeBuild", "frontendBuild")) and result.get("database") == "ok" and result.get("nativeReadiness") == "libmpv-v1" and result.get("frontendReady") is True:
                    if record.get("repairRuntime") and record.get("phase") != "restoring":
                        version = run("/usr/bin/dpkg-query", "-W", "-f=${Version}", "ffmpeg").decode().strip()
                        if version != record["runtimeVersion"] or run("/usr/bin/dpkg", "--verify", "ffmpeg").strip():
                            raise Rejected("Ubuntu's ffmpeg package did not pass post-repair ownership/integrity verification.")
                    return
            except Rejected:
                pass
            time.sleep(min(0.25, max(0, deadline - time.monotonic())))
        raise Rejected("The requested build did not pass its bounded startup trial.")

    def commit(self, record):
        if self.coordinator("commit", record).get("admissionOpen") is not True:
            raise Rejected("The new app did not confirm completion of maintenance.")

    def stop_for_restore(self):
        self.systemctl("mask", "--runtime", "couch-tv.service")
        self.systemctl("stop", "couch-tv.service")
        if self.systemctl("show", "couch-tv.service", "--property=MainPID", "--value") != "0" or self.systemctl("show", "couch-tv.service", "--property=ActiveState", "--value") not in ("inactive", "failed"):
            raise Rejected("Stop the full Couch service before restoring its data.")
        group = self.systemctl("show", "couch-tv.service", "--property=ControlGroup", "--value")
        if group and (not group.startswith("/") or ".." in Path(group).parts or any(path.read_text().strip() for path in (Path("/sys/fs/cgroup") / group.lstrip("/")).rglob("cgroup.procs"))):
            raise Rejected("Couch writers remain in the service process group.")

    @contextmanager
    def package_lock(self):
        descriptors = []
        try:
            for path in ("/var/lib/dpkg/lock-frontend", "/var/lib/dpkg/lock"):
                descriptor = os.open(path, os.O_RDWR | os.O_NOFOLLOW)
                descriptors.append(descriptor)
                fcntl.lockf(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            yield
        except BlockingIOError as error:
            raise Rejected("Another package operation is running. Retry SSH restoration after it finishes.") from error
        finally:
            for descriptor in descriptors:
                os.close(descriptor)

    def unchanged_previous(self, previous):
        with self.package_lock():
            try:
                current = installed()
                return not run("/usr/bin/dpkg", "--audit").strip() and all(current.get(key) == previous[key] for key in ("version", "revision", "dataFormat"))
            except Rejected:
                return False

    def package_health(self):
        if run("/usr/bin/dpkg", "--audit").strip():
            raise Rejected("Repair the package manager through SSH before continuing restoration.")

    def restore_packages(self, record, packages):
        # dpkg owns interruption repair. A failed candidate postinst may still
        # fail configuration; retained previous archives then replace it through APT.
        self.package_command(record, ["/usr/bin/dpkg", "--audit"], tolerate_failure=True)
        self.package_command(record, ["/usr/bin/dpkg", "--force-confold", "--configure", "--pending"], tolerate_failure=True)
        self.apt(record, ["--fix-broken", "--allow-downgrades", *(["--reinstall"] if record.get("intent") == "repair-current" else []), "install", *map(str, packages)])
        self.package_health()

    def restore_data(self, backup, state, persist):
        from recovery import restore_data
        if state["dataPath"] != str(self.data()):
            raise Rejected("The configured data directory changed during this update.")
        return restore_data(self.data(), backup, state, persist)

    def start_restored_trial(self, record):
        self.systemctl("unmask", "--runtime", "couch-tv.service")
        self.start_trial(record)
