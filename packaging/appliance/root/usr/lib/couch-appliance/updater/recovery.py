"""Bounded restoration of an uncommitted trial with a durable data-swap journal."""
import hashlib
import os
from pathlib import Path
import shutil
import stat
import uuid

from receipt import Rejected, copy_receipt, load_json
from retention import installed, require_format, save, sync_directory


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


def restore_data(data, backup, state, persist):
    ownership = verify_backup(backup)
    token = state["nonce"]
    if len(token) != 32 or any(char not in "0123456789abcdef" for char in token):
        raise Rejected("The restoration identity is invalid.")
    parent = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
    stage = None
    try:
        for component in data.parent.parts[1:]:
            next_parent = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            os.close(parent)
            parent = next_parent
        def identity(name, directory=parent):
            try:
                info = os.stat(name, dir_fd=directory, follow_symlinks=False)
            except FileNotFoundError:
                return None
            if not stat.S_ISDIR(info.st_mode):
                raise Rejected("A restoration directory was replaced with another file type.")
            return [info.st_dev, info.st_ino]
        parent_info = os.fstat(parent)
        parent_identity = [parent_info.st_dev, parent_info.st_ino]
        stage_name, failed_name = ".couch-restore-" + token, ".couch-failed-trial-" + token
        plan = state.get("swap")
        if plan is None:
            original = identity(data.name)
            if original is None or identity(failed_name) is not None:
                raise Rejected("The original data directory needs administrator inspection.")
            plan = state["swap"] = {"parent": parent_identity, "original": original, "step": "copy"}
            persist()
        if plan["parent"] != parent_identity:
            raise Rejected("The configured restoration parent changed.")
        try:
            os.mkdir(stage_name, mode=0o700, dir_fd=parent)
            os.fsync(parent)
        except FileExistsError:
            pass
        stage = os.open(stage_name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
        info = os.fstat(stage)
        if info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o700:
            raise Rejected("The restoration staging directory is not private.")
        staged = Path(f"/proc/self/fd/{stage}") / "data"
        if plan["step"] == "copy":
            if identity(data.name) != plan["original"] or identity(failed_name) is not None:
                raise Rejected("The failed trial data changed before snapshot preparation.")
            needed = sum(path.stat().st_size for path in (backup / "data").rglob("*") if path.is_file() and not path.is_symlink())
            if shutil.disk_usage(Path(f"/proc/self/fd/{parent}")).free < needed + 256 * 1024 * 1024:
                raise Rejected("Free space is needed to restore the snapshot without deleting the failed trial.")
            # Only an incomplete private copy can be removed. Neither the
            # original snapshot nor either installed data directory is deleted.
            if staged.is_symlink():
                raise Rejected("The staged snapshot was replaced with a symlink.")
            if staged.exists():
                shutil.rmtree(staged)
            shutil.copytree(backup / "data", staged, symlinks=True)
            for entry in ownership["entries"]:
                path = staged / entry["path"]
                if not path.exists() and not path.is_symlink():
                    continue
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
            os.fsync(stage)
            plan.update(step="prepared", staged=identity("data", stage))
            persist()
        live, failed, prepared = identity(data.name), identity(failed_name), identity("data", stage)
        if live == plan["original"] and failed is None and prepared == plan["staged"]:
            os.rename(data.name, failed_name, src_dir_fd=parent, dst_dir_fd=parent)
            os.fsync(parent)
            plan["step"] = "moved"
            persist()
            live, failed = None, plan["original"]
        if live is None and failed == plan["original"] and prepared == plan["staged"]:
            os.rename("data", data.name, src_dir_fd=stage, dst_dir_fd=parent)
            os.fsync(stage)
            os.fsync(parent)
            live, prepared = plan["staged"], None
        if live != plan["staged"] or failed != plan["original"] or prepared is not None:
            raise Rejected("The interrupted data swap needs administrator inspection; all directories were retained.")
        plan["step"] = "installed"
        persist()
        return str(data.parent / failed_name)
    finally:
        if stage is not None:
            os.close(stage)
        os.close(parent)


def restore(engine, update_id, automatic=False):
    with engine.storage.lock():
        with engine.mutex:
            record = engine.record
            if not record or record["updateId"] != update_id or record["phase"] not in ("operator-required", "restoring") or record["committed"]:
                raise Rejected("Only this recorded uncommitted trial can be restored. Committed data must never be rolled back.")
            if not engine.hook_idle.is_set():
                raise Rejected("The previous maintenance hook is still running. Wait before SSH restoration.")
            if automatic and (record.get("automaticFailed") or record.get("automaticStarts", 0) >= 3):
                engine.transition("operator-required", recoveryPending=False, automaticFailed=True,
                                  error="Automatic recovery reached its restart limit. Continue through SSH after inspection.")
                return engine.status()
            engine.transition("operator-required", recoveryPending=True, automaticFailed=False,
                              automaticStarts=record.get("automaticStarts", 0) + 1 if automatic else 0)
        try:
            key = engine.key()
            previous = engine.storage.current(key)
            if previous != record.get("previous"):
                raise Rejected("The accepted receipt no longer matches this transaction's previous release.")
            _, manifest = copy_receipt(engine.storage.receipts / previous["candidateId"], None, key, False, previous["candidateId"])
            require_format(manifest, previous)
            prior = record.get("restoration") or {}
            if prior.get("swap", {}).get("step") == "installed" and (not automatic or prior.get("stage") == "trial"):
                # A root-requested retry may replace failed restoration-trial
                # writes with the same original snapshot, retaining both failures.
                failed = str(Path(prior["dataPath"]).parent / (".couch-failed-trial-" + prior["nonce"]))
                history = record.get("failedTrialHistory", []) + [failed]
                engine.transition("operator-required", restoration=None, failedTrialHistory=history)
            restoration = {**(record.get("restoration") or {**previous, "nonce": uuid.uuid4().hex, "dataPath": record.get("dataPath")}), "stage": "preparing"}
            engine.transition("restoring", restoration=restoration, error=None)
            candidate = {**record, **previous, "nonce": restoration["nonce"]}
            engine.platform.stop_for_restore()
            resumed = not record["hookComplete"] and engine.platform.unchanged_previous(previous)
            backup = engine.storage.root / "backups" / update_id
            if not resumed:
                verify_backup(backup)
                packages = [engine.storage.receipts / previous["candidateId"] / item["filename"] for item in manifest["packages"]]
                engine.platform.restore_packages(candidate, packages)
            with engine.platform.package_lock():
                engine.platform.package_health()
                if any(installed().get(key) != previous[key] for key in ("version", "revision", "dataFormat")):
                    raise Rejected("The previous packages did not restore their authenticated build identity.")
                if not resumed:
                    failed_data = engine.platform.restore_data(backup, restoration, engine.persist)
                    engine.transition("restoring", failedTrialData=failed_data)
                engine.transition("restoring", restoration={**restoration, "stage": "trial"})
                engine.platform.start_restored_trial(candidate)
                engine.platform.ready(candidate)
                engine.transition("restoring", committed=True, recoveryPending=False, restoration={**record["restoration"], "stage": "committing"})
                save(engine.storage.root / "current.json", previous)
                engine.platform.commit(candidate)
                engine.transition("restored", restoredVersion=previous["version"], restoredRevision=previous["revision"])
                engine.clear_active()
        except Exception as error:
            engine.transition("operator-required", recoveryPending=False, automaticFailed=automatic or record.get("automaticFailed", False),
                              error=str(error) if isinstance(error, Rejected) else "Restoration stopped. Keep the retained packages, snapshots and failed trial data for SSH inspection.")
        if record["phase"] == "restored":
            engine.release_worker()
        return engine.status()
