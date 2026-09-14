# PR #255 review corrections and Mac recipe checks

Checked 14 September 2026 for [PR #255](https://github.com/avoid-quest/couch/pull/255).
This is documentation/tool-environment validation, not a release qualification.
The original [installed-status record](current-status-2026-09-14.md) and the
[8 September desktop-controller record](desktop-controllers-171.md) retain their
historical observations and pending physical acceptance.

## Reviewer dispositions

- [Mac acceptance, r4003938134](https://github.com/avoid-quest/couch/pull/255#discussion_r4003938134): corrected the controller guide, capability checkpoint and status table. Completed Safari/website-app checks used a loopback coordinator with no native player. LAN access, populated Search, commands reaching the installed Ubuntu TV and physical playback from the Mac remain pending. Windows/Edge verification remains deferred.
- [Fresh-install QR, r4003938149](https://github.com/avoid-quest/couch/pull/255#discussion_r4003938149): the README, usage and controller instructions now distinguish fresh Claim and name from configured-TV Connections. Source inspection of `Settings.tsx` and `SetupProgress.tsx` confirms that setup hides navigation and displays the QR in its claim step. No fresh-device or physical scan test was performed.
- [Executable Mac build, r4003938143](https://github.com/avoid-quest/couch/pull/255#discussion_r4003938143): added [compiler environment](../../packaging/Dockerfile.mac) and [executable build/qualification commands](../tauri-releases.md#build-and-qualify-on-the-mac). They read existing pins, create a clean source clone, build through `package:build` and `build-appliance.sh`, run the existing AppImage and companion fixtures, preserve evidence, and assemble publisher inputs only after successful qualification. No alternate package implementation or T480 build was added.

## Executed checks

`docker build --check --platform linux/amd64 -f packaging/Dockerfile.mac
--build-arg UBUNTU_SNAPSHOT=20260905T000000Z --build-arg BUN_VERSION=1.4.2
--build-arg RUST_VERSION=1.98.1 packaging` passed with no warnings. This parses and
checks the Dockerfile; it does not execute its APT, Bun, Rust or driver install
layers. An earlier check reported an amd64-base/arm64-stage mismatch on this
Mac despite the CLI platform flag. Declaring the builder's amd64 platform in the
Dockerfile resolved that check. The explicit architecture also matches the
existing package scripts' Linux x64 requirement.

After the parent task's combined Mac suite/build completed, a 1.64-second probe
used the retained local compiler image
`sha256:eef7e146a13d433a135608f1b28edd3f62271bbb271e57edd3c746059cb2bc7a`.
It is a historical image, not an image produced by the new Dockerfile. The probe
ran two disposable containers, each capped at one CPU, 512 MiB with no additional
swap and 128 PIDs. No APT installation or native compilation ran.

The probe executed these recipe operations:

- Cloned the repository with `git clone --no-hardlinks --no-checkout`, checked out `925966c0cabda318882c63ac1d4d86521ffbc387` detached, and verified a clean source tree before and after.
- Started an amd64 runner with the Docker socket, Linux host networking and the same absolute Mac path mounted inside. Verified `uname -m` as `x86_64`, Bun `1.4.2`, Rust `1.98.1` and Docker daemon `29.7.2`.
- Started a sibling through that mounted Docker socket. The sibling read the same bind-mounted marker and fetched a generated response from the runner at `127.0.0.1:44591`. One initial connection attempt preceded listener startup; the bounded retry and sibling fetch passed.
- Ran `sh scripts/build-appliance.sh ../companion 0.0.0+docs251` in the sibling, then inspected its Debian control fields, embedded source identity and archive hash. It reported package `couch-appliance`, version `0.0.0+docs251`, architecture `all` and source `925966c0cabda318882c63ac1d4d86521ffbc387`. SHA-256 was `83fcb00931e496bb191b0352a3c7994900349a618cc54a485b0c0f2b61caa85b`. This is a disposable documentation probe identity, not a release allocation or install candidate.
- Removed the exact probe runner and verified both owned containers were absent. No shared image/cache or other container was removed.

The complete recipe's Bash blocks and nested build/qualification bodies passed
`bash -n`. All 62 relative documentation links/fragments in the changed documents and
`git diff --check` passed. Source inspection matched the recipe to the package workflow,
`package:build`, `build-appliance.sh`, `tests/package/qualify.ts`,
`test-appliance.sh`, `test-appliance-systemd.sh` and the publisher's required
AppImage/build/source/qualification inputs.

## Not executed

The compiler image was not bootstrapped from scratch. `bun install`, the Tauri
native/AppImage build, helper downloads, companion installer fixture, real
AppImage runtime and installed systemd/APT qualification, and final archive
assembly were not rerun for this correction. Those remain required before a
new release can be called qualified. The parent task owns the separately run
combined application suite; it is not a substitute for these package gates.

The Mac transport probe proves the socket, loopback and bind-path arrangement.
It does not prove that Apple Silicon emulation runs the packaged AppImage or
systemd fixture. Historical work recorded emulator-specific AppImage/systemd
failures; this correction did not change emulation handlers or weaken target
configuration. Preserve and investigate a fresh failure before publication.
The supported scripts rebuild companion fixture versions, so those fixtures
must not be described as installing the exact final release `.deb`.

No release was signed, published or installed. No appliance connection or physical
acceptance check ran. Local raw probe files remain in the operator checkout's
ignored `.artifacts/mac-build-251-review` directory and require owner access;
this repository record carries their results without a temporary-worktree link.
