# Retained update receipts

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

Run `python3 scripts/test-update-retention.py` for descriptor, content,
identity and retention checks. The Ubuntu-only test
`python3 scripts/test-update-retention-ubuntu.py` additionally uses real GnuPG
signatures and Debian archives. Run it in a disposable Ubuntu 24.04 tools
container with `python3` and `gnupg`. Its key is disposable and must never be
enrolled on the TV. These tests neither install Couch nor qualify native or
phone updates.
