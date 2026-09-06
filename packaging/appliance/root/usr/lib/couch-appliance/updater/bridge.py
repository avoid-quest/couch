"""Unprivileged Linux peer-credential bridge, connected only to the app's pipes."""
import json
import os
from pathlib import Path
import pwd
import selectors
import socket
import stat
import struct
import sys
import time
import uuid

LIMIT = 65536
TIMEOUT = 30
WORKER = "/run/couch-updater/control.sock"


def frame(value):
    data = json.dumps(value, separators=(",", ":")).encode() + b"\n"
    if len(data) > LIMIT:
        raise ValueError("Oversized private frame")
    return data


def peer(connection, uid):
    if struct.unpack("3i", connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))[1] != uid:
        raise ValueError("Unexpected local peer")


class Bridge:
    def __init__(self, listener, incoming=0, outgoing=1):
        self.selector = selectors.DefaultSelector()
        self.listener, self.incoming, self.outgoing = listener, incoming, outgoing
        self.connections = {}
        self.input = bytearray()
        self.output = bytearray()
        self.output_deadline = None
        self.input_deadline = None
        for descriptor in (incoming, outgoing):
            os.set_blocking(descriptor, False)
        listener.setblocking(False)
        self.selector.register(listener, selectors.EVENT_READ, "listen")
        self.selector.register(incoming, selectors.EVENT_READ, "input")

    def emit(self, value):
        data = frame(value)
        if len(self.output) + len(data) > LIMIT:
            raise ValueError("Private output queue full")
        if not self.output:
            self.output_deadline = time.monotonic() + 5
            self.selector.register(self.outgoing, selectors.EVENT_WRITE, "output")
        self.output.extend(data)

    def drop(self, token):
        item = self.connections.pop(token)
        self.selector.unregister(item["socket"])
        item["socket"].close()

    def connect(self, connection, token, kind, output=b""):
        if len(self.connections) >= 8 or token in self.connections:
            connection.close()
            raise ValueError("Private request limit")
        connection.setblocking(False)
        self.connections[token] = {"socket": connection, "kind": kind, "input": bytearray(), "output": bytearray(output), "deadline": time.monotonic() + (10 if kind == "worker" else TIMEOUT), "waiting": False}
        self.selector.register(connection, selectors.EVENT_WRITE if output else selectors.EVENT_READ, token)

    def message(self, value):
        if not isinstance(value, dict) or set(value) != {"kind", "id", "payload"} or not isinstance(value["id"], str) or len(value["id"]) != 32 or any(char not in "0123456789abcdef" for char in value["id"]):
            raise ValueError("Invalid private frame")
        token, payload = value["id"], value["payload"]
        if value["kind"] == "reply":
            item = self.connections.get(token)
            if not item or item["kind"] != "maintenance" or not item["waiting"] or time.monotonic() >= item["deadline"]:
                raise ValueError("Unmatched private reply")
            item["output"] = bytearray(frame(payload))
            item["waiting"] = False
            self.selector.modify(item["socket"], selectors.EVENT_WRITE, token)
        elif value["kind"] == "worker" and isinstance(payload, dict) and payload.get("op") in ("context", "status", "install"):
            connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            try:
                # The root-owned listener already exists; bound even a full accept queue.
                connection.settimeout(1)
                connection.connect(WORKER)
                peer(connection, 0)
                self.connect(connection, token, "worker", frame(payload))
            except Exception:
                connection.close()
                raise
        else:
            raise ValueError("Unsupported private operation")

    def run(self):
        self.emit({"kind": "ready"})
        while True:
            now = time.monotonic()
            if self.output_deadline is not None and now >= self.output_deadline:
                raise TimeoutError("Private output deadline")
            if self.input_deadline is not None and now >= self.input_deadline:
                raise TimeoutError("Private input deadline")
            for token, item in list(self.connections.items()):
                if now >= item["deadline"]:
                    self.drop(token)
                    # The app treats bridge loss as a closed maintenance gate.
                    raise TimeoutError("Private request deadline")
            for key, events in self.selector.select(0.1):
                token = key.data
                if token == "listen":
                    connection, _ = self.listener.accept()
                    try:
                        peer(connection, 0)
                        self.connect(connection, uuid.uuid4().hex, "maintenance")
                    except ValueError:
                        connection.close()
                elif token == "input":
                    block = os.read(self.incoming, 4096)
                    if not block:
                        return
                    if not self.input:
                        self.input_deadline = time.monotonic() + 10
                    self.input.extend(block)
                    if len(self.input) > LIMIT:
                        raise ValueError("Oversized private input")
                    while b"\n" in self.input:
                        line, _, rest = self.input.partition(b"\n")
                        self.input = bytearray(rest)
                        self.message(json.loads(line))
                    if not self.input:
                        self.input_deadline = None
                elif token == "output":
                    del self.output[:os.write(self.outgoing, self.output)]
                    if not self.output:
                        self.selector.unregister(self.outgoing)
                        self.output_deadline = None
                else:
                    item = self.connections[token]
                    if events & selectors.EVENT_WRITE:
                        del item["output"][:item["socket"].send(item["output"])]
                        if not item["output"]:
                            if item["kind"] == "maintenance":
                                self.drop(token)
                            else:
                                self.selector.modify(item["socket"], selectors.EVENT_READ, token)
                    else:
                        block = item["socket"].recv(4096)
                        if not block:
                            self.drop(token)
                            continue
                        if item["waiting"]:
                            raise ValueError("Duplicate local request")
                        item["input"].extend(block)
                        if len(item["input"]) > LIMIT:
                            raise ValueError("Oversized local frame")
                        if b"\n" not in item["input"]:
                            continue
                        if not item["input"].endswith(b"\n") or item["input"].count(b"\n") != 1:
                            raise ValueError("Invalid local frame")
                        payload = json.loads(item["input"])
                        self.emit({"kind": "request" if item["kind"] == "maintenance" else "result", "id": token, "payload": payload})
                        if item["kind"] == "worker":
                            self.drop(token)
                        else:
                            item["waiting"] = True
                            # A disconnected root caller is detected before its reply.
                            self.selector.unregister(item["socket"])
                            self.selector.register(item["socket"], selectors.EVENT_READ, token)

    def close(self):
        for token in list(self.connections):
            self.drop(token)
        self.selector.close()


def main():
    uid = pwd.getpwnam("couch-tv").pw_uid
    if uid == 0 or os.geteuid() != uid:
        raise ValueError("Run as the Couch runtime account")
    directory = Path(f"/run/user/{uid}")
    info = directory.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != uid or stat.S_IMODE(info.st_mode) != 0o700:
        raise ValueError("Invalid Couch runtime directory")
    path = directory / "couch-maintenance.sock"
    # Never replace an existing live listener. systemd owns process lifetime.
    if path.exists():
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as probe:
            probe.settimeout(1)
            try:
                probe.connect(str(path))
            except ConnectionRefusedError:
                if not stat.S_ISSOCK(path.lstat().st_mode):
                    raise ValueError("Invalid maintenance socket")
                path.unlink()
            else:
                raise ValueError("Maintenance listener already exists")
    os.umask(0o077)
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as listener:
        listener.bind(str(path))
        listener.listen(8)
        bridge = Bridge(listener)
        try:
            bridge.run()
        finally:
            bridge.close()
            path.unlink(missing_ok=True)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Frames contain transaction nonces; never print exception payloads.
        sys.exit("The private maintenance bridge stopped.")
