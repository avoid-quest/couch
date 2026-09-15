# Clean Debian regression for the missing GLES library

A fresh official Debian 13 slim amd64 container reproduced the missing `libGLESv2.so.2` dependency after installing the original declared common host packages. Adding `libgles2` to that package list made the same loader check pass. This supports the [T480 diagnosis](../t480-gles/README.md).

| Check | Result |
| --- | --- |
| Initial container | 78 packages, no GLES or WebKit packages |
| Original common package list | Exit 1: loader could not open `libGLESv2.so.2` |
| Corrected common package list | Exit 0: GLESv2 loaded and `glGetString` resolved |
| Package change between red and green | Only `libgles2:amd64 1.7.0-1+b2` added |
| Existing installer fixture | Exit 0 in a separate disposable container |

See the [combined result](result.json), [red log](red.log), [green log](green.log), [before package list](host-packages-before.json), [corrected package list](host-packages-after.json) and captured [test script](host-graphics.sh). The original experiment notes are retained separately in [original-notes.md](original-notes.md).

The executed amd64 image manifest is `sha256:abc9cb88a5587630d7f915f47b23b0668fe250fbfc6457aa4d52b534c1bbf73f`, recorded in [amd64-image-manifest.json](amd64-image-manifest.json). Generic local multi-platform image inspection selected a separately retained arm64 variant; the explicit amd64 manifest and [runtime receipt](runtime.txt) identify the executed environment. The container used two CPUs, 2 GiB RAM and a read-only source mount. It was stopped and preserved after the experiment.

The test installs packages through real APT and uses the loader with `RTLD_NOW`, clearing inherited loader overrides. Python is a test prerequisite. This check requires no display or GPU, so its pass establishes library availability rather than full rendering or physical-device acceptance. The existing installer fixture still uses mocked package/service operations; the new test covers the real dependency gap those mocks missed.

Red and green took 44.664 and 3.286 seconds respectively. Green reused the packages installed during red; these are regression-test timings, not independent cold-build measurements. No candidate was rebuilt or published by this test.

Original files remain in `.artifacts/acceptance-277/host-gles-regression`. All 21 source files are retained byte-for-byte; [retention.json](retention.json) records original and retained hashes, and [SHA256SUMS](SHA256SUMS) covers this directory. Actual credential-value and private-identifier scans found no material requiring redaction.
