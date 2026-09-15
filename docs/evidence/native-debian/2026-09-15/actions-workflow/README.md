# Native release workflow checks

The Package workflow now uses one job for draft/build/sign/qualification/direct CrabNebula upload and explicit publication. Only signed identity/qualification receipts and public provider metadata enter GitHub artifacts or the bounded run-log fallback. This record validates the workflow implementation for #300; it does not claim a fresh hosted release.

[The result summary](validation.json) records typecheck, shell syntax, act syntax, 13 real hosted tests with Minisign and 17 inert act scenarios. [The act results](act-results.json) bind the checks to the workflow SHA-256. The real tests include native single-file/signature metadata, exact Preview URL restoration, tampered receipt rejection, a mocked Cloud upload followed by publication after all local package bytes were removed, and the bounded run-log receipt parser. No production credentials were supplied.

The act scenarios cover native and AppImage drafts, native publication, completed-draft retry, artifact-to-run-log fallback, unchanged-byte Stable promotion, readiness only, input/ref/release gates, builder/qualification/signing/upload/publication failures, and nonblocking receipt quota. Every remote action and provider/build command is inert. The checks do not establish real signing credentials, native compilation, package installation, Actions billing/capacity, protected environments, transport, CDN behavior or physical/native-update acceptance. See [act limitations](https://nektosact.com/not_supported.html).

The harness derives the selected Docker context and accepts COUCH_ACT_IMAGE and COUCH_ACT_ARCH. This run reused the existing native arm64 shell fixture with no network, daemon socket or credentials. Linux tests used an independent short-lived container from the cached production image, with the checkout mounted read-only. All task containers were removed. Shared build containers were not changed.

Run from the repository root with a compatible local shell image already available:

```sh
COUCH_ACT_IMAGE=debian:13-slim bun tests/package/hosted-workflow.ts /absolute/act /absolute/disposable-output
```

The checked act 0.2.89 binary came from the checksum-verified retained installation documented in [Actions preparation](../actions-preparation/README.md). Full generated inert workflows, scenario logs, syntax output and real-test output remain in the private local worktree at `/tmp/couch-native-release-20260915/.artifacts/native-actions/`. Initial local harness failures were fixture mistakes: a mismatched string delimiter, then matching an absent fault to unnamed action steps. The corrected harness passed all scenarios. These failed fixture runs remain in that local directory; they did not run a product build or provider command.

A fresh committed main version must still build and qualify through the hosted workflow, or use the same pinned Mac procedure if hosted capacity blocks it. Both native public publication and legacy AppImage feed behavior need actual CDN checks. The integrated TV/update package must pass its own runtime fixture; the prior #297 package proof does not cover later native-update code.
