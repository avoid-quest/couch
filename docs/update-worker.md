# External update worker

The companion package provides root-only receipt enrollment for the external
update worker. This layer does not enable a service or install releases from
the browser. [Install an update from a phone and verify the running
build](https://github.com/avoid-quest/couch/issues/7) owns that integration.

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
that will implement manual updates. Missing or mismatched evidence fails
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
current app does not implement the required maintenance protocol, so this
layer cannot perform a phone update on its own.

The root worker accepts newline-delimited JSON on
`/run/couch-updater/control.sock`. Only root and the `couch-tv` account may
connect. The future paired app coordinator must authenticate phone requests
before forwarding these fixed operations:

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

The app implementation, paired phone controls, asset reconnect behavior,
automatic recovery and idle scheduling are later joins. This layer does not
enable those paths or report issue 7 complete.

## Inspection and verification

`sudo couch-update status` exposes the current receipt and active transaction.
Through SSH, root can inspect `/var/lib/couch-updater/transactions/<requestId>.json`,
`logs/<updateId>.log`, `backups/<updateId>` and the retained receipts. A worker
restart records a failure before package work or `operator-required` when the
interruption may have changed packages or data. It does not guess success,
automatically reinstall packages, or clear ambiguous maintenance state.
Preserve this evidence for the later recovery procedure.

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
readiness failure. Its session, native and browser operations are explicit
test doubles. It prints the actual APT version. Run it only in a fresh root
container with a read-only source mount, no network, and a bounded external
watchdog; never run it on the TV or a development host.
