# Debian packaging

One signed native Debian 13 amd64 package ships Couch and its application
dependencies. Hosted Actions builds it in the pinned Debian 13 container
(`packaging/Dockerfile.builder` — historically named, now the standard builder).

## Build

```sh
bash scripts/hosted-build.sh deb
```

Inside the builder this runs `bun run package:build deb`:
`scripts/package-prepare.ts` stages TV resources, the update broker, the enrolled
updater key and redistribution notices, then `scripts/desktop.ts` builds the
signed bundle and `scripts/package-deb-verify.ts` inspects the package without
running application code as root.

## Qualify

```sh
bash scripts/hosted-qualify.sh deb
```

Runs typecheck, Bun and Cargo tests, then compares the release identity inside
the package. `scripts/hosted-desktop.sh` (Docker host) qualifies the exact
package in a fresh Debian container with a real GUI session.

## Release

See [hosted releases](hosted-releases.md). The Mac is only a build fallback
using the same container; it never hosts the download or update feed.
