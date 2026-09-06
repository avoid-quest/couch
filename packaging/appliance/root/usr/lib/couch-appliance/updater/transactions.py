"""Durable update identity and the single maintenance transaction state machine."""
import re
import threading
import time
import uuid

from receipt import Rejected, SHA, enrolled_key, load_json
from retention import identity, require_format, save, sync_directory

TOKEN = re.compile(r"[a-f0-9]{32}\Z")
FINISHED = {"succeeded", "failed"}


def public(record):
    return {key: record.get(key) for key in ("updateId", "candidateId", "version", "revision", "phase", "error", "createdAt", "updatedAt")}


class Transactions:
    def __init__(self, storage, platform, key=enrolled_key):
        self.storage, self.platform, self.key = storage, platform, key
        self.directory = storage.root / "transactions"
        self.directory.mkdir(mode=0o700, exist_ok=True)
        self.mutex = threading.RLock()
        self.record = storage.read("active.json")
        if not self.record:
            pending = [load_json(path.read_bytes()) for path in self.directory.glob("*.json")]
            pending = [value for value in pending if value["phase"] not in FINISHED]
            if len(pending) > 1:
                raise Rejected("Multiple unfinished transactions require administrator inspection.")
            self.record = pending[0] if pending else None
        if self.record:
            with storage.lock():
                # Recovery after package mutation is intentionally owned by the
                # later recovery layer. Never guess success or restart a loop.
                interrupted = self.record["phase"] not in ("accepted", "preflight")
                self.record.update(phase="operator-required" if interrupted else "failed", error="The update worker restarted. Inspect this transaction through SSH.")
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

    def submit(self, request):
        if not isinstance(request, dict) or set(request) != {"candidateId", "requestId", "confirmInterrupt"} or not isinstance(request["candidateId"], str) or not SHA.fullmatch(request["candidateId"]) or not isinstance(request["requestId"], str) or not TOKEN.fullmatch(request["requestId"]) or type(request["confirmInterrupt"]) is not bool:
            raise Rejected("Send an opaque staged candidate, retry identity and interruption choice.")
        with self.mutex:
            existing = self.directory / (request["requestId"] + ".json")
            if existing.exists():
                previous = load_json(existing.read_bytes())
                if any(previous[key] != value for key, value in request.items()):
                    raise Rejected("That retry identity belongs to another update request.")
                return public(previous), False
            with self.storage.lock():
                if self.record and self.record["phase"] not in FINISHED or self.storage.read("active.json"):
                    raise Rejected("Finish the current maintenance transaction before another update.")
                self.record = {**request, "updateId": uuid.uuid4().hex, "nonce": uuid.uuid4().hex, "phase": "accepted", "error": None, "disrupted": False, "hookComplete": False, "committed": False, "createdAt": int(time.time() * 1000)}
                self.persist()
                return public(self.record), True

    def execute(self):
        with self.storage.lock():
            try:
                self.transition("preflight")
                key = self.key()
                current = self.storage.current(key)
                candidate_id = self.record["candidateId"]
                _, manifest = self.storage.retain(self.platform.staging() / candidate_id, key, True, candidate_id)
                require_format(manifest, current)
                self.transition("preflight", **identity(manifest), previous=current)
                packages = [self.storage.receipts / candidate_id / package["filename"] for package in manifest["packages"]]
                self.platform.preflight(self.record, manifest, packages)
                self.transition("installing")
                self.platform.install(self.record, packages)
                if not self.record["hookComplete"]:
                    raise Rejected("APT did not complete this transaction's maintenance hook.")
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
                message = str(error) if isinstance(error, Rejected) else "The update could not finish. Inspect its retained log through SSH."
                phase = "operator-required" if self.record["disrupted"] or self.record["committed"] else "failed"
                self.transition(phase, error=message)
                if phase == "failed":
                    self.clear_active()

    def hook(self, update_id, peer_pid=None):
        with self.mutex:
            if not self.record or update_id != self.record["updateId"] or self.record["phase"] not in ("installing", "quiescing"):
                raise Rejected("No matching updater-owned APT transaction is running.")
            self.platform.authorize_hook(peer_pid)
            if self.record["hookComplete"]:
                return {"ok": True}
            if self.record["phase"] == "quiescing":
                raise Rejected("This maintenance hook is already running.")
            self.transition("quiescing", disrupted=True)
        self.platform.quiesce(self.record)
        self.transition("installing", hookComplete=True)
        return {"ok": True}
