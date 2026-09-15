# T480 public installation with the Mac offline

The freshly installed Debian 13.7 amd64 T480 downloaded and installed production Preview `0.1.0-preview.1` while the Mac's Wi-Fi was disabled. The unchanged TV installer ran once and exited 0. These receipts establish public download, verification and installation on an independently powered target. They do not establish GUI, playback, reboot or signed-update acceptance.

## Result

| Observation | UTC time or result |
| --- | --- |
| Mac offline interval | 2026-09-15 00:39:20.736249 to 00:49:20.815586 |
| Target bootstrap, download and installation operations | 00:39:58 to 00:41:12 |
| Installer result | Exit 0 |
| Installed source revision | `3f91c0564bbbeea04eef421977f2e67b17c8fb14` |
| AppImage SHA-256 | `d67dab162272ab340d42a6ee70d7a35055696e99be2a8b0cb87edceb60c55ef7` |
| Installed package entries | 351 before, 603 after |
| Package changes | 252 additions, no upgrades or removals |
| Mac connectivity restored | 00:49:26, Wi-Fi on and public key request HTTP 200 |

The installer provisions the declared TV host dependencies and the `couch-tv` account. The target consumes published packages; no application build ran on it. The [installed build identity](receipts/installed-build.json), [installer result](receipts/installer-status.txt) and [package delta](receipts/packages.delta) record the result.

## Offline observation

The [schedule](offline/schedule.json) started a collector in an existing durable administrator terminal session on the T480 before disconnecting the Mac. The collector delayed its acceptance operations until the scheduled target start time. The Mac observer then disabled Wi-Fi for 600 seconds. The Mac stayed powered on.

[Observer events](offline/events.jsonl) record Wi-Fi off and no selected default-route interface throughout the interval, sampled approximately every 30 seconds. Public key probes failed at both ends with curl exit 6 and HTTP status `000`. The retained `defaultRouteExit` is 0 even when no interface was returned; the observer checks the parsed interface, Wi-Fi state and failed public probe together. Afterward it restored Wi-Fi and verified the same public key URL returned HTTP 200. An independent restoration process was scheduled and canceled after successful restoration.

The target's [stage timestamps](receipts/stages.tsv) and [final status](receipts/result.txt) place its bootstrap, downloads, verification and installation wholly inside that observed interval. This comparison uses the timestamps recorded by the two machines. No extra clock-offset measurement is claimed.

## Public bytes and installation

The T480 fetched the enrolled key from the Couch website and all six release files from the public Preview download endpoints. [HTTP receipts](receipts/http) retain requested URLs, final redirects, status codes and response headers. The collector verifies the enrolled key against the trusted manifest, all six file hashes and sizes, and the three asset signatures before extracting setup or invoking the installer. See [hash results](receipts/file-hashes.log), [signature results](receipts/signature-verification.log) and the [expected manifest](receipts/expected-manifest.json).

The [collector](install-public-preview-once.sh) uses the documented `minisign`/`jq` bootstrap and unchanged `install-couch --tv` command. HTTP downloads allow bounded retries and retain response headers. The installer has no retry or repair path in this collector. Its first invocation completed successfully.

The [before](receipts/state-before.txt) and [after](receipts/state-after.txt) observations show no existing Couch installation before setup. At collection completion LightDM was enabled, but it was not listed as a running service. A later first-session start belongs to separate evidence. This directory contains no host reboot, graphical observation, playback, A-to-B update or recovery result. The collector's raw `mac_offline_condition=requires_parent_observation` field points to the companion observer events here; it was not rewritten to imply that the target measured the Mac's connectivity itself.

## Retention and sanitization

Original target receipts remain privately under `.artifacts/acceptance-277/t480/public-install-a-original/receipts`; original Mac observer files remain under `.artifacts/acceptance-277/offline`. This directory includes their readable copies and the scripts used for the run. The scheduling script references a private transport helper that is intentionally not copied; it is a record of the executed orchestration, not a standalone replay command.

Only the Mac operator's home-directory component was replaced with `OPERATOR`, in the schedule and observer summary log. Public asset identities, timestamps, statuses, hashes and signatures remain intact. [Retention metadata](retention.json) records original and retained hashes per source file; [SHA256SUMS](SHA256SUMS) covers this evidence directory. Paths in original checksum receipts still name the target's original evidence location.

The retained files were checked against the actual guest password and private key, production signing password and encrypted private key, and CrabNebula API key. No secret matched. Private IPv4 addresses, hardware MAC addresses, operator home paths, identity labels and authentication/cookie headers were also checked. No target credentials, private transport helper, downloaded executables or application data are included.
