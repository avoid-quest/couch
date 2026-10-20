#!/usr/bin/env python3
"""Test-owned JACK registry and IPC, with offline loopback for standalone runs."""
import ctypes
import json
import os
from pathlib import Path
import signal
import subprocess
import sys

UNSHARE = ["unshare", "--user", "--map-root-user", "--mount", "--ipc",
           "--pid", "--fork", "--mount-proc", "--kill-child", "--propagation", "private"]


def snapshot():
    shm = os.stat("/dev/shm")
    return {"shm": {"path": "/dev/shm", "device": shm.st_dev, "inode": shm.st_ino},
            "namespaces": {name: os.readlink(f"/proc/self/ns/{ns}") for name, ns in
                           [("user", "user"), ("mount", "mnt"), ("ipc", "ipc"), ("pid", "pid")]}}


def validate():
    try:
        metadata = json.loads(os.environ["COUCH_LAB_IPC"])
        current = snapshot()
        if (metadata["schema"] != "couch-lab-ipc/1"
                or metadata["origin"] not in ["standalone", "network"]
                or any(metadata[key] != value for key, value in current.items())
                or current["shm"]["device"] == metadata["host"]["shm"]["device"]
                or any(value == metadata["host"]["namespaces"][key]
                       for key, value in current["namespaces"].items())):
            raise ValueError("isolation identities do not match")
        return metadata
    except (KeyError, TypeError, ValueError) as error:
        raise RuntimeError("refusing stale or invalid COUCH_LAB_IPC isolation metadata") from error


def mount_private_shm(host, origin):
    current = snapshot()
    # Check BEFORE mounting: even direct invocation of an internal entry point
    # must not cover the owner's shared memory or change host mount propagation.
    if (os.getpid() != 1 or current["shm"] != host["shm"]
            or any(value == host["namespaces"][key] for key, value in current["namespaces"].items())):
        raise RuntimeError("refusing shared-memory setup outside fresh user/mount/IPC/PID namespaces")
    subprocess.run(["mount", "--no-mtab", "-t", "tmpfs", "-o", "mode=1777,nosuid,nodev",
                    "couch-lab-shm", "/dev/shm"], check=True)
    metadata = {"schema": "couch-lab-ipc/1", "origin": origin, **snapshot(), "host": host}
    os.environ["COUCH_LAB_IPC"] = json.dumps(metadata)
    return validate()


def die_with_parent(parent_pid):
    # unshare --kill-child covers unshare -> namespace init. This covers the
    # caller -> supervisor -> unshare edges too, including SIGKILL and crashes.
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(1, signal.SIGKILL, 0, 0, 0) != 0:  # PR_SET_PDEATHSIG
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error))
    if os.getppid() != parent_pid:  # Parent may have exited before prctl.
        os.kill(os.getpid(), signal.SIGKILL)


def main(argv):
    if argv and argv[0] == "_inside":
        mount_private_shm(json.loads(os.environ.pop("COUCH_LAB_IPC_HOST")), "standalone")
        if os.readlink("/proc/self/ns/net") == os.environ.pop("COUCH_LAB_HOST_NETNS"):
            raise RuntimeError("refusing loopback setup outside a fresh network namespace")
        os.environ["PATH"] = os.environ.get("PATH", "") + ":/usr/sbin:/sbin"
        subprocess.run(["ip", "link", "set", "lo", "up"], check=True)
        # Keep the application a regular process; PID 1 exits when it does,
        # making the kernel kill every remaining descendant (also setsid ones).
        result = subprocess.run(argv[1:]).returncode
        return result if result >= 0 else 128 - result
    if len(argv) < 2 or argv[0] != "--":
        print("usage: scripts/live-audio-lab.sh -- COMMAND [ARG ...]", file=sys.stderr)
        return 2
    if "COUCH_LAB_IPC" in os.environ:
        validate()
        # In particular, preserve network manifest PID visibility.
        os.execvp(argv[1], argv[1:])
    if os.environ.get("COUCH_NETWORK_MANIFEST"):
        raise RuntimeError("network runner must establish COUCH_LAB_IPC before launching a command")

    die_with_parent(os.getppid())
    interrupted_by = 0

    def interrupted(signum, frame):
        nonlocal interrupted_by
        interrupted_by = signum
        raise InterruptedError(f"received signal {signum}")

    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    env = {**os.environ, "COUCH_LAB_IPC_HOST": json.dumps(snapshot()),
           "COUCH_LAB_HOST_NETNS": os.readlink("/proc/self/ns/net")}
    parent_pid = os.getpid()
    child = None
    try:
        child = subprocess.Popen(UNSHARE + ["--net", sys.executable, str(Path(__file__).resolve()),
                                          "_inside", *argv[1:]], env=env,
                                 preexec_fn=lambda: die_with_parent(parent_pid))
        result = child.wait()
        return result if result >= 0 else 128 - result
    except InterruptedError:
        return 128 + interrupted_by
    finally:
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        signal.signal(signal.SIGINT, signal.SIG_IGN)
        if child and child.poll() is None:
            # unshare --fork ignores TERM/INT (unshare(1)); KILL triggers its
            # --kill-child contract immediately, without waiting on the app.
            child.kill()
            child.wait(timeout=5)


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        print(f"audio lab isolation: {error}", file=sys.stderr)
        sys.exit(1)
