# Signed B metadata extraction

The existing diagnostic minimal Debian clone verified the production B AppImage and extracted only `usr/lib/Couch/release.json` through the standard `--appimage-extract` command. Tauri's public key and signature envelopes were decoded before Minisign verified both signatures. The extracted file exactly matches the generated release resource for version `0.1.0`, revision `bb03a3a54f5ca2a1664cd6235c61cf39e4fa5a7e`.

The authoritative receipt is `summary.json`, SHA-256 `dc9e7777603da6cf383b9a9d547f115d5cc8f9b9e4770693e6533978ced56113`. This directory also contains signature and extraction logs, extracted JSON, input hashes and package manifests. The original installed AppImage hash and package manifests are unchanged. The probe passed on its first candidate execution.

This check does not establish installed launch, GUI, playback, fresh installation or Mac-offline acceptance. The candidate's AppRun was not invoked. `shutdown.json` records a successful guest shutdown command, and `vm-final-state.txt` confirms the diagnostic clone stopped. Other VMs were untouched.
