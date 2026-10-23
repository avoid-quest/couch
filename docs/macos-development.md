# macOS development capture permissions

Use a separate `Couch Dev` bundle and a persistent signing identity for capture
tests. A scratch data directory separates Couch's database and Chromium profile;
it does not separate macOS permissions when the bundles share an app ID.

macOS remembers a code-signing **designated requirement**, not just the app's
name. Ad-hoc signing (`mac.identity: "-"`) ties that requirement to one build;
releases use Couch's own certificate instead ([CI](ci.md)).
Rebuilding can leave Screen Recording enabled in Settings while macOS rejects
the new executable. Repeated toggles and relaunches do not fix identity changes.
[Apple explains this behavior](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements).

## Set up a development identity once

Use an existing development signing identity, or create a local certificate in
**Keychain Access → Certificate Assistant → Create a Certificate**:

- Name: `Couch Development`.
- Identity type: **Self Signed Root**.
- Certificate type: **Code Signing**.
- Store its private key in the **login** keychain and reuse it for every build.

Apple supports self-signed certificates for internal development. They establish
continuity between builds; they are not Developer ID distribution certificates.
Do not export the private key into this repository or recreate the certificate
on each build. [Apple's certificate procedure](https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/Procedures/Procedures.html).

If the new identity is reported as untrusted, set that certificate's trust for
**Code Signing** only in Keychain Access. Leave the other trust purposes at their
defaults. Confirm it is available before building:

```sh
security find-identity -v -p codesigning
```

## Package and launch the isolated app

Install Go 1.27.2 on PATH, CMake, git and Xcode command line tools for packaging.
The package hook builds the live relay and bundled QuickJS for the selected
architecture inside the app before code signing ([packaging](ci.md)).

These overrides use the repository's electron-builder v26 configuration. Keep
the same bundle ID and certificate across rebuilds. `forceCodeSigning` makes a
missing certificate fail the build instead of silently falling back.

```sh
bun run package --mac --dir --arm64 \
  -c.appId=quest.avoid.couch.dev \
  '-c.productName=Couch Dev' \
  -c.extraMetadata.identifier=quest.avoid.couch.dev \
  -c.directories.output=.artifacts/app-dev \
  '-c.mac.identity=Couch Development' \
  -c.forceCodeSigning=true

couch_dev_app="$PWD/.artifacts/app-dev/mac-arm64/Couch Dev.app"
codesign --verify --deep --strict "$couch_dev_app"
codesign --display -r - "$couch_dev_app"
couch_dev_data=$(mktemp -d "${TMPDIR%/}/couch-dev.XXXXXX")
open -n --env "COUCH_DATA_DIR=$couch_dev_data" --env COUCH_PORT=4510 \
  "$couch_dev_app"
```

For an existing scratch run, reuse its recorded data directory and port. Stop
only its recorded, verified PID before replacing the bundle. For Intel builds,
use `--x64` and `mac` instead of `--arm64` and `mac-arm64`.

Start capture from **Couch Dev**, grant its screen/system-audio permission, and
relaunch the same bundle with the same environment if macOS requests it. The
macOS **Quit & Reopen** action can discard the launching environment; stop that
reopened dev process and use the recorded launch command again. The overridden
package `identifier` keeps even that fallback separate from installed Couch. Use
LaunchServices (`open`), because Electron launched directly from a terminal or
IDE can attribute audio capture to that parent. Couch already supplies the
required `NSAudioCaptureUsageDescription` and microphone description.
[Electron's capture requirements](https://www.electronjs.org/docs/latest/api/desktop-capturer).

## Diagnose a stale decision

Check the scratch log at `$COUCH_DATA_DIR/logs/couch.log` and macOS's `tccd` log.
`Failed to match existing code requirement` means the saved permission belongs
to a different signature. Inspect `codesign --display -r -` before requesting
another grant. The dev signature should bind the identifier to its certificate,
not only a changing `cdhash`.

If a stale decision remains after correcting signing, quit **Couch Dev** and
reset only the affected service for its development ID:

```sh
tccutil reset ScreenCapture quest.avoid.couch.dev
tccutil reset AudioCapture quest.avoid.couch.dev
```

Run only the reset needed for the failing permission. These commands remove
decisions; they do not grant access. Relaunch and trigger actual capture to
request consent. Do not reset `quest.avoid.couch`, use a global reset, or edit
the TCC database. [Apple's scoped reset procedure](https://developer.apple.com/documentation/xcode/resetting-access-to-protected-resources-in-macos).

Verify a changing screen and non-silent system audio at a receiving client, then
rebuild with changed contents using the same identity and repeat capture. A
Settings toggle alone does not prove either capture or permission persistence.
