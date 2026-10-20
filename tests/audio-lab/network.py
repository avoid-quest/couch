#!/usr/bin/env python3
"""Disposable, rootless network fixture. No named or host network namespaces."""
import argparse
import json
import os
from pathlib import Path
import resource
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time

sys.dont_write_bytecode = True
import isolation

HERE = str(Path(__file__).resolve())
PYTHON = sys.executable
UNSHARE = [*isolation.UNSHARE, "--net"]
PROFILES = {
    "control": (0, 0, 0),
    "N0": (2, 1, 0),
    "N1": (5, 3, 0.1),
    "N2": (2, 1, 0),
}


def write_json(path, value):
    Path(path).write_text(json.dumps(value, indent=2) + "\n")


def number(low, high):
    def parse(value):
        try:
            result = int(value)
        except ValueError:
            raise argparse.ArgumentTypeError("must be an integer")
        if not low <= result <= high:
            raise argparse.ArgumentTypeError(f"must be between {low} and {high}")
        return result
    return parse


def options(argv):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["check", "plan", "verify", "run"])
    parser.add_argument("--profile", choices=PROFILES, default="N0")
    parser.add_argument("--clients", type=number(1, 100), default=2)
    parser.add_argument("--seed", type=number(1, 2147483000), default=1)
    parser.add_argument("--bad-client", type=number(1, 100), default=1)
    parser.add_argument("--down-kbps", type=number(128, 1000000), default=20000)
    parser.add_argument("--up-kbps", type=number(128, 1000000), default=20000)
    parser.add_argument("--queue-packets", type=number(8, 4096), default=256)
    parser.add_argument("--duration", type=number(1, 7200), default=120,
                        help="wall-time limit for setup, verification and command together")
    parser.add_argument("--cpu-list", help="CPU affinity, e.g. 2,3; no host CPU configuration")
    parser.add_argument("--max-processes", type=number(16, 4096), default=512)
    parser.add_argument("--max-rss-mb", type=number(128, 262144), default=8192)
    parser.add_argument("--evidence", help="new directory; never overwrites an existing directory")
    # Split explicitly so command flags are never interpreted as fixture flags.
    divider = argv.index("--") if "--" in argv else len(argv)
    args = parser.parse_args(argv[:divider])
    args.command = argv[divider + 1:]
    if (args.action == "run") != bool(args.command):
        parser.error("run requires -- COMMAND; other actions do not accept a command")
    if args.bad_client > args.clients:
        parser.error("--bad-client must identify an existing client")
    if args.cpu_list:
        try:
            cpus = {int(cpu) for cpu in args.cpu_list.split(",")}
            if not cpus or not cpus <= os.sched_getaffinity(0):
                raise ValueError()
        except (ValueError, AttributeError):
            parser.error("--cpu-list must be comma-separated CPU numbers in current affinity")
        args.cpu_list = sorted(cpus)
    return args


def plan(args):
    clients = []
    for index in range(1, args.clients + 1):
        delay, jitter, loss = PROFILES[args.profile]
        bad = args.profile == "N2" and index == args.bad_client
        if bad:
            delay, jitter, loss = (60, 20, 2)
        clients.append({"name": f"client-{index}", "address": f"10.231.{index + 1}.2",
                        "delayMsEachDirection": delay, "jitterMsEachDirection": jitter,
                        "lossPercentEachDirection": loss,
                        "downSeed": args.seed + index * 2, "upSeed": args.seed + index * 2 + 1,
                        "capKbpsEachDirection": 128 if bad else None})
    return {"profile": args.profile, "seed": args.seed, "clients": clients,
            "sharedDownKbps": None if args.profile == "control" else args.down_kbps,
            "sharedUpKbps": None if args.profile == "control" else args.up_kbps,
            "queuePacketsPerNetem": args.queue_packets, "jitterDistribution": "uniform",
            "resources": {"wallSeconds": args.duration, "cpuAffinity": args.cpu_list,
                          "maxProcesses": args.max_processes, "maxSummedRssMiB": args.max_rss_mb},
            "unsupported": ["N3 timed outages", "N4 TURN/UDP blocking", "N5 lifecycle",
                            "N6 clock drift/CPU quotas", "N7 dynamic/asymmetric/burst profiles"],
            "untested": ["phone acoustic latency", "Wi-Fi radios/contention", "browser audio output"]}


def tools_available():
    # Debian installs tc in sbin, which a regular user's PATH may omit.
    os.environ["PATH"] = os.environ.get("PATH", "") + ":/usr/sbin:/sbin"
    missing = [tool for tool in ["unshare", "nsenter", "mount", "ip", "tc"] if not shutil.which(tool)]
    if missing:
        raise RuntimeError("missing prerequisites: " + ", ".join(missing) + "; install util-linux and iproute2")


def prerequisite_check():
    tools_available()
    # This probe also lives entirely inside fresh namespaces, including failures.
    script = """
set -eu
mount --no-mtab -t tmpfs -o mode=1777,nosuid,nodev couch-lab-shm /dev/shm
ip link add probe0 type veth peer name probe1
tc qdisc add dev probe0 root netem limit 16 delay 2ms 1ms loss random 0.1% seed 1
tc qdisc add dev probe1 root handle 1: htb default 1
tc class add dev probe1 parent 1: classid 1:1 htb rate 20mbit
"""
    result = subprocess.run(UNSHARE + ["sh", "-c", script], text=True, capture_output=True, timeout=15)
    if result.returncode:
        raise RuntimeError("rootless user/net/mount/IPC/PID namespaces, private shm, veth, HTB or seeded netem unavailable: "
                           + result.stderr.strip())
    return {"status": "available", "backend": "rootless-unshare",
            "tc": subprocess.check_output(["tc", "-V"], text=True).strip(),
            "kernel": os.uname().release}


def node_command(node, *command):
    return ["nsenter", f"--net=/proc/{node['pid']}/ns/net", "--", *map(str, command)]


class Network:
    def __init__(self, config, scratch, evidence):
        self.config, self.scratch, self.evidence = config, Path(scratch), Path(evidence)
        self.nodes = {}
        self.keepers = []
        self.commands = (self.evidence / "commands.jsonl").open("w")

    def call(self, command, node=None, output=False):
        if node:
            command = node_command(self.nodes[node], *command)
        self.commands.write(json.dumps(command) + "\n")
        self.commands.flush()
        result = subprocess.run(command, capture_output=True, text=True, timeout=10)
        if result.returncode:
            raise RuntimeError(f"{command!r}: {result.stderr.strip()}")
        return result.stdout if output else None

    def namespace(self, name):
        # Popen's PID remains the namespace holder after unshare execs Python.
        keeper = subprocess.Popen(["unshare", "--net", PYTHON, HERE, "_hold"],
                                  stdout=subprocess.PIPE, text=True)
        self.keepers.append(keeper)
        if keeper.stdout.readline().strip() != "ready":
            raise RuntimeError(f"could not create {name} namespace")
        keeper.stdout.close()
        self.nodes[name] = {"pid": keeper.pid, "netns": os.readlink(f"/proc/{keeper.pid}/ns/net")}
        self.call(["ip", "link", "set", "lo", "up"], name)
        # /proc/sys/net is network-namespaced; no host sysctl is changed.
        self.call([PYTHON, "-c", "from pathlib import Path; "
                   "Path('/proc/sys/net/ipv6/conf/all/disable_ipv6').write_text('1'); "
                   "Path('/proc/sys/net/ipv6/conf/default/disable_ipv6').write_text('1')"], name)

    def link(self, first, first_if, first_address, second, second_if, second_address):
        self.call(["ip", "link", "add", first_if, "type", "veth", "peer", "name", second_if])
        for name, device, address in [(first, first_if, first_address), (second, second_if, second_address)]:
            self.call(["ip", "link", "set", device, "netns", str(self.nodes[name]["pid"])])
            self.call(["ip", "addr", "add", address + "/30", "dev", device], name)
            self.call(["ip", "link", "set", device, "up"], name)

    def route(self, node, destination, gateway):
        self.call(["ip", "route", "add", destination, "via", gateway], node)

    def netem(self, node, device, parent, handle, client=None, direction="down"):
        command = ["tc", "qdisc", "add", "dev", device, *parent, "handle", handle,
                   "netem", "limit", str(self.config["queuePacketsPerNetem"])]
        if client and client["delayMsEachDirection"]:
            command += ["delay", f"{client['delayMsEachDirection']}ms", f"{client['jitterMsEachDirection']}ms"]
        if client:
            if client["lossPercentEachDirection"]:
                command += ["loss", "random", f"{client['lossPercentEachDirection']}%"]
            command += ["seed", str(client[direction + "Seed"])]
            if client["capKbpsEachDirection"] and direction == "down":
                command += ["rate", f"{client['capKbpsEachDirection']}kbit"]
        self.call(command, node)

    def htb(self, device, rate, default):
        self.call(["tc", "qdisc", "add", "dev", device, "root", "handle", "1:",
                   "htb", "default", default], "router")
        self.call(["tc", "class", "add", "dev", device, "parent", "1:", "classid", "1:1",
                   "htb", "rate", f"{rate}kbit", "ceil", f"{rate}kbit"], "router")

    def setup(self):
        # Refuse to mutate unless our parent created all isolation layers.
        if os.getpid() != 1 or os.readlink("/proc/self/ns/net") == os.environ["COUCH_NETWORK_HOST_NETNS"]:
            raise RuntimeError("refusing setup outside the disposable PID/network namespace")
        for name in ["server", "router", "access"] + [c["name"] for c in self.config["clients"]]:
            self.namespace(name)
        self.link("server", "server0", "10.231.0.2", "router", "source0", "10.231.0.1")
        self.link("router", "trunk0", "10.231.1.1", "access", "trunk1", "10.231.1.2")
        self.route("server", "10.231.0.0/16", "10.231.0.1")
        self.route("router", "10.231.0.0/16", "10.231.1.2")
        self.route("access", "10.231.0.0/30", "10.231.1.1")
        for name in ["router", "access"]:
            self.call([PYTHON, "-c", "from pathlib import Path; "
                       "Path('/proc/sys/net/ipv4/ip_forward').write_text('1')"], name)
        down, up = self.config["sharedDownKbps"], self.config["sharedUpKbps"]
        if down:
            self.htb("trunk0", down, "1")
            self.netem("router", "trunk0", ["parent", "1:1"], "10:")
            self.htb("source0", up, "fff")
            # An explicit small default queue; all configured client IPv4 sources
            # are classified below. No unbounded default pfifo leaf is created.
            self.call(["tc", "class", "add", "dev", "source0", "parent", "1:1", "classid", "1:fff",
                       "htb", "rate", "1kbit", "ceil", f"{up}kbit"], "router")
            self.netem("router", "source0", ["parent", "1:fff"], "fff:")
        else:
            self.netem("router", "trunk0", ["root"], "10:")
            self.netem("router", "source0", ["root"], "20:")
        for index, client in enumerate(self.config["clients"], 1):
            subnet = index + 1
            self.link("access", f"down{index}", f"10.231.{subnet}.1",
                      client["name"], f"client{index}", client["address"])
            # Clients can only route to the server subnet. There is no default,
            # host interface, NAT, bridge, DNS or external TURN escape route.
            self.route(client["name"], "10.231.0.0/30", f"10.231.{subnet}.1")
            self.netem("access", f"down{index}", ["root"], "10:", client)
            if up:
                minor = format(index + 16, "x")
                ceiling = client["capKbpsEachDirection"] or up
                self.call(["tc", "class", "add", "dev", "source0", "parent", "1:1",
                           "classid", f"1:{minor}", "htb", "rate", "1kbit", "ceil", f"{ceiling}kbit"], "router")
                self.netem("router", "source0", ["parent", f"1:{minor}"], f"{minor}:", client, "up")
                self.call(["tc", "filter", "add", "dev", "source0", "parent", "1:", "protocol", "ip",
                           "prio", "1", "u32", "match", "ip", "src", client["address"] + "/32",
                           "flowid", f"1:{minor}"], "router")

    def snapshot(self):
        result = {}
        for name in self.nodes:
            result[name] = {
                "links": json.loads(self.call(["ip", "-j", "-s", "addr"], name, True)),
                "routes": json.loads(self.call(["ip", "-j", "route"], name, True)),
                "qdiscs": json.loads(self.call(["tc", "-j", "-s", "qdisc"], name, True)),
                "classes": json.loads(self.call(["tc", "-j", "-s", "class", "show"], name, True)),
            }
        return result

    def counters(self, client_index):
        result = {}
        for node, device, handle in [("router", "trunk0", "10:"),
                                     ("router", "source0", f"{client_index + 16:x}:" if self.config["sharedUpKbps"] else "20:"),
                                     ("access", f"down{client_index}", "10:")]:
            qdiscs = json.loads(self.call(["tc", "-j", "-s", "qdisc", "show", "dev", device], node, True))
            match = next(q for q in qdiscs if q["handle"] == handle)
            result[f"{node}/{device}/{handle}"] = match["packets"]
        return result

    def verify(self):
        ready = self.scratch / "echo-ready.json"
        echo = subprocess.Popen(node_command(self.nodes["server"], PYTHON, HERE, "_echo", str(ready)))
        try:
            until = time.monotonic() + 5
            while not ready.exists():
                if echo.poll() is not None or time.monotonic() > until:
                    raise RuntimeError("TCP/UDP probe server did not start")
                time.sleep(0.02)
            ports = json.loads(ready.read_text())
            results = []
            for index, client in enumerate(self.config["clients"], 1):
                for protocol in ["tcp", "udp"]:
                    before = self.counters(index)
                    sample = json.loads(self.call([PYTHON, HERE, "_probe", protocol,
                                                  str(ports[protocol])], client["name"], True))
                    after = self.counters(index)
                    delta = {key: after[key] - before[key] for key in before}
                    if not all(value > 0 for value in delta.values()):
                        raise RuntimeError(f"{client['name']} {protocol} bypassed a shaped segment: {delta}")
                    results.append({"client": client["name"], "protocol": protocol,
                                    "qdiscPacketDeltas": delta, **sample})
            return results
        finally:
            echo.terminate()
            echo.wait(timeout=5)

    def manifest(self):
        # Reserve an ephemeral server port in its own namespace, then release it
        # immediately before launch, following the existing native test pattern.
        port = int(self.call([PYTHON, "-c", "import socket; s=socket.socket(); "
                             "s.bind(('0.0.0.0',0)); print(s.getsockname()[1])"], "server", True))
        nodes = {}
        for name in ["server"] + [c["name"] for c in self.config["clients"]]:
            data = self.scratch / name
            data.mkdir()
            nodes[name] = {**self.nodes[name], "dataDirectory": str(data)}
        return {"schema": "couch-network-lab/1", "nodes": nodes, "port": port,
                "serverUrl": f"http://10.231.0.2:{port}", "pidNamespace": os.readlink("/proc/self/ns/pid"),
                "scratch": str(self.scratch), "exec": [PYTHON, HERE, "exec"],
                "profile": self.config}


def rss_and_processes():
    rss, count = 0, 0
    for item in Path("/proc").iterdir():
        if not item.name.isdigit():
            continue
        try:
            lines = (item / "status").read_text().splitlines()
        except (FileNotFoundError, ProcessLookupError):
            continue
        count += 1
        rss += sum(int(line.split()[1]) for line in lines if line.startswith("VmRSS:"))
    return rss / 1024, count


def internal(config_path):
    args = json.loads(Path(config_path).read_text())
    config = args["plan"]
    network = Network(config, args["scratch"], args["evidence"])
    report = {"schema": "couch-network-lab/1", "status": "failed", "profile": config,
              "namespaces": network.nodes}
    command = None
    try:
        # This deadline also survives an uncatchable SIGKILL of the outer CLI.
        def expired(signum, frame):
            raise TimeoutError("network namespace wall-time limit expired")
        signal.signal(signal.SIGALRM, expired)
        signal.setitimer(signal.ITIMER_REAL, config["resources"]["wallSeconds"])
        tools_available()
        report["ipc"] = isolation.mount_private_shm(args["hostIpc"], "network")
        network.setup()
        write_json(network.evidence / "before.json", network.snapshot())
        report["verification"] = network.verify()
        manifest = network.manifest()
        manifest_path = network.scratch / "manifest.json"
        write_json(manifest_path, manifest)
        write_json(network.evidence / "manifest.json", manifest)
        if args["command"]:
            baseline = [network.counters(i) for i in range(1, len(config["clients"]) + 1)]
            env = {**os.environ, "COUCH_NETWORK_MANIFEST": str(manifest_path),
                   "COUCH_NETWORK_EVIDENCE": str(network.evidence),
                   "COUCH_NETWORK_EXEC": HERE, "COUCH_DATA_DIR": str(network.scratch / "orchestrator"),
                   "COUCH_PORT": str(manifest["port"]), "COUCH_BASE_URL": manifest["serverUrl"],
                   "XDG_CONFIG_HOME": str(network.scratch / "config"),
                   "XDG_DATA_HOME": str(network.scratch / "data"),
                   "XDG_RUNTIME_DIR": str(network.scratch / "runtime")}
            Path(env["XDG_RUNTIME_DIR"]).mkdir(mode=0o700)
            env.setdefault("PULSE_SERVER", "unix:" + str(network.scratch / "no-owner-pulse"))
            env.setdefault("PIPEWIRE_REMOTE", str(network.scratch / "no-owner-pipewire"))
            env.pop("DBUS_SESSION_BUS_ADDRESS", None)
            command = subprocess.Popen(args["command"], env=env)
            report["commandPid"] = command.pid
            peak_rss, peak_processes = 0, 0
            while command.poll() is None:
                rss, processes = rss_and_processes()
                peak_rss, peak_processes = max(rss, peak_rss), max(processes, peak_processes)
                if rss > config["resources"]["maxSummedRssMiB"] or processes > config["resources"]["maxProcesses"]:
                    report["status"] = "inconclusive"
                    raise RuntimeError(f"worker resource limit exceeded: {rss:.1f} MiB summed RSS, {processes} processes; inconclusive")
                time.sleep(0.05)
            report["resourcesObserved"] = {"peakSummedRssMiB": peak_rss, "peakProcesses": peak_processes}
            report["commandExitCode"] = command.returncode
            if command.returncode:
                raise RuntimeError(f"lab command exited {command.returncode}")
            report["applicationTraffic"] = []
            for index, client in enumerate(config["clients"], 1):
                after = network.counters(index)
                delta = {key: after[key] - baseline[index - 1][key] for key in after}
                report["applicationTraffic"].append({"client": client["name"], "qdiscPacketDeltas": delta})
                if not all(value > 0 for value in delta.values()):
                    raise RuntimeError(f"no bidirectional application traffic proved for {client['name']}; use exec per process")
        report["status"] = "network-verified"
        return 0
    except Exception as error:
        if isinstance(error, TimeoutError):
            report["status"] = "inconclusive"
        report["error"] = str(error)
        print(f"network lab: {error}", file=sys.stderr)
        return 1
    finally:
        if command and command.poll() is None:
            command.terminate()
        try:
            write_json(network.evidence / "after.json", network.snapshot())
        except Exception as error:
            report["snapshotError"] = str(error)
        write_json(network.evidence / "network.json", report)
        network.commands.close()
        # Exiting PID 1 kills ALL descendants, including daemonized/setsid ones.
        # Namespace handles are never bind-mounted, so the links disappear too.


def execute_node(argv):
    if len(argv) < 3 or argv[1] != "--":
        raise RuntimeError("usage: network.py exec server|client-N -- COMMAND")
    path = os.environ.get("COUCH_NETWORK_MANIFEST")
    if not path:
        raise RuntimeError("exec must run inside live-audio-network.sh run")
    manifest = json.loads(Path(path).read_text())
    if os.readlink("/proc/self/ns/pid") != manifest["pidNamespace"]:
        raise RuntimeError("refusing stale or foreign network manifest")
    node = manifest["nodes"].get(argv[0])
    if not node or os.readlink(f"/proc/{node['pid']}/ns/net") != node["netns"]:
        raise RuntimeError("unknown or expired network node")
    os.environ["COUCH_DATA_DIR"] = node["dataDirectory"]
    os.environ["COUCH_NETWORK_NODE"] = argv[0]
    with (Path(os.environ["COUCH_NETWORK_EVIDENCE"]) / "processes.jsonl").open("a") as pids:
        pids.write(json.dumps({"pid": os.getpid(), "node": argv[0], "command": argv[2:]}) + "\n")
    # Avoid excessive accidental regular-file artifacts; the audio harness owns
    # its stricter total recording/storage budget.
    resource.setrlimit(resource.RLIMIT_FSIZE, (256 * 1024 * 1024, 256 * 1024 * 1024))
    os.execvp("nsenter", node_command(node, *argv[2:]))


def echo_server(ready):
    tcp = socket.socket()
    tcp.bind(("10.231.0.2", 0))
    tcp.listen()
    udp = socket.socket(type=socket.SOCK_DGRAM)
    udp.bind(("10.231.0.2", 0))

    def tcp_loop():
        while True:
            conn, _ = tcp.accept()
            with conn:
                conn.settimeout(3)
                try:
                    while data := conn.recv(4096):
                        conn.sendall(data)
                except (TimeoutError, ConnectionError):
                    pass

    threading.Thread(target=tcp_loop, daemon=True).start()
    write_json(ready, {"tcp": tcp.getsockname()[1], "udp": udp.getsockname()[1]})
    while True:
        data, address = udp.recvfrom(4096)
        udp.sendto(data, address)


def probe(protocol, port):
    samples = []
    with socket.socket(type=socket.SOCK_STREAM if protocol == "tcp" else socket.SOCK_DGRAM) as conn:
        conn.settimeout(1)
        conn.connect(("10.231.0.2", int(port)))
        for _ in range(4):
            payload = secrets.token_bytes(256)
            started = time.monotonic()
            conn.sendall(payload)
            try:
                data = conn.recv(len(payload))
                while protocol == "tcp" and data and len(data) < len(payload):
                    chunk = conn.recv(len(payload) - len(data))
                    if not chunk:
                        break
                    data += chunk
                if data != payload:
                    raise RuntimeError("probe payload mismatch")
                samples.append((time.monotonic() - started) * 1000)
            except TimeoutError:
                if protocol == "tcp":
                    raise
    if not samples:
        raise RuntimeError(f"no {protocol} response through the shaped path")
    print(json.dumps({"echoes": len(samples), "attempts": 4, "rttMs": samples}))


def main(argv):
    if argv and argv[0] == "_hold":
        print("ready", flush=True)
        while True:
            signal.pause()
    if argv and argv[0] == "_inside":
        return internal(argv[1])
    if argv and argv[0] == "_echo":
        return echo_server(argv[1])
    if argv and argv[0] == "_probe":
        return probe(*argv[1:])
    if argv and argv[0] == "exec":
        return execute_node(argv[1:])
    args = options(argv)
    config = plan(args)
    if args.action == "plan":
        print(json.dumps(config, indent=2))
        return 0
    prerequisites = prerequisite_check()
    if args.action == "check":
        print(json.dumps(prerequisites, indent=2))
        return 0
    evidence = Path(args.evidence).resolve() if args.evidence else Path(tempfile.mkdtemp(prefix="couch-network-evidence-"))
    if args.evidence:
        evidence.mkdir(parents=True, exist_ok=False)
    print(f"Network evidence: {evidence}", flush=True)
    write_json(evidence / "prerequisites.json", prerequisites)
    with tempfile.TemporaryDirectory(prefix="couch-network-") as scratch:
        config_path = Path(scratch) / "config.json"
        write_json(config_path, {"plan": config, "command": args.command, "scratch": scratch,
                                 "evidence": str(evidence), "hostIpc": isolation.snapshot()})
        env = {**os.environ, "COUCH_NETWORK_HOST_NETNS": os.readlink("/proc/self/ns/net")}
        affinity = args.cpu_list
        parent_pid = os.getpid()
        isolation.die_with_parent(os.getppid())
        def prepare_child():
            isolation.die_with_parent(parent_pid)
            if affinity:
                os.sched_setaffinity(0, affinity)
        child = subprocess.Popen(UNSHARE + [PYTHON, HERE, "_inside", str(config_path)], env=env,
                                 preexec_fn=prepare_child)
        write_json(evidence / "ownership.json", {"launcherHostPid": child.pid, "scratch": scratch,
                                                "cleanup": "PID namespace exit; no persistent namespace mounts"})
        def interrupted(signum, frame):
            raise InterruptedError(f"received signal {signum}")
        signal.signal(signal.SIGTERM, interrupted)
        signal.signal(signal.SIGINT, interrupted)
        try:
            return child.wait(timeout=args.duration)
        except (subprocess.TimeoutExpired, InterruptedError) as error:
            write_json(evidence / "termination.json", {"status": "inconclusive", "reason": str(error)})
            print(f"network lab stopped: {error}", file=sys.stderr)
            return 124
        finally:
            if child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait(timeout=5)


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]) or 0)
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        print(f"network lab: {error}", file=sys.stderr)
        sys.exit(1)
