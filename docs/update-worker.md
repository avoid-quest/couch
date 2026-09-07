# External update worker

The companion package supplies the root worker for [manual phone updates](https://github.com/avoid-quest/couch/issues/7),
retained signed releases and explicit SSH trial restoration. Installation ships
disabled; the administrator activates it after appliance qualification.

A receipt contains the exact `InRelease`, `release.json`, `Packages` and both
Debian archives from one signed publication. Keep the public key enrolled
through the supported installer. The worker uses only that key and independently
checks the signature, signed manifest/index hashes, exact package bytes and
Debian identities. A directory name or a saved ready flag is insufficient.

After installing a release through the existing administrator path, enroll its
receipt on the TV:

```sh
sudo couch-update enroll-current /absolute/verified-receipt
sudo couch-update status
```

The path is a root operator input. Browsers never receive this capability.
Enrollment checks both configured package versions and their installed build
identities. It works for any matching release, including the first release
that implements manual updates. Missing or mismatched evidence fails
without changing the running app.

The worker keeps authenticated bytes under `/var/lib/couch-updater/receipts`,
outside the application data directory, and durably records the accepted
identity in `current.json`. It retains earlier receipts. Reenrollment fails
while a transaction is active. Do not delete this storage to clear a failed
operation; it will carry the packages and transaction evidence needed for SSH
recovery.

Before copying, the worker checks the destination filesystem for the signed
archive sizes, metadata and a 256 MiB reserve. It verifies retained archives
in place through pinned descriptors, without another package copy. This is a
preflight check, not a reservation against other disk users; a later write
failure removes the partial receipt and leaves the accepted identity intact.

Expired channel metadata may authenticate the exact installed release for
retention. This does not permit installing an expired candidate. A new
candidate requires fresh signed metadata. Subsequent transaction integration
also requires explicit supported data-format declarations in the signed
manifest and compiled build; older receipts can be retained without claiming
that their builds support manual updates.

## Durable transactions

The companion also ships disabled `couch-updater.socket` and
`couch-updater.service` units. Nothing enables them during installation. The
activated app implements the private maintenance protocol and authenticates
administrator requests before passing them to the worker.

The root worker accepts newline-delimited JSON on
`/run/couch-updater/control.sock`. Only root and the `couch-tv` account may
connect. The paired app coordinator authenticates phone requests before
forwarding these fixed operations:

```json
{"op":"install","candidateId":"<64 lowercase hex characters>","requestId":"<32 lowercase hex characters>","confirmInterrupt":true}
{"op":"status","requestId":"<the same retry identity>"}
```

`candidateId` identifies the signed staged manifest under the configured app
data directory's `updates/staged` directory. The worker independently verifies
and retains its receipt. The client cannot choose paths, packages, commands,
credentials or URLs. A retry with the same payload returns the same durable
transaction. Reusing its identity for another payload fails. Disconnecting the
initiating client does not cancel the worker.

The worker fsyncs the accepted request before replying. It verifies the current
installed identity, explicit data format, maintenance capability, free space
and package dependencies before disruption. It passes the two authenticated,
root-retained archives to APT. Dependencies use the administrator's existing
APT sources and normal archive authentication. Phone requests cannot change
those sources. Simulation and download-only preparation run while the app
continues playing.

The final APT command allows acquisition because local `.deb` installation
still needs APT's acquisition path. It explicitly disables `--fix-missing`,
package removals and recommended packages. APT resolves final acquisition
before its `DPkg::Pre-Invoke` hook. The Ubuntu APT 2.8.3 source checks failed
acquisition before `PM->DoInstall`, and `pkgDPkgPM::Go` invokes this hook before
dpkg. See the [Ubuntu source archive](https://archive.ubuntu.com/ubuntu/pool/main/a/apt/apt_2.8.3.tar.xz),
`apt-private/private-install.cc` and `apt-pkg/deb/dpkgpm.cc`. The disposable
Ubuntu test additionally removes a dependency after download preparation and
requires the final acquisition failure to leave the app running.

The hook is a frozen root-owned script unique to this transaction. It is passed
only to this worker's APT command; no global APT hook is installed. The worker
checks the hook's root peer, exact transaction and ancestry from its live APT
child. Unrelated APT operations cannot initiate Couch maintenance through it.
Inside that authenticated hook, while APT owns the package lock, the worker
rechecks both installed package/build identities against the retained previous
release before closing admission. A package change since preflight fails
without interrupting the app. After quiesce finishes, the worker rechecks the
active phase and live APT ancestry before accepting hook completion. A late
response cannot replace a recorded failure.

The hook closes application admission, saves progress, stops the supervised
app and checks its process group before taking a backup. It copies application
data, preserves symlinks without traversing external media, excludes staged
downloads and normalizes a private SQLite/WAL copy. Ownership records and file
hashes accompany the fsynced backup. The previous signed packages remain in
root retention. A failed snapshot aborts the hook before dpkg runs.

## App protocol required before activation

The app must expose `/run/user/<couch-tv uid>/couch-maintenance.sock` and check
the connecting root peer. Each request carries `protocol: maintenance-v1`, a
worker-generated `updateId` and `nonce`, the exact candidate identity, and the
interruption choice. Every response must echo the protocol and nonce and set
`ok: true`. The worker verifies the socket's owning peer. The operations are:

| Operation | Required response and behavior |
| --- | --- |
| `capabilities` | Current `build` identity and `nativeReadiness: libmpv-v1`; no interruption yet. |
| `quiesce` | Enforce the interruption choice, block new sessions and writers, finish active work, save progress, then confirm `progressSaved` and `admissionClosed`. |
| `readiness` | Exact matching `build`, `nativeBuild`, and `frontendBuild`; `database: ok`, `nativeReadiness: libmpv-v1`, and `frontendReady: true`. |
| `commit` | Open normal admission only after the root worker has durably recorded its commit boundary; confirm `admissionOpen: true`. |

Each build identity contains `version`, `revision` and integer `dataFormat`.
Startup must consult the active transaction before constructing writers and
remain in maintenance during a trial. Native readiness must initialize and
verify libmpv on its existing owning thread with a bounded, nonce-correlated
response. Idle diagnostics are insufficient. This does not establish actual
media decoding or rendering. Frontend readiness must identify the loaded
assets, so an old connected browser cannot make a newer build pass.

The worker verifies installed package identities again, starts the app in
trial mode and waits up to 90 seconds for matching readiness. It durably marks
`committed` before changing the accepted receipt and asking the app to admit
normal writes. A failure after this point must not restore an older database.
Each coordinator exchange uses one absolute deadline across connection, send and
receive. Trial requests receive only the remaining trial budget. The root
socket permits at most eight live request handlers and ten seconds to ingest
one complete request, so clients cannot hold unlimited threads by dripping
bytes. Quiescing and backup retain their separate hook execution deadline.

The app coordinator implements this protocol behind the persistent root-owned
`/etc/couch/manual-updates.enabled` flag. No package script creates that flag or
enables the worker units. An administrator enables phone installation explicitly
through SSH after appliance qualification. Automatic recovery, idle scheduling
and tool repair remain separate work. Source and fixture verification alone
do not report issue 7 complete.

On activated Linux startup, one unprivileged Python bridge runs from the fixed
installed script with an isolated Python environment. It checks root Unix peer
credentials and carries private bounded frames over inherited pipes. It allows
eight live exchanges, bounds input and output deadlines, and rejects unmatched
or late replies. Bridge loss closes admission. The root worker's private
`context` operation supplies the active transaction's nonce and phase only to
root or the runtime account. Public transaction status never includes them.

Startup reads that context before opening the application's databases. It permits
normal startup only with no active transaction, or a trial whose exact build
matches the running app. Installing, quiescing, operator-required and pretrial
restoration refuse startup before any database opens or migrates. A trial
blocks pairing, controller last-seen writes, commands, delayed request writes
and background update checks. Quiesce stops observations, radio reconnect and
source resolutions, then requires the last observed local progress write to
succeed. It waits for database owners and local producers to close before
acknowledging. Failed checkpoints do not return `progressSaved: true`.

Native readiness uses a separate fresh nonce on the host pipe. The existing
GTK-owned libmpv singleton initializes without loading media, remains hidden
with an empty session key, and is reused by the next ordinary Load. An active
playback ID rejects readiness. Queued work expires after two seconds; once
initialization starts, an independent three-second watchdog terminates a hung
native process. The worst-case bound from receipt is about five seconds.
The normal playback state and media start/end conversions are unchanged.

The release builder embeds the same integer data format and build identity in
the native host, coordinator and loaded frontend bundles. Only the trusted
native frontend may acknowledge its compiled asset identity through the
maintenance endpoint; it receives no root transaction nonce. The trial checks
SQLite integrity, actual native initialization and that asset acknowledgment.
The root commit must be durable before admission opens. Startup initialization
alone does not qualify actual media decoding or rendering.

## Phone installation and reconnect

An administrator opens Settings → Updates, downloads a verified candidate,
and chooses Install update. The confirmation explains the restart and asks
whether current playback may stop. Ordinary paired remotes and the native host
cannot install. The browser sends only the candidate ID, a random request ID
and that interruption choice; the root worker revalidates the retained proof.

The browser saves that request identity before sending it. If the reply or
connection is lost, it polls public transaction status and offers an explicit
retry of the same request; reconnect never starts another installation.
Transaction status remains readable during the trial without controller
last-seen writes. After loading new assets, the administrator's Settings
reopens Updates while a saved request exists. Success identifies the committed
version and revision and requires the running server identity to match.

The frontend compares its compiled build with the authenticated server before
connecting and refreshes once per changed build. Packaged control WebSockets
require that matching identity, so an old page cannot control a newer server.
Credentials remain stored through the refresh; a rejected credential returns
the browser to pairing. Native asset readiness uses its separate host-only
acknowledgment, never an ordinary phone's connection.

## Explicit SSH activation and trial restoration

After the actual installed manual-capable release and its native/Boot behavior
are qualified, retain its signed receipt and activate from the administrator's
SSH session:

```sh
sudo couch-update enroll-current /path/to/current-signed-receipt
sudo couch-update enable
sudo couch-update status
```

Enrollment verifies the receipt against the enrolled host key and installed
packages. Activation refuses an active transaction, mismatched build, absent
maintenance protocol or unhealthy package manager. It writes the persistent
root-owned flag, enables the fixed root socket and restarts the user service.
Package installation itself does not activate this feature. The release feed
and signing credentials remain host configuration; the phone supplies neither.

For an uncommitted `operator-required` transaction, use its exact `updateId`:

```sh
sudo couch-update restore <updateId>
```

This fixed root operation masks and stops the app service, verifies the accepted
previous receipt, reinstalls its two retained packages and restores the verified
pre-update data snapshot. It preserves the failed trial data in a sibling
`.couch-failed-trial-*` directory and records that path in the root transaction.
It preserves ownership and symlinks without following external media. Both
package locks remain held while the restored data and previous build pass the
same database, native and frontend trial before normal writes resume.

A required checkpoint can fail before any snapshot exists. If the final hook
never completed, the command may instead resume the unchanged authenticated
previous build after stopping writers and checking installed identity and
package health. It does not require or invent a missing snapshot in this case.
If package identity changed, a verified snapshot is required before reinstalling.

Once either trial has durably committed normal admission, this command refuses
to restore old data. Interrupted or unsuccessful restoration remains
`operator-required`; retained evidence and failed trial data are kept for SSH
inspection. It never guesses that readiness succeeded or performs automatic
rollback.

## Inspection and verification

`sudo couch-update status` exposes the current receipt and active transaction.
Through SSH, root can inspect `/var/lib/couch-updater/transactions/<requestId>.json`,
`logs/<updateId>.log`, `backups/<updateId>` and the retained receipts. A worker
restart records a failure before package work or `operator-required` when the
interruption may have changed packages or data. It does not guess success,
automatically reinstall packages, or clear ambiguous maintenance state.
Preserve this evidence when investigating or restoring a failed trial.

Run `python3 scripts/test-update-retention.py` for descriptor, content,
identity and retention checks. The Ubuntu-only test
`python3 scripts/test-update-retention-ubuntu.py` additionally uses real GnuPG
signatures and Debian archives. Run it in a disposable Ubuntu 24.04 tools
container with `python3` and `gnupg`. Its key is disposable and must never be
enrolled on the TV. These tests neither install Couch nor qualify native or
phone updates.

`python3 scripts/test-update-transactions.py` checks durable state, retries,
failure boundaries and SQLite backup without installing packages.
`python3 scripts/test-update-transactions-ubuntu.py` installs tiny dummy Debian
packages in a disposable Ubuntu 24.04 container, exercises real APT locks,
acquisition and the frozen hook, disconnects the initiating client and checks
readiness failure, explicit previous-package/data restoration and unchanged-app
resume after a failed checkpoint with no snapshot. Its session, native and browser operations are explicit
test doubles. It prints the actual APT version. Run it only in a fresh root
container with a read-only source mount, no network, and a bounded external
watchdog, or on the dedicated disposable Ubuntu runner in
[Update worker CI](../.github/workflows/updater.yml). Never run it on the
TV or a development host. That workflow runs both focused suites and both real
Ubuntu fixtures for companion package, worker, test and workflow changes with
read-only repository permissions and a five-minute job deadline.
Feature-branch push and metadata-only events do not run this workflow. A newer
revision cancels obsolete work for the same pull request. Keep all PR attempts
and the separate main validation in the [CI timing ledger](ci.md), including
queue and commit latency, total execution through cleanup and per-job rounded
minutes. This workflow builds no Couch package or native application. Compare
its added usage with the existing Check budget before delivery.
