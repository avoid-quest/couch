# Checks and releases

Use the pinned Bun 1.4.2 and the frozen lockfile.

```sh
bun install --frozen-lockfile
bun run typecheck
bun run build
```

[Check](../.github/workflows/check.yml) runs the same three commands on Linux.

Nothing runs on push or on pull requests. Every workflow starts by hand:

| Workflow | Start it with | It does |
|---|---|---|
| Check | `gh workflow run check.yml` | Typecheck and build on Linux |
| Package | `gh workflow run package.yml --ref <branch>` | Unpublished installers of any branch, kept 14 days as run artifacts |
| Release | `gh workflow run release.yml -f channel=preview` | Publishes `main` as the next preview |
| Release | `gh workflow run release.yml -f channel=production` | Promotes the latest preview to production |

Housekeeping also runs weekly on its own and only deletes expired artifacts and
stale caches.

The old test suite was deleted when the rebuild in
[#644](https://github.com/avoid-quest/couch/issues/644) started. Add a test only
where a behaviour must stay locked, and run it with `bun test <path>`.

## Releases

Couch ships on two channels, both published on the public
[avoid-quest/couch-releases](https://github.com/avoid-quest/couch-releases),
which holds only installers, update files and notes:

- **Preview**, `vX.Y.Z-preview.N`: `main` when you run Release with
  `channel=preview`, skipped when that commit already has a preview. It
  installs as Couch Preview, with its own icon.
- **Production**, `vX.Y.Z`: Release with `channel=production`. It promotes the
  latest preview's commit and drops the suffix, so try that preview first.

`package.json` holds the base version, X.Y.Z. A preview counts N up from the
highest preview of that base; once `vX.Y.Z` ships, previews continue at
X.Y.(Z+1)-preview.1 without a commit. Bump the minor or major version by
editing `package.json`. CI sets the resolved version in the tree only for the
build ([scripts/release.ts](../scripts/release.ts)).

Couch and Couch Preview share an appId and a data directory, so only one of
them runs at a time. electron-updater keeps each on its channel: a preview
follows only previews (`preview-*.yml`), production only the latest production
release (`latest-*.yml`). **Settings > Updates** switches channel; leaving
Preview for Stable installs the older stable release. The app checks at start
and every 4 hours. Windows and Linux install updates with electron-updater. The
Mac app is unsigned, and Squirrel.Mac only updates signed apps, so it downloads
the zip itself, checks its sha512 and swaps its bundle when Couch quits or
restarts to update ([app/update.ts](../app/update.ts)). The TV installs through
a root unit ([native TV](native-tv.md)).

[Release](../.github/workflows/release.yml) resolves the version, opens a draft
release with GitHub's generated notes, builds with
[Package](../.github/workflows/package.yml) (AppImage and deb on Linux, dmg and
zip on macOS, nsis on Windows), which uploads straight into the draft, then
publishes it and tags this repository's commit too. Nothing passes through
artifact storage, and the updater never sees a draft, so a failed run publishes
nothing; rerun its failed jobs to finish it. Write pull request titles as plain
sentences: they become the release notes. Package can also be dispatched on its
own for a test build of `package.json`'s version, kept as run artifacts and
never published. Builds are unsigned.

Every build runs on [Blacksmith](https://docs.blacksmith.sh/blacksmith-runners/overview),
as in t3code: macOS on `blacksmith-6vcpu-macos-26` and Windows on
`blacksmith-4vcpu-windows-2025`, beside Linux. Their minutes cost 20× and 4×
Linux's from the same allowance, so a release costs roughly one Mac build.

One-time setup, done by the owner:

1. Create the public repository with a first commit:
   `gh repo create avoid-quest/couch-releases --public --add-readme --description "Couch installers and updates"`.
2. Create a fine-grained personal access token with the resource owner
   avoid-quest, access to only avoid-quest/couch-releases, and the repository
   permission Contents: Read and write.
3. Save it as this repository's secret:
   `gh secret set COUCH_RELEASES_TOKEN -R avoid-quest/couch`.

## Workflow changes

Prove workflow and packaging edits with [`act`](https://nektosact.com) before
dispatching them, using `catthehacker/ubuntu:full-latest` (the default act image
lacks `gh`). Release's preflight reads git inside the container, so run it from
a clone rather than a worktree, with an event that says the run is on `main`:

```sh
act workflow_dispatch -W .github/workflows/check.yml -j linux \
  -P blacksmith-4vcpu-ubuntu-2404=catthehacker/ubuntu:full-latest
echo '{"inputs":{"version":"0.2.0-preview.1"}}' > /tmp/package-event.json
act workflow_dispatch -W .github/workflows/package.yml -j package --matrix name:linux \
  -e /tmp/package-event.json \
  -P blacksmith-4vcpu-ubuntu-2404=catthehacker/ubuntu:full-latest \
  --container-architecture linux/amd64 --artifact-server-path /tmp/act-artifacts
echo '{"ref":"refs/heads/main","inputs":{"channel":"preview"}}' > /tmp/release-event.json
act workflow_dispatch -W .github/workflows/release.yml -j preflight \
  -e /tmp/release-event.json \
  -P blacksmith-4vcpu-ubuntu-2404=catthehacker/ubuntu:full-latest \
  --container-architecture linux/amd64
```

Local emulation does not prove hosted capacity, secret access or timings.
