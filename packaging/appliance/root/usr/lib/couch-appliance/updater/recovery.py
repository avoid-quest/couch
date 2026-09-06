"""Explicit SSH restoration of an uncommitted trial; never automatic rollback."""
import hashlib
import os
from pathlib import Path
import shutil
import stat
import tempfile
import uuid

from receipt import Rejected, copy_receipt, load_json
from retention import installed, save, sync_directory


def verify_backup(directory):
    hashes = load_json((directory / "hashes.json").read_bytes())
    if not isinstance(hashes, dict) or "ownership.json" not in hashes or "data/couch.sqlite" not in hashes:
        raise Rejected("This transaction has no complete data snapshot.")
    for name, expected in hashes.items():
        path = Path(name)
        if path.is_absolute() or ".." in path.parts or not path.parts:
            raise Rejected("The snapshot inventory is invalid.")
        source = directory / path
        if not source.is_file() or source.is_symlink():
            raise Rejected("A retained snapshot file is missing.")
        with source.open("rb") as stream:
            digest = hashlib.sha256()
            while block := stream.read(1024 * 1024):
                digest.update(block)
        if digest.hexdigest() != expected:
            raise Rejected("The retained data snapshot did not pass verification.")
    ownership = load_json((directory / "ownership.json").read_bytes())
    for entry in ownership["entries"]:
        path = Path(entry["path"])
        if path.is_absolute() or ".." in path.parts or not path.parts:
            raise Rejected("The snapshot ownership inventory is invalid.")
    return ownership


def restore_data(data, backup):
    ownership = verify_backup(backup)
    # Resolve each configured parent component without following symlinks, then
    # keep the destination parent pinned through both final renames.
    parent = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
    try:
        for component in data.parent.parts[1:]:
            next_parent = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            os.close(parent)
            parent = next_parent
        parent_path = Path(f"/proc/self/fd/{parent}")
        if shutil.disk_usage(parent_path).free < sum(path.stat().st_size for path in (backup / "data").rglob("*") if path.is_file() and not path.is_symlink()) + 256 * 1024 * 1024:
            raise Rejected("Free space is needed to restore the snapshot without deleting the failed trial.")
        temporary = tempfile.mkdtemp(prefix=".couch-restore-", dir=parent_path)
        stage_name = Path(temporary).name
        stage = os.open(stage_name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
        try:
            staged = Path(f"/proc/self/fd/{stage}") / "data"
            shutil.copytree(backup / "data", staged, symlinks=True)
            # The root-owned 0700 staging parent prevents runtime-account writes
            # while child ownership is restored. Symlinks are never followed.
            for entry in ownership["entries"]:
                path = staged / entry["path"]
                if not path.exists() and not path.is_symlink():
                    continue  # SQLite WAL/SHM were normalized out of the snapshot.
                os.chown(path, entry["uid"], entry["gid"], follow_symlinks=False)
                if not path.is_symlink():
                    os.chmod(path, entry["mode"], follow_symlinks=False)
            root = ownership["root"]
            os.chown(staged, root["uid"], root["gid"])
            os.chmod(staged, root["mode"])
            for directory, _, files in os.walk(staged, followlinks=False):
                for name in files:
                    path = Path(directory) / name
                    if not path.is_symlink():
                        with path.open("rb") as stream:
                            os.fsync(stream.fileno())
                sync_directory(directory)
            failed_name = ".couch-failed-trial-" + uuid.uuid4().hex
            os.rename(data.name, failed_name, src_dir_fd=parent, dst_dir_fd=parent)
            os.fsync(parent)
            try:
                os.rename("data", data.name, src_dir_fd=stage, dst_dir_fd=parent)
            except Exception:
                os.rename(failed_name, data.name, src_dir_fd=parent, dst_dir_fd=parent)
                os.fsync(parent)
                raise
            os.fsync(parent)
            return str(data.parent / failed_name)
        finally:
            shutil.rmtree(Path(f"/proc/self/fd/{stage}") / "data", ignore_errors=True)
            os.close(stage)
            os.rmdir(stage_name, dir_fd=parent)
    finally:
        os.close(parent)


def restore(engine, update_id):
    with engine.storage.lock():
        with engine.mutex:
            record = engine.record
            if not record or record["updateId"] != update_id or record["phase"] != "operator-required" or record["committed"]:
                raise Rejected("Only this recorded uncommitted trial can be restored. Committed data must never be rolled back.")
            previous = engine.storage.current(engine.key())
            if previous != record.get("previous"):
                raise Rejected("The accepted receipt no longer matches this transaction's previous release.")
            _, manifest = copy_receipt(engine.storage.receipts / previous["candidateId"], None, engine.key(), False, previous["candidateId"])
            candidate = {**record, **previous, "nonce": uuid.uuid4().hex}
            engine.transition("restoring", restoration={**previous, "nonce": candidate["nonce"], "stage": "preparing"}, error=None)
        try:
            engine.platform.stop_for_restore()
            # A failed required checkpoint may have no snapshot. Resume the
            # unchanged previous app only while both package locks are held.
            resumed = not record["hookComplete"] and engine.platform.unchanged_previous(previous)
            if not resumed:
                backup = engine.storage.root / "backups" / update_id
                verify_backup(backup)
                packages = [engine.storage.receipts / previous["candidateId"] / item["filename"] for item in manifest["packages"]]
                engine.platform.restore_packages(candidate, packages)
            with engine.platform.package_lock():
                engine.platform.package_health()
                if any(installed().get(key) != previous[key] for key in ("version", "revision", "dataFormat")):
                    raise Rejected("The previous packages did not restore their authenticated build identity.")
                if not resumed:
                    failed_data = engine.platform.restore_data(backup)
                    engine.transition("restoring", failedTrialData=failed_data)
                engine.transition("restoring", restoration={**record["restoration"], "stage": "trial"})
                engine.platform.start_restored_trial(candidate)
                engine.platform.ready(candidate)
                # Even resumed old data must never be rolled back after reopening.
                engine.transition("restoring", committed=True, restoration={**record["restoration"], "stage": "committing"})
                engine.platform.commit(candidate)
                engine.transition("restored", restoredVersion=previous["version"], restoredRevision=previous["revision"])
                engine.clear_active()
        except Exception as error:
            engine.transition("operator-required", error=str(error) if isinstance(error, Rejected) else "SSH restoration stopped. Keep the retained packages, snapshots and failed trial data for inspection.")
        return engine.status()
