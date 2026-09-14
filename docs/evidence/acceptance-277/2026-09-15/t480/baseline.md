# T480 before Couch installation

Observed on 15 September 2026 at 01:27 Europe/Rome, `2026-09-14T23:27:46Z`. The owner identified this fresh Debian installation as the physical T480 that will consume published Couch packages. This records its state before installation; it is not a passed installation or playback check.

| Item | Observed baseline |
| --- | --- |
| OS | Debian GNU/Linux 13.7, trixie, amd64 |
| Kernel | `6.12.107+deb13-amd64` |
| CPU | Intel Core i5-8350U, 4 cores / 8 threads, SSE4.1/SSE4.2/AVX/AVX2 present |
| Graphics | Intel UHD Graphics 620, kernel driver `i915` |
| Display | Internal eDP connected, 1920×1080; reported external DP/HDMI connectors disconnected |
| Memory | 7.6 GiB RAM, 7.2 GiB available during observation; 7.9 GiB swap unused |
| Storage | 232.9 GiB nonrotational drive; root ext4 about 220 GiB, 1.3 GiB used, 208 GiB available |
| Boot | UEFI; systemd reports `running`, no failed units |
| Session | `graphical.target` is the default, but no Xorg, X11 desktop session, LightDM or Xfce is installed |
| Packages | 351 installed; 206 manually marked; complete version/architecture/installed-size list retained |
| Network | `wlp3s0` up and used by the default route; `enp0s31f6` down |
| Access | Existing `couch` account, uid 1000, in `sudo`; noninteractive sudo unavailable |
| FUSE | `/dev/fuse` exists, character device, mode 0666, root:root |

No Couch application/data/configuration paths, installer ledger, recovery command, managed session, Couch system unit or Couch process were found at the documented paths. The `couch-tv` runtime account does not exist. The collector checks presence and metadata only; it does not read application data.

`minisign` and `jq` are absent. Comparing installed packages against the current installer manifest found 15 missing common packages, both audio packages missing, and six missing TV packages. [installer-prerequisites.json](before/installer-prerequisites.json) records the exact comparison. This minimal host has no existing X11 session, so the ordinary desktop installer’s session precondition is not satisfied. The dedicated TV profile supplies its documented session packages.

## Evidence and collection limits

[before/baseline.txt](before/baseline.txt) records OS, hardware, enabled/running/failed services, interfaces and checked installation paths. [before/packages.tsv](before/packages.tsv) columns are package, version, architecture, installed size in KiB, and dpkg status. [before/manual-packages.txt](before/manual-packages.txt) supports later APT comparisons. [before/display-capabilities.txt](before/display-capabilities.txt) records CPU flags and DRM connector status without EDID.

Collection used read-only SSH with `BatchMode=yes`, `StrictHostKeyChecking=yes` and the task’s existing known-hosts file. `sudo -n true` checked access without prompting. No package installation, configuration, service restart, build or application launch occurred. The host address and known-hosts file remain private; no IP/MAC address, Wi-Fi configuration, credential, disk serial, DMI serial, EDID or machine ID was collected into this evidence.

The sanitized [collector](before/collect.sh) can be rerun against the same privately identified host. Actual graphical rendering, accelerated decoding, audio, playback, setup and hosted updates remain untested by this baseline.
