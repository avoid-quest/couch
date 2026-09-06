"""Root-owned receipt retention, shared by enrollment and update transactions."""
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import shutil
import stat
import tempfile

from receipt import Rejected, SHA, copy_receipt, enrolled_key, load_json, run, trusted_file

ROOT = Path("/var/lib/couch-updater")


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def save(path, value):
    descriptor, temporary = tempfile.mkstemp(prefix=".save-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w") as stream:
            json.dump(value, stream, separators=(",", ":"))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        sync_directory(path.parent)
    finally:
        Path(temporary).unlink(missing_ok=True)


def installed():
    records = run("/usr/bin/dpkg-query", "-W", "-f=${Package}\t${Version}\t${Architecture}\t${db:Status-Status}\n", "couch", "couch-appliance").decode().strip().splitlines()
    packages = {}
    for line in records:
        columns = line.split("\t")
        if len(columns) != 4 or columns[0] in packages or columns[3] != "installed":
            raise Rejected("Both Couch packages must be completely configured.")
        packages[columns[0]] = columns[1:3]
    app = load_json(trusted_file("/usr/share/doc/couch/build-info.json"))
    companion = load_json(trusted_file("/usr/share/doc/couch-appliance/build-info.json"))
    if not isinstance(app, dict) or not isinstance(companion, dict) or packages != {"couch": [app.get("version"), "amd64"], "couch-appliance": [app.get("version"), "all"]} or companion.get("package") != "couch-appliance" or companion.get("version") != app.get("version") or companion.get("sourceCommit") != app.get("revision"):
        raise Rejected("Installed package and build identities disagree.")
    return app


def identity(manifest):
    build = manifest["build"]
    return {"version": build["version"], "revision": build["revision"], "dataFormat": build.get("dataFormat")}


def require_format(manifest, current):
    build = manifest["build"]
    declared = manifest["compatibility"].get("dataFormat")
    if type(build.get("dataFormat")) is not int or build["dataFormat"] != 1 or type(declared) is not int or declared != 1 or type(current.get("dataFormat")) is not int or current["dataFormat"] != 1:
        raise Rejected("This update has no supported data-format compatibility contract.")


class Retention:
    def __init__(self, root=ROOT):
        self.root = Path(root)
        self.root.mkdir(mode=0o700, parents=False, exist_ok=True)
        info = self.root.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077:
            raise Rejected("Update storage must be a private directory owned by its worker.")
        self.receipts = self.root / "receipts"
        self.receipts.mkdir(mode=0o700, exist_ok=True)

    @contextmanager
    def lock(self):
        descriptor = os.open(self.root / "lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, "w") as stream:
            try:
                fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise Rejected("Another Couch maintenance operation is running.") from error
            yield

    def read(self, name, default=None):
        path = self.root / name
        return load_json(path.read_bytes()) if path.exists() else default

    def retain(self, source, key, fresh=True, expected=None):
        temporary = Path(tempfile.mkdtemp(prefix=".receipt-", dir=self.receipts))
        try:
            candidate_id, manifest = copy_receipt(source, temporary, key, fresh, expected)
            sync_directory(temporary)
            destination = self.receipts / candidate_id
            if destination.exists():
                # Reverify retained bytes too. Receipt expiry does not invalidate
                # an already accepted release's recovery evidence.
                check = Path(tempfile.mkdtemp(prefix=".check-", dir=self.receipts))
                try:
                    copy_receipt(destination, check, key, False, candidate_id)
                finally:
                    shutil.rmtree(check)
                if fresh:
                    # Manifest and archives stay immutable, but a publisher may
                    # renew this release's signed channel expiry.
                    os.replace(temporary / "InRelease", destination / "InRelease")
                    sync_directory(destination)
            else:
                os.rename(temporary, destination)
                sync_directory(self.receipts)
            return candidate_id, manifest
        finally:
            if temporary.exists():
                shutil.rmtree(temporary)

    def enroll(self, source, key=None, current=None):
        with self.lock():
            active = self.read("active.json")
            if active:
                raise Rejected("Finish the current update before enrolling another release.")
            current = installed() if current is None else current
            candidate_id, manifest = self.retain(source, enrolled_key() if key is None else key, False)
            if any(current.get(field) != manifest["build"].get(field) for field in ("version", "revision", "target", "packaged", "dirty", "dataFormat")):
                raise Rejected("The receipt does not match the installed Couch build.")
            record = {"candidateId": candidate_id, **identity(manifest)}
            save(self.root / "current.json", record)
            return record

    def current(self, key):
        current = self.read("current.json")
        if not isinstance(current, dict) or not isinstance(current.get("candidateId"), str) or not SHA.fullmatch(current["candidateId"]):
            raise Rejected("Enroll the exact installed release before requesting updates.")
        candidate_id, manifest = self.retain(self.receipts / current["candidateId"], key, False, current["candidateId"])
        if current != {"candidateId": candidate_id, **identity(manifest)}:
            raise Rejected("The retained current-release identity is inconsistent.")
        return current
