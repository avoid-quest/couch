# Pasted YouTube Play measurement

This opt-in Linux measurement uses real Core, its managed helpers and the guarded public resolver. The renderer only acknowledges a load command, so **loadMs is Core's load dispatch, not first decoded frame**. It makes real public YouTube requests for `Me at the zoo`; do not run it in a test loop. No signed URLs, proxy credentials or session tokens are written to the result.

From the repository root, use the pinned Bun, a private scratch CWD/data directory and an unused port. `startHelpers` is explicitly pointed at that scratch data. First-run helper installation is excluded from the measurement. Run on a quiet machine; helper CPU samples exclude descendants and can miss work shorter than the 20 ms sampling interval. Linux `/proc` is required.

```sh
scratch=$(mktemp -d /tmp/couch-youtube-measure.XXXXXX)
mkdir -p "$scratch/data" "$scratch/runtime"
./node_modules/.bin/bun build tests/youtube-benchmark/measure.ts \
  --define "COUCH_BENCH_REVISION='$(git rev-parse HEAD)'" \
  --target=node --outfile="$scratch/measure.mjs"
cd "$scratch/runtime"
COUCH_DATA_DIR="$scratch/data" COUCH_PORT=43731 \
  node "$scratch/measure.mjs" "$scratch/result.json"
```

The script closes its own Core and removes its private database. Helpers and output remain in scratch. Do not point it at installed Couch data. Compare separately built revisions, never by changing checkout files while another test runs. The audit used the Hub before `8463efa` and after that commit; its source otherwise matched.

Build from a clean source checkout. The result embeds its build-time revision, runtime platform and selected helper versions/origins. Helper selection can use a system executable or a newer managed release: compare those fields before attributing a difference to code. The 40-second deadline applies after helper preparation and Core startup; a first-time helper install can take longer.

For the offline, deterministic regression that locks the process count and metadata/cancellation semantics, start again from the repository root:

```sh
scratch=$(mktemp -d /tmp/couch-youtube-intake.XXXXXX)
mkdir -p "$scratch/data"
./node_modules/.bin/bun build tests/web-intake.integration.ts \
  --target=node --outfile="$scratch/web-intake.integration.mjs"
cd "$scratch"
COUCH_DATA_DIR="$scratch/data" COUCH_PORT=43731 \
  node --test "$scratch/web-intake.integration.mjs"
```

The one retained live pair is in `docs/youtube-readiness-evidence.json`. CPU/output reductions are observed work reductions; wall-clock noise and network variation do not support a startup-speed claim.
