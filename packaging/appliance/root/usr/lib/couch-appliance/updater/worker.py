"""Keep the active updater available across replacement of its own APT package."""
import os
from pathlib import Path
import re
import shutil
import tempfile

from receipt import Rejected, run, trusted_file
from retention import sync_directory

MODULES = ("serve", "transactions", "recovery", "ubuntu", "worker", "receipt", "retention", "maintenance", "hook")
SOURCE = Path("/usr/lib/couch-appliance/updater")
OVERRIDE = Path("/etc/systemd/system/couch-updater.service.d/90-transaction.conf")


def configuration(root, update_id):
    if not re.fullmatch(r"[a-f0-9]{32}", update_id):
        raise Rejected("The retained worker identity is invalid.")
    return f"[Service]\nExecStart=\nExecStart=/usr/bin/python3 -I {root}/workers/{update_id}/serve.py\n".encode()


def preserve(root, update_id):
    content = configuration(root, update_id)
    workers = root / "workers"
    workers.mkdir(mode=0o700, exist_ok=True)
    sync_directory(root)
    destination = workers / update_id
    temporary = Path(tempfile.mkdtemp(prefix=".worker-", dir=workers))
    try:
        for name in MODULES:
            with (temporary / (name + ".py")).open("xb") as stream:
                stream.write(trusted_file(SOURCE / (name + ".py")))
                stream.flush()
                os.fsync(stream.fileno())
        sync_directory(temporary)
        os.rename(temporary, destination)
        sync_directory(workers)
    finally:
        shutil.rmtree(temporary, ignore_errors=True)
    OVERRIDE.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
    sync_directory(OVERRIDE.parent.parent)
    if OVERRIDE.exists() and trusted_file(OVERRIDE) != content:
        raise Rejected("Another updater service override needs administrator inspection.")
    descriptor, path = tempfile.mkstemp(prefix=".transaction-", dir=OVERRIDE.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(path, OVERRIDE)
        sync_directory(OVERRIDE.parent)
    finally:
        Path(path).unlink(missing_ok=True)
    run("/usr/bin/systemctl", "daemon-reload")


def release(root, update_id):
    if not OVERRIDE.exists():
        return
    if trusted_file(OVERRIDE) != configuration(root, update_id):
        raise Rejected("The updater service override belongs to another transaction.")
    OVERRIDE.unlink()
    sync_directory(OVERRIDE.parent)
    run("/usr/bin/systemctl", "daemon-reload")
