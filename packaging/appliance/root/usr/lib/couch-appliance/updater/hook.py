"""Frozen per-transaction APT hook. Never install as a global APT hook."""
import json
import os
import re
import socket
import sys

if os.geteuid() != 0 or len(sys.argv) != 2 or not re.fullmatch(r"[a-f0-9]{32}", sys.argv[1]):
    sys.exit("An updater-owned root transaction is required.")
try:
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
        connection.settimeout(300)
        connection.connect("/run/couch-updater/control.sock")
        connection.sendall(json.dumps({"op": "hook", "updateId": sys.argv[1]}).encode() + b"\n")
        data = bytearray()
        while b"\n" not in data and len(data) < 4096:
            block = connection.recv(4096)
            if not block:
                break
            data.extend(block)
        if len(data) > 4096 or json.loads(data).get("ok") is not True:
            raise ValueError()
except (OSError, ValueError):
    sys.exit("The update worker did not authorize package installation.")
