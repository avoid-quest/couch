# macOS development and capture permissions

macOS remembers an app's permissions by its code-signing **designated
requirement**. Ad-hoc signing ties that to one build, so after a rebuild Screen
Recording can look enabled in Settings while macOS rejects the new executable;
toggling doesn't fix it. Test capture with a separate **Couch Dev** bundle signed
by a persistent identity. Releases use Couch's own certificate ([ci.md](ci.md)).

## Set up a signing identity once

In **Keychain Access → Certificate Assistant → Create a Certificate**: name
`Couch Development`, **Self Signed Root**, **Code Signing**, private key in the
login keychain. Reuse it for every build and never put its key in the repository.
If it's reported untrusted, trust it for **Code Signing** only. Check:

```sh
security find-identity -v -p codesigning
```

## Package and launch Couch Dev

Packaging needs Go, CMake, git and the Xcode command line tools.

```sh
bun run package --mac --dir --arm64 \
  -c.appId=quest.avoid.couch.dev '-c.productName=Couch Dev' \
  -c.extraMetadata.identifier=quest.avoid.couch.dev \
  -c.directories.output=.artifacts/app-dev \
  '-c.mac.identity=Couch Development' -c.forceCodeSigning=true

couch_dev_app="$PWD/.artifacts/app-dev/mac-arm64/Couch Dev.app"
codesign --verify --deep --strict "$couch_dev_app"
couch_dev_data=$(mktemp -d "${TMPDIR%/}/couch-dev.XXXXXX")
open -n --env "COUCH_DATA_DIR=$couch_dev_data" --env COUCH_PORT=4510 "$couch_dev_app"
```

For Intel use `--x64` and `mac` instead of `mac-arm64`. Launch through
LaunchServices (`open`): Electron started from a terminal or IDE attributes
capture to that parent. macOS's **Quit & Reopen** drops the launch environment;
stop that process and relaunch with the command above.

## A stale permission

`Failed to match existing code requirement` in the `tccd` log means the saved
permission belongs to another signature; check `codesign --display -r -`. Reset
only the affected service for the development ID, then relaunch and capture:

```sh
tccutil reset ScreenCapture quest.avoid.couch.dev
tccutil reset AudioCapture quest.avoid.couch.dev
```

Never reset `quest.avoid.couch`, reset globally or edit the TCC database.
