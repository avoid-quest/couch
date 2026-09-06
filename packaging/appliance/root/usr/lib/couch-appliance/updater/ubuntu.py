"""Ubuntu operations with fixed service, package and credential boundaries."""
import os
from pathlib import Path
import pwd
import shutil
import signal
import subprocess
import time

import maintenance
from receipt import ENV, Rejected, run, trusted_file
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

    def staging(self):
        return self.data() / "updates/staged"

    def coordinator(self, operation, record, timeout=5):
        return maintenance.request({"op": operation, "protocol": "maintenance-v1", "updateId": record["updateId"], "nonce": record["nonce"], "candidate": {key: record[key] for key in ("candidateId", "version", "revision", "dataFormat")}, "confirmInterrupt": record["confirmInterrupt"]}, str(self.runtime / "couch-maintenance.sock"), timeout, self.uid)

    def systemctl(self, *arguments):
        return run("/usr/sbin/runuser", "-u", "couch-tv", "--", "/usr/bin/env", f"XDG_RUNTIME_DIR={self.runtime}", f"DBUS_SESSION_BUS_ADDRESS=unix:path={self.runtime}/bus", "/usr/bin/systemctl", "--user", *arguments).decode().strip()

    def verify_current(self, record):
        current = installed()
        if any(current.get(key) != record["previous"].get(key) for key in ("version", "revision", "dataFormat")):
            raise Rejected("The installed release changed after its receipt was enrolled.")
        return current

    def preflight(self, record, manifest, packages):
        os_release = trusted_file("/usr/lib/os-release").decode()
        if 'ID=ubuntu\n' not in os_release or 'VERSION_ID="24.04"' not in os_release or run("/usr/bin/dpkg", "--print-architecture").strip() != b"amd64":
            raise Rejected("This worker requires Ubuntu 24.04 amd64.")
        current = self.verify_current(record)
        result = self.coordinator("capabilities", record)
        if result.get("nativeReadiness") != "libmpv-v1" or result.get("build") != {key: current[key] for key in ("version", "revision", "dataFormat")}:
            raise Rejected("This app cannot provide the required native startup trial.")
        try:
            run("/usr/bin/dpkg", "--compare-versions", record["version"], "gt", current["version"])
        except Rejected as error:
            raise Rejected("Only a newer verified Couch release can be installed.") from error
        if run("/usr/bin/dpkg", "--audit").strip():
            raise Rejected("Repair the interrupted package operation through SSH before updating Couch.")
        try:
            unpacked = sum(int(line.split()[2]) for path in packages for line in run("/usr/bin/dpkg-deb", "--contents", str(path)).decode().splitlines())
        except (ValueError, IndexError) as error:
            raise Rejected("The release's unpacked installation size could not be verified.") from error
        if shutil.disk_usage("/usr").free < unpacked + 256 * 1024 * 1024:
            raise Rejected("The TV needs more installation storage before updating.")
        _, backup_size = maintenance.inventory(self.data())
        if shutil.disk_usage(self.root).free < backup_size:
            raise Rejected("The TV needs more data-backup storage before updating.")
        # Download and dependency errors are resolved while the app is still running.
        self.apt(record, ["--simulate", "install", *map(str, packages)])
        self.apt(record, ["--download-only", "install", *map(str, packages)])

    def apt(self, record, arguments, hook=None):
        directory = self.root / "logs"
        directory.mkdir(mode=0o700, exist_ok=True)
        options = ["/usr/bin/apt-get", "-y", "--no-remove", "--no-install-recommends", "-o", "APT::Get::Fix-Missing=false", "-o", "DPkg::Lock::Timeout=30", "-o", "DPkg::Options::=--force-confold"]
        if hook:
            options += ["-o", f"DPkg::Pre-Invoke::=/usr/bin/python3 -I {hook} {record['updateId']}"]
        with (directory / (record["updateId"] + ".log")).open("ab") as log:
            try:
                with subprocess.Popen(options + arguments, env={**ENV, "DEBIAN_FRONTEND": "noninteractive"}, stdout=log, stderr=subprocess.STDOUT, start_new_session=True) as process:
                    self.apt_pid = process.pid if hook else None
                    try:
                        process.wait(timeout=30 * 60)
                    except subprocess.TimeoutExpired:
                        os.killpg(process.pid, signal.SIGKILL)
                        process.wait()
                        raise
            except subprocess.TimeoutExpired as error:
                raise Rejected("APT exceeded its update deadline. Inspect the retained transaction through SSH.") from error
            finally:
                self.apt_pid = None
        if process.returncode != 0:
            raise Rejected("APT could not finish this update. Its log is retained for the administrator.")

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
        self.apt(record, ["install", *map(str, packages)], hook)

    def quiesce(self, record):
        response = self.coordinator("quiesce", record, 30)
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
                result = self.coordinator("readiness", record, min(5, remaining))
                if all(result.get(key) == expected for key in ("build", "nativeBuild", "frontendBuild")) and result.get("database") == "ok" and result.get("nativeReadiness") == "libmpv-v1" and result.get("frontendReady") is True:
                    return
            except Rejected:
                pass
            time.sleep(min(0.25, max(0, deadline - time.monotonic())))
        raise Rejected("The requested build did not pass its bounded startup trial.")

    def commit(self, record):
        if self.coordinator("commit", record).get("admissionOpen") is not True:
            raise Rejected("The new app did not confirm completion of maintenance.")
