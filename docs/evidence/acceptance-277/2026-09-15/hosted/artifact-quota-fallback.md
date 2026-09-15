# Artifact quota fallback

GitHub refused the qualified candidate from [run 34909480229](https://github.com/avoid-quest/couch/actions/runs/34909480229). The account inventory contained 168 artifacts, including 114 unexpired artifacts totaling 15,394,049,192 bytes. No artifacts were deleted. The provider reports quota recalculation every 6 to 12 hours, so deletion would not establish an immediate recovery path.

The existing Mac Debian builder cache remains available. A separate clean checkout of committed source `3f91c0564bbbeea04eef421977f2e67b17c8fb14` was rebuilt with the production signing identity and qualified through a documented test matrix. This is a new Mac-built candidate. The unavailable Blacksmith bytes and the older disposable-key candidate are not reused or relabeled.

## Future workflow improvement

[CrabNebula's supported workflow](https://docs.crabnebula.dev/cloud/ci/tauri-v2-workflow/) uploads build outputs from the build job and publishes separately. Moving Couch's existing six-file upload before optional GitHub artifact retention would preserve the qualified bytes in the private draft if GitHub storage is full.

The separate publication job would need trusted compact manifest, qualification and upload receipts through job outputs, plus a manifest-only validation path. The sampled manifest and qualification receipt serialize to 9,832 UTF-16 bytes, below [GitHub's 1 MB per-job output limit](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idoutputs). No signing key belongs in those outputs.

This is a proposal, not an implemented or tested workflow change. It would preserve same-run publication but would not replace durable private evidence for later retries or Stable promotion. The inspected CN 0.13.4 CLI exposes no draft-download or private-metadata command. Existing private artifact retention remains useful when capacity returns.
