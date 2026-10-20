"""Application-side regression fixture for the public network runner/exec CLI."""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time

sys.dont_write_bytecode = True
import isolation

manifest = json.loads(Path(os.environ["COUCH_NETWORK_MANIFEST"]).read_text())
port = manifest["port"]
evidence = Path(os.environ["COUCH_NETWORK_EVIDENCE"])

if len(sys.argv) == 1:
    metadata = isolation.validate()
    assert metadata["origin"] == "network"
    assert metadata["namespaces"]["pid"] == manifest["pidNamespace"]
    assert not list(Path("/dev/shm").iterdir())
    Path("/dev/shm/jack-shm-registry").write_text("private network test registry")
    # Re-entering the audio wrapper must preserve all manifest node PIDs.
    wrapper = str(Path(__file__).resolve().parents[2] / "scripts/live-audio-lab.sh")
    subprocess.run(["bash", wrapper, "--", sys.executable, __file__, "isolation"], check=True)
    launch = manifest["exec"]
    server = subprocess.Popen(launch + ["server", "--", sys.executable, __file__, "server"])
    while not (evidence / "fixture-ready").exists():
        if server.poll() is not None:
            raise RuntimeError("fixture server failed")
        time.sleep(0.01)
    for node in manifest["nodes"]:
        if node != "server":
            subprocess.run(launch + [node, "--", sys.executable, __file__, "client"], check=True)
    assert server.wait(timeout=5) == 0
elif sys.argv[1] == "isolation":
    assert isolation.validate()["namespaces"]["pid"] == manifest["pidNamespace"]
    for node in manifest["nodes"].values():
        assert os.readlink(f"/proc/{node['pid']}/ns/net") == node["netns"]
elif sys.argv[1] == "server":
    isolation.validate()
    assert Path("/dev/shm/jack-shm-registry").read_text() == "private network test registry"
    with socket.socket() as server:
        server.bind(("10.231.0.2", port))
        server.listen()
        (evidence / "fixture-ready").touch()
        for _ in range(len(manifest["nodes"]) - 1):
            conn, _ = server.accept()
            with conn:
                conn.sendall(conn.recv(256))
elif sys.argv[1] == "client":
    metadata = isolation.validate()
    assert Path("/dev/shm/jack-shm-registry").read_text() == "private network test registry"
    for address in ["127.0.0.1", "192.0.2.1"]:
        try:
            with socket.create_connection((address, port), timeout=0.2):
                raise AssertionError(f"unexpected bypass through {address}")
        except OSError:
            pass
    with socket.create_connection(("10.231.0.2", port), timeout=3) as conn:
        conn.sendall(b"real TCP through the application exec contract")
        assert conn.recv(256) == b"real TCP through the application exec contract"
    (evidence / (os.environ["COUCH_NETWORK_NODE"] + ".json")).write_text(json.dumps({
        "data": os.environ["COUCH_DATA_DIR"], "port": os.environ["COUCH_PORT"],
        "netns": os.readlink("/proc/self/ns/net"), "pidns": os.readlink("/proc/self/ns/pid"),
        "ipc": metadata,
    }))
elif sys.argv[1] in ["fail", "linger", "process-limit"]:
    subprocess.Popen([sys.executable, __file__, "daemon"], start_new_session=True)
    while not (evidence / "heartbeat").exists():
        time.sleep(0.01)
    if sys.argv[1] == "fail":
        sys.exit(17)
    if sys.argv[1] == "process-limit":
        for _ in range(20):
            subprocess.Popen(["sleep", "60"])
    time.sleep(60)
elif sys.argv[1] == "daemon":
    while True:
        (evidence / "heartbeat").write_text(str(time.monotonic_ns()))
        time.sleep(0.05)
