"""Durable update identity and the single maintenance transaction state machine."""
import re
from contextlib import nullcontext
import threading
import time
import uuid

from receipt import IdleDeferred, Rejected, SHA, copy_receipt, enrolled_key, load_json
from retention import identity, require_format, save, sync_directory

TOKEN = re.compile(r"[a-f0-9]{32}\Z")
FINISHED = {"succeeded", "failed", "restored"}
HOOK_DRAIN_SECONDS = 330


def public(record):
    value = {key: record.get(key) for key in ("updateId", "requestId", "candidateId", "version", "revision", "phase", "error", "createdAt", "updatedAt", "restoredVersion", "restoredRevision", "idleDeferred", "intent", "repairRuntime")}
    if record.get("recoveryPending") and not record.get("committed"):
        value["phase"] = "restoring"
    return value


class Transactions:
    def __init__(self, storage, platform, key=enrolled_key):
        self.storage, self.platform, self.key = storage, platform, key
        self.directory = storage.root / "transactions"
        self.directory.mkdir(mode=0o700, exist_ok=True)
        self.mutex = threading.RLock()
        self.hook_idle = threading.Event()
        self.hook_idle.set()
        with storage.lock():
            self.record = storage.read("active.json")
            if self.record:
                request_id = self.record.get("requestId")
                if not isinstance(request_id, str) or not TOKEN.fullmatch(request_id):
                    raise Rejected("The active transaction identity needs administrator inspection.")
                journal = self.directory / (request_id + ".json")
                if not journal.exists():
                    raise Rejected("The active transaction journal is missing.")
                latest = load_json(journal.read_bytes())
                if latest.get("requestId") != request_id or latest.get("updateId") != self.record.get("updateId"):
                    raise Rejected("The active transaction journal identity does not match.")
                # persist writes the journal first. Its durable outcome and
                # commit boundary take precedence over an older active marker.
                self.record = latest
            else:
                pending = [load_json(path.read_bytes()) for path in self.directory.glob("*.json")]
                pending = [value for value in pending if value["phase"] not in FINISHED]
                if len(pending) > 1:
                    raise Rejected("Multiple unfinished transactions require administrator inspection.")
                self.record = pending[0] if pending else None
            if self.record:
                if self.record["phase"] in FINISHED:
                    self.record["recoveryPending"] = False
                    self.clear_active()
                else:
                    prehook = self.record["phase"] == "installing" and not self.record.get("disrupted")
                    interrupted = self.record.get("disrupted", False) or self.record["phase"] not in ("accepted", "preflight")
                    if prehook:
                        # APT cannot mutate packages before this hook durably
                        # closes admission. Verify that boundary without stopping playback.
                        try:
                            interrupted = not self.platform.unchanged_previous(self.record["previous"])
                        except (Rejected, KeyError):
                            interrupted = True
                    pending = interrupted and not prehook and not self.record.get("committed") and not self.record.get("automaticFailed")
                    if self.record["phase"] == "operator-required" and not self.record.get("recoveryPending"):
                        pending = False
                    self.record.update(phase="operator-required" if interrupted else "failed", recoveryPending=pending,
                                       error="The update worker restarted before this transaction finished.")
                    self.persist()
                    if not interrupted:
                        self.clear_active()

    def persist(self):
        self.record["updatedAt"] = int(time.time() * 1000)
        save(self.directory / (self.record["requestId"] + ".json"), self.record)
        save(self.storage.root / "active.json", self.record)

    def clear_active(self):
        (self.storage.root / "active.json").unlink(missing_ok=True)
        sync_directory(self.storage.root)

    def transition(self, phase, **values):
        with self.mutex:
            self.record.update(phase=phase, **values)
            self.persist()

    def status(self, request_id=None):
        with self.mutex:
            if request_id is not None:
                if not isinstance(request_id, str) or not TOKEN.fullmatch(request_id):
                    raise Rejected("Use the recorded retry identity to read an update.")
                path = self.directory / (request_id + ".json")
                return public(load_json(path.read_bytes())) if path.exists() else None
            if self.record:
                return public(self.record)
            files = list(self.directory.glob("*.json"))
            return public(load_json(max(files, key=lambda path: path.stat().st_mtime_ns).read_bytes())) if files else None

    def context(self):
        """Private startup authority for the app, never a phone status response."""
        with self.mutex:
            if not self.record or self.record["phase"] in FINISHED:
                return None
            value = dict(self.record)
            if value["phase"] == "restoring":
                value.update(value["restoration"])
                value["intent"] = "recovery"
                value["phase"] = {"trial": "trial", "committing": "committing"}.get(value["stage"], "restoring")
            return {key: value.get(key) for key in ("updateId", "nonce", "candidateId", "version", "revision", "dataFormat", "phase", "disrupted", "committed", "confirmInterrupt", "whenIdle", "intent", "repairRuntime")}

    def current_summary(self):
        current = self.storage.read("current.json")
        return {key: current.get(key) for key in ("candidateId", "version", "revision")} if isinstance(current, dict) else None

    def submit(self, request, intent="install"):
        repair_runtime = False
        if intent == "repair-current":
            if not isinstance(request, dict) or set(request) != {"expectedCurrentId", "requestId", "confirmInterrupt", "repairRuntime"} or type(request["repairRuntime"]) is not bool:
                raise Rejected("Confirm the enrolled current release, runtime repair and playback interruption choice.")
            repair_runtime = request["repairRuntime"]
            request = {"candidateId": request["expectedCurrentId"], "requestId": request["requestId"], "confirmInterrupt": request["confirmInterrupt"]}
        elif intent != "install":
            raise Rejected("Unsupported maintenance intent.")
        if not isinstance(request, dict) or set(request) not in ({"candidateId", "requestId", "confirmInterrupt"}, {"candidateId", "requestId", "confirmInterrupt", "whenIdle"}):
            raise Rejected("Send an opaque staged candidate, retry identity and interruption choice.")
        if not isinstance(request["candidateId"], str) or not SHA.fullmatch(request["candidateId"]) or not isinstance(request["requestId"], str) or not TOKEN.fullmatch(request["requestId"]) or type(request["confirmInterrupt"]) is not bool:
            raise Rejected("Send an opaque staged candidate, retry identity and interruption choice.")
        if "whenIdle" in request and (request["whenIdle"] is not True or request["confirmInterrupt"]):
            raise Rejected("An idle installation cannot authorize playback interruption.")
        with self.mutex:
            existing = self.directory / (request["requestId"] + ".json")
            if existing.exists():
                previous = load_json(existing.read_bytes())
                if previous.get("intent", "install") != intent or previous.get("repairRuntime", False) != repair_runtime or any(previous.get(key) != value for key, value in request.items()) or previous.get("whenIdle", False) != request.get("whenIdle", False):
                    raise Rejected("That retry identity belongs to another update request.")
                return public(previous), False
            with self.storage.lock():
                if self.record and self.record["phase"] not in FINISHED or self.storage.read("active.json"):
                    raise Rejected("Finish the current maintenance transaction before another update.")
                if intent == "repair-current" and (self.current_summary() or {}).get("candidateId") != request["candidateId"]:
                    raise Rejected("The enrolled current release changed. Refresh Tools before repairing it.")
                self.record = {**request, **({"intent": intent, "repairRuntime": repair_runtime} if intent == "repair-current" else {}), "updateId": uuid.uuid4().hex, "nonce": uuid.uuid4().hex, "phase": "accepted", "error": None, "disrupted": False, "hookComplete": False, "committed": False, "createdAt": int(time.time() * 1000)}
                self.persist()
                return public(self.record), True

    def execute(self):
        with self.storage.lock():
            try:
                self.transition("preflight")
                key = self.key()
                repairing = self.record.get("intent") == "repair-current"
                try:
                    current = self.storage.current(key)
                    _, previous_manifest = copy_receipt(self.storage.receipts / current["candidateId"], None, key, False, current["candidateId"])
                except Rejected as error:
                    if repairing:
                        raise Rejected("The exact current-release receipt or archives are unavailable or failed authentication. Restore their authenticated copy through SSH before retrying repair.") from error
                    raise
                require_format(previous_manifest, current)
                candidate_id = self.record["candidateId"]
                if repairing:
                    if candidate_id != current["candidateId"]:
                        raise Rejected("Repair can reinstall only the enrolled current release.")
                    manifest = previous_manifest
                else:
                    _, manifest = self.storage.retain(self.platform.staging() / candidate_id, key, True, candidate_id)
                require_format(manifest, current)
                self.transition("preflight", **identity(manifest), previous=current)
                packages = [self.storage.receipts / candidate_id / package["filename"] for package in manifest["packages"]]
                self.platform.preflight(self.record, manifest, packages)
                self.platform.preserve_worker(self.record)
                self.transition("installing")
                self.platform.install(self.record, packages)
                if not self.record["hookComplete"]:
                    raise Rejected("APT did not complete this transaction's maintenance hook.")
                # Keep other package managers out of the repair verification/commit window.
                with self.platform.package_lock() if repairing else nullcontext():
                    self.transition("trial")
                    self.platform.start_trial(self.record)
                    self.platform.ready(self.record)
                    # Committing marks the data restoration boundary before any
                    # normal application writes can be admitted.
                    self.transition("committing", committed=True)
                    save(self.storage.root / "current.json", {"candidateId": candidate_id, **identity(manifest)})
                    self.platform.commit(self.record)
                    self.transition("succeeded")
                    self.clear_active()
            except Exception as error:
                if isinstance(error, IdleDeferred):
                    self.record["idleDeferred"] = True
                message = "Couch became active. Wait for five continuous idle minutes." if self.record.get("idleDeferred") else str(error) if isinstance(error, Rejected) else "The update could not finish. Inspect its retained log through SSH."
                phase = "operator-required" if self.record["disrupted"] or self.record["committed"] else "failed"
                self.transition(phase, error=message, updateError=message, recoveryPending=phase == "operator-required" and not self.record["committed"])
                if phase == "failed":
                    self.clear_active()

        if self.record.get("recoveryPending"):
            self.recover()
        if self.record["phase"] in FINISHED:
            self.release_worker()

    def release_worker(self):
        try:
            self.platform.release_worker(self.record)
        except Exception:
            # Package/data acceptance is already durable. Keep the frozen worker
            # usable and report cleanup through the root service journal.
            print("The retained updater service override needs SSH inspection.", flush=True)

    def recover(self):
        from recovery import restore
        drained = self.hook_idle.wait(HOOK_DRAIN_SECONDS)
        with self.mutex:
            if not self.record.get("recoveryPending"):
                return
            if not drained:
                self.transition("operator-required", recoveryPending=False, automaticFailed=True,
                                error="The previous maintenance hook did not stop. Inspect the worker through SSH.")
                return
        restore(self, self.record["updateId"], automatic=True)

    def hook(self, update_id, peer_pid=None):
        with self.mutex:
            if not self.record or update_id != self.record["updateId"] or self.record["phase"] not in ("installing", "quiescing"):
                raise Rejected("No matching updater-owned APT transaction is running.")
            self.platform.authorize_hook(peer_pid)
            if self.record["hookComplete"]:
                return {"ok": True}
            if self.record["phase"] == "quiescing":
                raise Rejected("This maintenance hook is already running.")
            self.platform.verify_current(self.record)
            record = self.record
            self.transition("quiescing", disrupted=True)
            self.hook_idle.clear()
        try:
            self.platform.quiesce(record)
            with self.mutex:
                if self.record is not record or self.record["phase"] != "quiescing":
                    raise Rejected("This maintenance transaction ended while the app was stopping.")
                self.platform.authorize_hook(peer_pid)
                self.transition("installing", hookComplete=True)
            return {"ok": True}
        except IdleDeferred:
            with self.mutex:
                if self.record is record and record.get("whenIdle") and not record["hookComplete"] and not record["committed"] and record["phase"] in ("quiescing", "operator-required"):
                    ended = record["phase"] == "operator-required"
                    self.transition("failed" if ended else "installing", disrupted=False, idleDeferred=True, recoveryPending=False,
                                    error="Couch became active. Wait for five continuous idle minutes.")
                    if ended:
                        self.clear_active()
            raise
        finally:
            self.hook_idle.set()
