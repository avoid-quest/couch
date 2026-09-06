"""Socket-activated root worker. Shipped disabled until the real app protocol lands."""
import json
import os
import pwd
import socket
import socketserver
import struct
import sys
import threading
import time

sys.path.insert(0, "/usr/lib/couch-appliance/updater")
from receipt import Rejected, load_json
from retention import Retention
from transactions import Transactions
from ubuntu import Ubuntu
from maintenance import remaining


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
                result = {"transaction": self.server.transactions.status(request.get("requestId"))}
            elif operation == "install":
                record, start = self.server.transactions.submit(request)
                # Start independently of whether the caller receives this reply.
                if start:
                    self.server.worker = threading.Thread(target=self.server.transactions.execute, daemon=False)
                    self.server.worker.start()
                result = {"transaction": record}
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
        super().__init__(*args, **kwargs)

    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self.slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()


def main():
    if os.geteuid() != 0 or os.environ.get("LISTEN_PID") != str(os.getpid()) or os.environ.get("LISTEN_FDS") != "1":
        sys.exit("Start the worker through its fixed systemd socket unit.")
    os.umask(0o077)
    storage = Retention()
    # A separate instance cannot alter an existing transaction before obtaining
    # its root storage lock. systemd owns the sole listening socket.
    transactions = Transactions(storage, Ubuntu(storage.root))
    with Server("/run/couch-updater/control.sock", Handler, bind_and_activate=False) as server:
        server.socket.close()
        server.socket = socket.socket(fileno=3)
        server.app_uid = pwd.getpwnam("couch-tv").pw_uid
        server.transactions = transactions
        server.serve_forever()


if __name__ == "__main__":
    main()
