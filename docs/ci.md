# Checks

Use the pinned Bun 1.4.2 and the frozen lockfile.

```sh
bun install --frozen-lockfile
bun run typecheck
bun run build
```

[Check](../.github/workflows/check.yml) runs the same three commands on Linux.
It is dispatched manually.

The old test suite was deleted when the rebuild in
[#644](https://github.com/avoid-quest/couch/issues/644) started. Add a test only
where a behaviour must stay locked, and run it with `bun test <path>`.

## Workflow changes

Prove workflow and packaging edits with [`act`](https://nektosact.com) before
dispatching them, using `catthehacker/ubuntu:full-latest` (the default act image
lacks `gh`):

```sh
act workflow_dispatch -W .github/workflows/check.yml -j linux \
  -P blacksmith-4vcpu-ubuntu-2404=catthehacker/ubuntu:full-latest
```

Local emulation does not prove hosted capacity, secret access or timings.
