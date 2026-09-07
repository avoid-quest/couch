"""Fixed root-only activation and SSH recovery client."""
import os
from pathlib import Path
import socket
import stat
import struct
import time

from bridge import frame
from maintenance import remaining
from receipt import Rejected, enrolled_key, load_json, run, trusted_file
from retention import installed, save
from ubuntu import Ubuntu

SOCKET = "/run/couch-updater/control.sock"
FLAG = Path("/etc/couch/manual-updates.enabled")


def request(payload):
    run("/usr/bin/systemctl", "start", "couch-updater.socket")
    deadline = time.monotonic() + 32 * 60
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
        connection.settimeout(remaining(deadline))
        connection.connect(SOCKET)
        if struct.unpack("3i", connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))[1] != 0:
            raise Rejected("The update socket does not belong to root.")
        connection.settimeout(remaining(deadline))
        connection.sendall(frame(payload))
        data = bytearray()
        while b"\n" not in data and len(data) <= 65536:
            connection.settimeout(remaining(deadline))
            block = connection.recv(4096)
            if not block:
                break
            data.extend(block)
        if len(data) > 65536 or not data.endswith(b"\n"):
            raise Rejected("The update worker did not return a complete recovery result. Inspect status before retrying.")
        value = load_json(data)
        if value.get("ok") is not True:
            raise Rejected(value.get("error", "The update worker rejected this recovery request."))
        transaction = value["transaction"]
        if payload.get("op") == "restore" and (transaction.get("phase") != "restored" or transaction.get("updateId") != payload["updateId"]):
            raise Rejected("Restoration did not return the matching completed transaction. Inspect status through SSH.")
        return transaction


def activation_status():
    try:
        FLAG.lstat()
    except FileNotFoundError:
        return "disabled"
    parent = FLAG.parent.lstat()
    if not stat.S_ISDIR(parent.st_mode) or parent.st_uid != 0 or parent.st_mode & 0o022:
        raise Rejected("The appliance configuration directory must be root-owned.")
    if load_json(trusted_file(FLAG)) != {"protocol": "maintenance-v1"}:
        raise Rejected("The phone-update activation flag is invalid.")
    return "enabled"


def enable(storage):
    with storage.lock():
        if storage.read("active.json"):
            raise Rejected("Resolve the active transaction before enabling phone updates.")
        current = storage.current(enrolled_key())
        build = installed()
        if build.get("maintenanceProtocol") != "maintenance-v1" or type(build.get("dataFormat")) is not int or type(current.get("dataFormat")) is not int or build.get("dataFormat") != 1 or any(build.get(key) != current[key] for key in ("version", "revision", "dataFormat")):
            raise Rejected("Enroll the installed manual-update-capable release before activation.")
        if run("/usr/bin/dpkg", "--audit").strip():
            raise Rejected("Repair the package manager before enabling updates.")
        trusted_file("/etc/couch/appliance.env")
        info = FLAG.parent.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise Rejected("The appliance configuration directory must be root-owned.")
        save(FLAG, {"protocol": "maintenance-v1"})
        run("/usr/bin/systemctl", "enable", "--now", "couch-updater.socket")
        Ubuntu(storage.root).systemctl("restart", "couch-tv.service")
        return {"phoneUpdates": "enabled", "current": current}
