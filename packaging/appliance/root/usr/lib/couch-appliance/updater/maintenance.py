"""Fixed local coordinator protocol and a stopped-application data snapshot."""
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import sqlite3
import stat
import struct
import time

from receipt import Rejected, load_json
from retention import save, sync_directory

SOCKET = "/run/couch-appliance/maintenance.sock"


def remaining(deadline):
    duration = deadline - time.monotonic()
    if duration <= 0:
        raise Rejected("The local update request exceeded its deadline.")
    return duration


def request(payload, path=SOCKET, timeout=5, uid=None):
    deadline = time.monotonic() + timeout
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
            connection.settimeout(remaining(deadline))
            connection.connect(path)
            if uid is not None and struct.unpack("3i", connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))[1] != uid:
                raise Rejected("The maintenance socket belongs to another account.")
            connection.settimeout(remaining(deadline))
            connection.sendall(json.dumps(payload).encode() + b"\n")
            data = bytearray()
            while b"\n" not in data and len(data) <= 65536:
                connection.settimeout(remaining(deadline))
                block = connection.recv(4096)
                if not block:
                    break
                data.extend(block)
            if len(data) > 65536 or not data.endswith(b"\n"):
                raise Rejected("The coordinator returned an invalid maintenance response.")
            result = load_json(data)
            remaining(deadline)
            if not isinstance(result, dict) or result.get("protocol") != "maintenance-v1" or result.get("nonce") != payload["nonce"] or result.get("ok") is not True:
                raise Rejected("The coordinator did not confirm this maintenance request.")
            return result
    except OSError as error:
        raise Rejected("This installed app does not provide the required maintenance protocol.") from error


def inventory(data):
    database = data / "couch.sqlite"
    if not data.is_dir() or data.is_symlink() or not database.is_file() or database.is_symlink():
        raise Rejected("The configured data directory and database must be regular local paths.")
    entries, total = [], 0
    for root, directories, files in os.walk(data, followlinks=False):
        root = Path(root)
        if root == data / "updates":
            directories[:] = [name for name in directories if name != "staged"]
        for name in directories + files:
            path = root / name
            info = path.lstat()
            if not (stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode)):
                raise Rejected("Application data contains a file type that cannot be backed up safely.")
            entries.append({"path": str(path.relative_to(data)), "uid": info.st_uid, "gid": info.st_gid, "mode": stat.S_IMODE(info.st_mode)})
            if stat.S_ISREG(info.st_mode):
                total += info.st_size
    return entries, 2 * total + 256 * 1024 * 1024


def snapshot(data, destination):
    """Called only after the entire supervised app process group is stopped."""
    entries, needed = inventory(data)
    if shutil.disk_usage(destination.parent).free < needed:
        raise Rejected("The TV needs more storage for its pre-update data backup.")
    def ignored(path, names):
        return ["staged"] if Path(path) == data / "updates" and "staged" in names else []
    destination.mkdir(mode=0o700)
    try:
        shutil.copytree(data, destination / "data", symlinks=True, ignore=ignored)
        copied = destination / "data/couch.sqlite"
        # Normalize a private copy, never open a user-controlled SQLite sidecar
        # as root in the live data directory.
        for suffix in ("", "-wal", "-shm", "-journal"):
            path = Path(str(copied) + suffix)
            if path.is_symlink() or path.exists() and not path.is_file():
                raise Rejected("The database snapshot has an unsupported file type.")
        normalized = destination / "normalized.sqlite"
        with closing(sqlite3.connect(copied)) as source, closing(sqlite3.connect(normalized)) as backup:
            if source.execute("PRAGMA quick_check").fetchall() != [("ok",)]:
                raise Rejected("The current database did not pass its integrity check.")
            source.backup(backup)
            if backup.execute("PRAGMA quick_check").fetchall() != [("ok",)]:
                raise Rejected("The update database backup did not pass its integrity check.")
        for suffix in ("-wal", "-shm", "-journal"):
            Path(str(copied) + suffix).unlink(missing_ok=True)
        os.replace(normalized, copied)
        save(destination / "ownership.json", {"root": {"uid": data.stat().st_uid, "gid": data.stat().st_gid, "mode": stat.S_IMODE(data.stat().st_mode)}, "entries": entries})
        hashes = {}
        for root, directories, files in os.walk(destination, followlinks=False):
            for name in files:
                path = Path(root) / name
                if not path.is_symlink():
                    with path.open("rb") as stream:
                        digest = hashlib.sha256()
                        while block := stream.read(1024 * 1024):
                            digest.update(block)
                        hashes[str(path.relative_to(destination))] = digest.hexdigest()
                        os.fsync(stream.fileno())
            sync_directory(root)
        save(destination / "hashes.json", hashes)
        sync_directory(destination.parent)
    except Exception:
        shutil.rmtree(destination)
        raise
