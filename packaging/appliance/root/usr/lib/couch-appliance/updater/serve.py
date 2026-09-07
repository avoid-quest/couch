"""Socket-activated root worker. Shipped disabled until explicit SSH activation."""
import json
import os
from pathlib import Path
import pwd
import socket
import socketserver
import struct
import sys
import threading
import time

sys.path.insert(0, str(Path(__file__).resolve().parent))
from receipt import Rejected, load_json
from retention import Retention
from transactions import FINISHED, Transactions
from ubuntu import Ubuntu
from maintenance import remaining
from recovery import restore


class Handler(socketserver.BaseRequestHandler):
    request_timeout = 10

    def handle(self):
        deadline = time.monotonic() + self.request_timeout
        try:
            pid, uid, _ = struct.unpack("3i", self.request.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
            if uid not in (0, self.server.app_uid):
                raise Rejected("This socket is restricted to the Couch runtime account.")
            data = bytearray()
            while b"\n" not in data and len(data) <= 4096:
                self.request.settimeout(remaining(deadline))
                block = self.request.recv(4096)
                if not block:
                    break
                data.extend(block)
            if len(data) > 4096 or not data.endswith(b"\n"):
                raise Rejected("Send one bounded update request.")
            request = load_json(data)
            remaining(deadline)
            if not isinstance(request, dict):
                raise Rejected("Send one update operation.")
            operation = request.pop("op", None)
            if operation == "status" and set(request) <= {"requestId"}:
                result = {"transaction": self.server.transactions.status(request.get("requestId")), "current": self.server.transactions.current_summary(), "repairCurrent": True}
            elif operation == "context" and not request:
                result = {"context": self.server.transactions.context()}
            elif operation in ("install", "repair-current"):
                with self.server.transactions.mutex:
                    if getattr(self.server, "retire_enabled", False): self.server.reject_retiring()
                    record, start = self.server.transactions.submit(request, operation)
                    # Start independently of whether the caller receives this reply.
                    if start:
                        self.server.worker = threading.Thread(target=self.server.transactions.execute, daemon=False)
                        self.server.worker.start()
                result = {"transaction": record}
            elif operation == "restore" and uid == 0 and set(request) == {"updateId"}:
                if getattr(self.server, "retire_enabled", False):
                    with self.server.transactions.mutex:
                        self.server.reject_retiring()
                result = {"transaction": restore(self.server.transactions, request["updateId"])}
                if result["transaction"]["phase"] != "restored":
                    raise Rejected(result["transaction"].get("error") or "Restoration did not finish. Inspect the retained transaction through SSH.")
            elif operation == "hook" and uid == 0 and set(request) == {"updateId"}:
                result = self.server.transactions.hook(request["updateId"], pid)
            else:
                raise Rejected("Unsupported update worker operation.")
            response = {"ok": True, **result}
        except Exception as error:
            response = {"ok": False, "error": str(error) if isinstance(error, Rejected) else "The update worker could not complete this operation."}
        try:
            # Quiescing may take longer than request ingestion. sendall has
            # its own total timeout; incoming clients still get ten seconds.
            self.request.settimeout(10)
            self.request.sendall(json.dumps(response).encode() + b"\n")
        except (OSError, Rejected):
            pass


class Server(socketserver.ThreadingUnixStreamServer):
    daemon_threads = True
    request_queue_size = 8
    worker = None
    max_handlers = 8

    def __init__(self, *args, **kwargs):
        self.slots = threading.BoundedSemaphore(self.max_handlers)
        self.handlers = 0
        self.retiring = False
        self.retire_enabled = False
        self.drain = threading.Lock()
        super().__init__(*args, **kwargs)

    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        with self.drain:
            self.handlers += 1
        try:
            super().process_request(request, client_address)
        except BaseException:
            with self.drain:
                self.handlers -= 1
            self.slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            with self.drain:
                self.handlers -= 1
            self.slots.release()

    def reject_retiring(self):
        if self.transactions.record and self.transactions.record["phase"] in FINISHED:
            self.retiring = True
        if self.retiring:
            raise Rejected("The completed worker is handing over to installed code. Read status and retry the same request.")

    def serve_until_idle(self, finalize, retained_idle=False):
        self.retire_enabled = True
        self.retiring = retained_idle
        self.timeout = 0.25
        while True:
            # Only this loop accepts new sockets. Once all replies and the
            # transaction have drained, leave queued requests to socket activation.
            with self.drain:
                drained = not self.handlers and not (self.worker and self.worker.is_alive())
            with self.transactions.mutex:
                terminal = self.transactions.record and self.transactions.record["phase"] in FINISHED
                self.retiring = self.retiring or bool(terminal)
            if drained and self.retiring:
                try:
                    finalize()
                except Exception:
                    print("The idle updater could not hand over to its installed code. Inspect it through SSH.", flush=True)
                    self.serve_forever()
                return
            self.handle_request()


def main():
    if os.geteuid() != 0 or os.environ.get("LISTEN_PID") != str(os.getpid()) or os.environ.get("LISTEN_FDS") != "1":
        sys.exit("Start the worker through its fixed systemd socket unit.")
    os.umask(0o077)
    storage = Retention()
    # A separate instance cannot alter an existing transaction before obtaining
    # its root storage lock. systemd owns the sole listening socket.
    transactions = Transactions(storage, Ubuntu(storage.root))
    frozen = Path(__file__).resolve().parent
    retained_idle = not transactions.context() and frozen.parent == storage.root / "workers"
    with Server("/run/couch-updater/control.sock", Handler, bind_and_activate=False) as server:
        server.socket.close()
        server.socket = socket.socket(fileno=3)
        server.app_uid = pwd.getpwnam("couch-tv").pw_uid
        server.transactions = transactions
        if transactions.record and transactions.record.get("recoveryPending"):
            server.worker = threading.Thread(target=transactions.recover, daemon=False)
            server.worker.start()
        server.serve_until_idle(lambda: transactions.platform.release_worker({"updateId": transactions.record["updateId"] if transactions.record else frozen.name}), retained_idle)


if __name__ == "__main__":
    main()
