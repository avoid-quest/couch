"""Socket-activated root worker. Shipped disabled until the real app protocol lands."""
import json
import os
import pwd
import socket
import socketserver
import struct
import sys
import threading

sys.path.insert(0, "/usr/lib/couch-appliance/updater")
from receipt import Rejected, load_json
from retention import Retention
from transactions import Transactions
from ubuntu import Ubuntu


class Handler(socketserver.BaseRequestHandler):
    def handle(self):
        self.request.settimeout(10)
        try:
            pid, uid, _ = struct.unpack("3i", self.request.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
            if uid not in (0, self.server.app_uid):
                raise Rejected("This socket is restricted to the Couch runtime account.")
            data = bytearray()
            while b"\n" not in data and len(data) <= 4096:
                block = self.request.recv(4096)
                if not block:
                    break
                data.extend(block)
            if len(data) > 4096 or not data.endswith(b"\n"):
                raise Rejected("Send one bounded update request.")
            request = load_json(data)
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
            self.request.sendall(json.dumps(response).encode() + b"\n")
        except OSError:
            pass


class Server(socketserver.ThreadingUnixStreamServer):
    daemon_threads = True
    request_queue_size = 8
    worker = None


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
