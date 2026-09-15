# Signed candidate metadata extraction

The existing diagnostic minimal Debian clone verified the production A AppImage and extracted only `usr/lib/Couch/release.json` through its standard `--appimage-extract` command. Minisign verified both signatures. The extracted file exactly matches the generated release resource for revision `3f91c0564bbbeea04eef421977f2e67b17c8fb14`.

The authoritative successful receipt is `decoded-signature-attempt/summary.json`, SHA-256 `a4c3481d0b71c068d8ed6519f2086a7cebec847e19bd98920d184e5e1baa2296`. That folder also contains the signature and extraction logs, extracted JSON and package manifests. The original installed AppImage hash and package manifests are unchanged.

The initial collector passed Tauri's base64 key and signature directly to Minisign. It stopped before extraction with `Error while loading the public key file`. Its unchanged script, driver output and guest receipts remain in this directory and `first-attempt-receipts`. The separate successful attempt decodes the envelopes exactly as the release installer does. No guest packages or installed files were repaired.

This is a signed candidate resource check on a diagnostic clone. It does not establish installed launch, GUI, playback, fresh installation or Mac-offline acceptance. The candidate's AppRun was not invoked. `shutdown.json` and `vm-final-state.txt` record cleanup.
