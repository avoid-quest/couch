# Missing GLES host dependency: real Debian regression

Fresh official Debian 13 slim amd64 container, 78 baseline packages, no GLES or WebKit installed. No build environment was used. Test-only Python came from real APT, then the actual common host-package list was installed with `--no-install-recommends`. Any compiler preprocessor packages in the resulting list are transitive dependencies of declared X11 host tools, not a supplied build cache.

Commands executed inside the same disposable container:

```sh
bash tests/package/host-graphics.sh /work/.artifacts/acceptance-277/host-gles-regression/host-packages-before.json
# exit 1: OSError: libGLESv2.so.2: cannot open shared object file: No such file or directory
bash tests/package/host-graphics.sh
# exit 0: PASS: declared host packages provide loadable GLESv2
```

Red took 44.664 seconds. Green took 3.286 seconds. The only package change between these runs was `libgles2:amd64 1.7.0-1+b2` (17.3 kB downloaded). The runtime check calls the real loader with `RTLD_NOW`, resolves `glGetString`, and clears inherited loader overrides. It does not require a display or GPU. It specifically covers the omitted GLES SONAME and does not establish full WebKit rendering or device acceptance.

`amd64-image-manifest.json` and `runtime.txt` identify the actual amd64 root filesystem; Docker's generic local multi-platform image inspection (`image.txt`) defaults to the separately retained arm64 variant. The executed manifest is `sha256:abc9cb88a5587630d7f915f47b23b0668fe250fbfc6457aa4d52b534c1bbf73f`. Container constraints: two CPUs, 2 GiB memory, 256 processes; repository bind mount read-only. `couch-277-host-gles` is stopped and preserved with package state. Existing containers were not changed.

The existing `tests/package/installer.sh` also passed in a separate disposable amd64 builder container with no network. It remains a mocked installer contract test; the new real-APT test supplies the missing dependency coverage. The fixture container was removed on exit.

Source changes are limited to adding `libgles2` to `packaging/setup/files.json` and adding executable `tests/package/host-graphics.sh`. No candidate bytes were rebuilt or replaced, no publication occurred, and the T480 was untouched by this collector.
