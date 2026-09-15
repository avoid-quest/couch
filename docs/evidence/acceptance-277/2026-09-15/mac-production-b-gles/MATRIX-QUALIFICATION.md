# Corrected B qualification matrix

Exact source: `61739ad7ce782da5482067f16a5727306cd65d6a`. Version: `0.1.0`.

| Check | Evidence |
| --- | --- |
| Signatures and inventory | `verify-candidate.log` and `final-verify.log`: official verification passed on retained signed assets. VM also verified full AppImage and comment signature. |
| Typecheck | `typecheck.log`: passed in amd64 builder with private signing/provider variables unset. |
| Bun | `native-bun-full.log`: native ARM64 Debian, Bun 1.4.2+744846f84, 1252 passed, 20 skipped, zero failures. `amd64-inventory-tests.log`: all12 architecture-specific cases passed. `native-bun-clock.log`: three real-clock tests passed. |
| Native | `native-rust-tests.log`: amd64 locked release suite, 39 passed, one existing ignored test, zero failures. |
| Signed metadata extraction | `diagnostic-minimal-extraction/summary.json`: real x86_64 Debian VM, Minisign and standard AppImage extraction exit0; exact metadata bytes match. |
| Installer | `installer-fixture.log`: fresh disposable Debian, no network; real signatures/permissions/locks with package/service/FUSE test doubles, all cases passed. |

`test-coverage-matrix.json` names every additional ARM64 skip. Twenty skips consist of12 inventory cases, two unnamed inventory lifecycle hooks and six optional live-provider tests. All12 named inventory cases pass on amd64. Main-case union is1264; the three extra cases relative to old B are the committed readiness retry tests. Clock3 is separate. No additional named tests are uncovered; six optional live-provider cases do not establish live-provider acceptance.

VM candidate SHA256 `dd50813112c9643faddeedee46889e8102965c97f5d77bfd43d45756a20c6a05`; extracted metadata SHA256 `a89f6257aded42e598c7358a6e49a662ae9cdf0153f03e63ccb8775f80aa3d92`; summary SHA256 `50e51725a71f1fa9e3045c6ac53bff0b5560b792e46cf54a61a48c427daeea93`. The metadata identifies corrected source/version/target and its host package list includes libgles2. Installed application and Debian package manifests stayed unchanged; no AppRun invocation occurred.

The source and signed setup host lists were separately checked against the successful real-APT GLES regression. This catches the dependency omitted by old A/B; it supplements the mocked installer fixture and does not replace actual GUI acceptance. The receipt explicitly records this split matrix and does not claim an uninterrupted unchanged hosted-qualify script pass.
