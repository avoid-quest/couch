"""No audio: exercise private registry lifetime and stubborn descendants."""
import errno
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time

sys.dont_write_bytecode = True
import isolation

mode, directory = sys.argv[1], Path(sys.argv[2])
wrapper = str(Path(__file__).resolve().parents[2] / "scripts/live-audio-lab.sh")

if mode == "network":
    netns = os.readlink("/proc/self/ns/net")
    assert netns != sys.argv[3], "standalone lab still shares the host network namespace"
    links = json.loads(subprocess.check_output(["ip", "-j", "link"]))
    assert [link["ifname"] for link in links] == ["lo"]
    assert "UP" in links[0]["flags"]
    for family in ["-4", "-6"]:
        routes = json.loads(subprocess.check_output(["ip", family, "-j", "route", "show", "table", "all"]))
        assert all(route.get("dev") == "lo" and route["dst"] != "default" for route in routes)
    with socket.socket() as external:
        external.settimeout(1)
        # A documentation address: after confirming fresh netns, this must
        # fail locally without any packets reaching the host or Internet.
        assert external.connect_ex(("192.0.2.1", 9)) == errno.ENETUNREACH
    with socket.socket() as server:
        server.settimeout(3)
        server.bind(("127.0.0.1", 0))
        server.listen()
        client = subprocess.Popen(["bash", wrapper, "--", sys.executable, "-c",
                                   "import socket,sys; "
                                   "s=socket.create_connection(('127.0.0.1',int(sys.argv[1])),timeout=3); "
                                   "s.sendall(b'loopback'); assert s.recv(8)==b'loopback'",
                                   str(server.getsockname()[1])])
        conn, _ = server.accept()
        with conn:
            conn.settimeout(3)
            payload = conn.recv(8)
            assert payload == b"loopback"
            conn.sendall(payload)
        assert client.wait(timeout=3) == 0
    sys.exit(0)

if mode == "daemon":
    if os.fork():
        sys.exit(0)
    os.setsid()
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    while True:
        (directory / "heartbeat").write_text(str(time.monotonic_ns()))
        time.sleep(0.02)

metadata = isolation.validate()
(directory / ("child.json" if mode == "child" else "isolation.json")).write_text(json.dumps(metadata))
registry = Path("/dev/shm/jack-shm-registry")
if mode == "child":
    assert registry.read_text() == "private test registry"
    sys.exit(0)

# Opening this name exclusively catches the real failure pattern: runs must
# never inherit JACK's global registry, including a previous run's registry.
assert not list(Path("/dev/shm").iterdir()), "shared memory was not empty at lab startup"
with registry.open("x") as output:
    output.write("private test registry")

if mode == "probe":
    subprocess.run(["bash", wrapper, "--", sys.executable, __file__, "child", str(directory)], check=True)
else:
    subprocess.Popen([sys.executable, __file__, "daemon", str(directory)], start_new_session=True,
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    until = time.monotonic() + 3
    while not (directory / "heartbeat").exists():
        if time.monotonic() > until:
            raise RuntimeError("detached child did not start")
        time.sleep(0.01)
    if mode == "linger":
        time.sleep(60)
    sys.exit(17 if mode == "fail" else 0)
