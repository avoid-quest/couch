# Disposable audio-lab network

`scripts/live-audio-network.sh` supplies the first network fixture for A3 in
[the event plan](live-audio-event-plan.md). It uses Linux rootless user, network,
mount and PID namespaces. It changes no host interface, route, firewall or
qdisc, needs no `sudo`, and creates no persistent `ip netns` names. Docker is
not required.

This is network emulation. Passing its probes proves neither rendered audio,
phone acoustic timing nor Wi-Fi contention. The actual audio harness must
record its own output evidence and selected WebRTC candidate pairs.

## Run it

Required: Linux, Python 3.9+, util-linux (`unshare`, `nsenter`), iproute2 (`ip`,
`tc`), permitted rootless user/net/mount/PID namespaces, veth, HTB and netem with
the `seed` option. The runner includes `/usr/sbin` and `/sbin` when finding tools.
Prerequisite failures exit nonzero with the actual command error; they are not
passes or silent skips. It installs nothing.

```sh
scripts/live-audio-network.sh check
scripts/live-audio-network.sh plan --profile N1 --clients 2 --seed 123
scripts/live-audio-network.sh verify --profile N0 --clients 2 --seed 123 \
  --duration 120 --evidence /tmp/couch-network-n0-example
bun test tests/audio-lab/network.test.ts
```

`--evidence` must name a **new** directory. Without it, the runner creates and
prints a temporary evidence directory which it retains. `verify` runs actual
TCP and UDP echo traffic from every client, checks counters across every
shaped segment, and saves RTT samples. These are network round trips, not
one-way audio latency. It also retains addresses/routes, HTB classes and qdisc
statistics before and after the run. It does not measure sustained available
bandwidth or establish that a kernel's timers reproduce every requested delay.

Profiles currently implemented:

| Name | Per-client impairment, **in each direction** | Shared cap |
| --- | --- | --- |
| `control` | No injected delay, loss or rate limit | None |
| `N0` | 2 ms ±1 ms, no injected loss | 20,000 kbit/s down; separately controlled up |
| `N1` | 5 ms ±3 ms, 0.1% seeded random loss | Same as N0 |
| `N2` | One client: 60 ms ±20 ms, 2% loss, 128 kbit/s; others N0 | Same as N0 |

Jitter is uniform. `--bad-client` selects N2's client (1-based, default 1).
`--down-kbps` and `--up-kbps` set independent shared caps, each defaulting to
20,000. Rates are decimal kbit/s. N2's 128 kbit/s cap applies in each direction.
`--seed` is recorded, with distinct derived seeds per client/direction. Seeds
reproduce the random configuration; packet scheduling and traffic order still
affect the realized trace. Probe traffic consumes random samples before the
application starts and is always reported separately.

N3–N7 are **pending**, and requesting their names fails. This includes timed
outages, UDP blocking/TURN qualification, lifecycle faults, clock drift, CPU
quotas, asymmetric-delay sweeps, dynamic offered-load caps and correlated-loss
bursts. Changing the static uplink cap is not an N7 qualification run.

## Route and shaping

All links exist inside the disposable namespaces:

```text
server 10.231.0.2 ─ router ─ access router ─ client-1 10.231.2.2
                                         └ client-2 10.231.3.2 ...
```

Downlink traffic crosses one shared HTB cap on the router's trunk egress, then
the client's independent netem on the access router's egress. Uplink traffic
crosses a source-address-classified netem leaf on the router's server egress,
under one shared HTB parent. Thus both UDP and TCP receive per-client impairment
at router egress before their destination, including TCP ACKs and clock
exchanges. A 2 ms one-way profile adds approximately 4 ms of RTT, not 8 ms.
Every netem queue has an explicit packet limit (`--queue-packets`, default 256).
This fixture bounds its network queues; it does not bound application queues.

Each client has one veth and loopback, and only a route to the server subnet.
There is no default route, DNS setup, NAT, host link or external relay route.
IPv6 is disabled **inside each disposable namespace**. Each client's localhost
belongs to that client. External TURN/STUN is deliberately unreachable; a future
relay scenario must put the actual relay on a declared shaped route. Internal
router addresses are not application endpoints. Client-to-client delivery is
unsupported in this topology.

## Wrap the audio harness

The harness must launch separate source/server and receiver **processes** through
the supplied helper. Several BrowserWindows in one Electron process cannot
have different network namespaces. A command that leaves a client's shaped
path unused fails after it exits, even when it returned zero.

```sh
scripts/live-audio-network.sh run --profile N0 --clients 2 --seed 123 \
  --duration 120 --evidence /tmp/couch-network-audio-example \
  -- bun tests/live-audio.native.ts
```

Inside the wrapped harness:

```ts
const network = JSON.parse(readFileSync(process.env.COUCH_NETWORK_MANIFEST!, "utf8"));
// network.exec = [absolutePython, absoluteNetworkHelper, "exec"]
const launch = (node: string, executable: string, args: string[], env = process.env) =>
  spawn(network.exec[0], [...network.exec.slice(1), node, "--", executable, ...args], { env });

launch("server", electron, sourceAndCoreArguments);
launch("client-1", electron, firstReceiverArguments);
launch("client-2", electron, secondReceiverArguments);
```

`network.serverUrl` and `COUCH_BASE_URL` are `http://10.231.0.2:<port>`; receivers
must use this reachable address. Core must listen on the server namespace's
non-loopback address (or `0.0.0.0`). Source and Core sharing `server` may use
`http://127.0.0.1:<port>` for capture's localhost secure context. Client-side
capture, if added, needs its own secure-origin solution; this fixture does not
disable browser origin checks. `COUCH_PORT` is selected in the server namespace
and a unique `COUCH_DATA_DIR` is supplied for each node. As in existing native
tests, port reservation ends immediately before the application starts.

The outer orchestrator has no network link to applications. Its HTTP/WebSocket
control clients must also run through the appropriate node helper. Unix sockets
and ordinary files are shared: IPC/files are suitable for orchestration, but
media sent between processes by filesystem IPC would not cross netem. Application
counter increments prove traffic, not that every media packet used the intended
route; preserve selected ICE pairs and transport observations in audio evidence.

The helper preserves inherited environment, including `JACK_DEFAULT_SERVER` and
an explicitly supplied `PULSE_SERVER`. A private audio server started **within
the wrapped harness** can serve all nodes through filesystem Unix sockets and
shared memory. The rootless user namespace maps the caller to UID 0 inside it;
launching JACK inside the wrapper keeps UID-derived socket/shared-memory paths
consistent. Existing native Electron lab handling for running as namespace root
still applies. Do not point the harness at the owner's audio session.

The runner supplies private XDG config/data/runtime paths, removes the inherited
session D-Bus address, and defaults absent PulseAudio/PipeWire server settings
to nonexistent private sockets to prevent accidental use of the owner's audio.
An explicit audio-server environment takes precedence. It neither changes audio
defaults nor supplies audio calibration.

## Bounds, evidence and cleanup

`--duration` bounds setup, probes and the application together (default 120 s,
maximum 7,200 s). Both the outer supervisor and namespace init enforce it.
`--cpu-list 2,3` restricts inherited CPU affinity to CPUs already allowed for the
caller; it does not reserve CPUs or impose a CPU-time quota. Applications and
instrumentation share this allocation. `--max-processes` (512) and
`--max-rss-mb` (8,192 MiB) are sampled at 50 ms while the application runs.
Exceeding either aborts as **inconclusive** worker saturation. Summed RSS can
double-count shared pages; these are guards, not cgroup-enforced resource limits.
Commands launched through `exec` have a 256 MiB per-regular-file limit. The audio
harness remains responsible for its total retained-PCM budget.

`ownership.json` records the outer launcher PID and owned scratch directory.
`manifest.json` records node namespace-holder PIDs (relative to the private PID
namespace), namespace IDs, node data directories, server address and profile.
`processes.jsonl` records application processes launched through `exec`;
`commands.jsonl` records the exact network commands. `network.json` contains the
probe and application counters and command outcome; `before.json`/`after.json`
retain kernel state. A supervisor timeout/interruption writes `termination.json`
as inconclusive; it can prevent the final in-namespace snapshot from completing.
These network sidecars are fixture diagnostics for the audio harness's
`couch-evidence/1` report, not an independent audio qualification format.

On success, failure, timeout or catchable interruption the runner terminates only
its owned launcher, and PID-namespace exit kills every descendant, including
daemonized processes. Namespace handles are never persisted, so links/qdiscs
disappear with their processes. Scratch data is deleted and evidence retained.
An uncatchable outer `SIGKILL` still leaves the inner wall-time deadline active,
but can leave the scratch directory identified in `ownership.json` for removal
after the namespace exits. No broad process-name cleanup is used.

## Verification on this worker

On 2026-10-20, rootless two-client N0, N1 and N2 runs passed actual TCP/UDP path
checks on Linux `6.12.111+deb13-amd64`, iproute2 `6.15.0`. N0 RTT samples were
approximately 3.5–5.3 ms. In N2, the impaired client produced approximately
107–158 ms RTT while the healthy client stayed approximately 3.5–4.8 ms.
These short probe runs are not audio, bandwidth or loss-rate qualification.

The regression suite checks parameter bounds, unsupported profiles, actual
bidirectional TCP/UDP counters, host interface/qdisc preservation, isolated
application execution, bypass rejection, and cleanup after failure/timeout,
including a daemonized descendant and an unrelated process that must survive.
Its network tests explicitly skip with the prerequisite error on unsupported
workers; a skip is not isolation coverage.

Implementation references: upstream [netem manual][netem], [HTB manual][htb],
and util-linux [unshare manual][unshare]. Netem documents kernel timer limits
and recommends receiver-ingress placement for TCP; router egress immediately
before the destination provides that placement here.

[netem]: https://github.com/iproute2/iproute2/blob/main/man/man8/tc-netem.8
[htb]: https://github.com/iproute2/iproute2/blob/main/man/man8/tc-htb.8
[unshare]: https://github.com/util-linux/util-linux/blob/master/sys-utils/unshare.1.adoc
