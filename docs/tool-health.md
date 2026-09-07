# Managed media-tool health

An administrator can request `GET /api/tools` to check this TV's local tools.
The endpoint accepts no parameters or mutations. It checks only yt-dlp, Deno,
and ffprobe, never a website or a media source. Results omit executable paths,
environment values, and raw command output.

For a packaged native Ubuntu build, the expected yt-dlp and Deno versions and
SHA256 values come from the compiled release build identity. The checked files
are the package's fixed `/usr/lib/Couch/tools/yt-dlp` and `deno` resources. Each
regular file is hashed in 1 MiB chunks, with a 256 MiB cap, before its fixed local
version command runs. Missing files, changed bytes, symbolic links, unexpected
versions, missing execute permission, and inconclusive checks have distinct
results. Source builds without release metadata report unknown integrity.

The effective executable is reported separately. An environment override or
PATH fallback cannot hide damage to the package copy. Aliases of package files
reuse their integrity result; a corrupt copy is never run by the health check.
ffprobe is a runtime dependency and receives an availability/version check,
not a Couch release hash verdict. Source or network errors do not imply that
these local tools are damaged. Ubuntu package/security-update status is outside
this endpoint.

Checks share a 10-second cache and one pending collection. Each fixed version
probe inherits only PATH and the C locale, with the existing 1.5-second/4-KiB
diagnostics limits. The response deadline is 10 seconds. A stalled filesystem
operation remains the only pending job after that deadline; repeated requests
cannot accumulate more work. Checks write no files, stop no playback, and run
no network, update, download, or repair commands.

This is the independent health slice of issue #22. Repair must later request an
exact-current authenticated release reinstall through the completed manual
maintenance mechanism in issue #7. APT remains the installed-file owner. No
repair control is offered until that mechanism can provide progress, preserve
user data, and verify the repaired release. Automatic rollback remains issue #8.

Ubuntu status uses bounded native APT simulation and dependency checks. Counts describe actionable Ubuntu upgrades in the resolver plan, including security-pocket upgrades; held or unresolvable candidates and newly required dependencies are excluded. A successful dependency check reports zero broken packages. Failed checks leave unknown counts and show an error instead of inventing a total. The owner accepted this diagnostic change when removing Python. No repository refresh or installation occurs during Check tools.
