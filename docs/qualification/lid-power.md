# Closed-lid power qualification

[Issue #246](https://github.com/avoid-quest/couch/issues/246) requires physical
tests on the installed appliance. Package checks cannot establish lid behavior,
phone recovery, local controls or audible playback.

## Software checks

In a disposable Ubuntu 24.04 amd64 environment, run
`sudo bash scripts/test-appliance.sh`. It checks the installed vendor lid values,
replacement of the old AC-suspend policy through `install-couch`, preservation
of administrator overrides and a `/dev/null` mask, and retained configuration
and fixture data. APT and service operations in this fixture are doubles.
Systemd itself resolves configuration-file precedence. This is not a live
logind event or a production database/pairing test.

## Install during the reserved maintenance window

Coordinate with every task using the shared TV before installation, playback,
HDMI changes or power tests. Keep an operator at the laptop with its paired phone
and administrator terminal. Stop playback first. Record the named HTTP address,
current app/coordinator identities from Diagnostics, companion metadata below,
and the selected permitted title. Keep credentials and database copies private.

```sh
date -Is
dpkg-query -W couch-appliance
cat /usr/share/doc/couch-appliance/build-info.json
systemd-analyze cat-config systemd/logind.conf
systemd-inhibit --list
```

Build the companion from the reviewed, committed revision in Ubuntu Docker on
the Mac with `sh scripts/build-appliance.sh OUTPUT VERSION`. Use an unused
monotonic version newer than the installed companion. Record its source revision
and SHA-256, transfer it with the reviewed installer, and compare the transferred
hash. The T480 does not build software.

In the operator's private administrator terminal, make a verified copy of the
installed `/var/lib/couch/application/Couch.AppImage` outside its application
directory. Compare its SHA-256 to `archiveSha256` in the installed `build.json`.
Use that copy and the new companion with the
[supported installer](../install-couch.md). It stops the application before
backing up its data and restarts the session after reloading logind. Preserve
and compare the configured data path, configuration, signing trust, and stable
pairing fields across the installation. A changing device last-seen timestamp
alone is not a lost pairing. Confirm the already paired phone reconnects.

Read back companion metadata and the merged logind configuration again. Resolve
any administrator override with its owner; do not delete it to force a pass.
The AC test expects `HandleLidSwitchExternalPower=ignore`, battery undocked
expects `HandleLidSwitch=suspend`, and docked expects
`HandleLidSwitchDocked=ignore`. Record active inhibitors too.

## Physical sequence

For each display condition below, record AC state and each connector's name and
status before closing the lid and while it is closed. TV power state is an
operator observation, not a substitute for connector readback.

```sh
date -Is
cat /proc/sys/kernel/random/boot_id
cat /sys/class/power_supply/AC/online
cat /proc/acpi/button/lid/*/state
for connector in /sys/class/drm/card*-*/status; do
    printf '%s: ' "$connector"; cat "$connector"
done
```

From another machine, poll SSH and the named HTTP address every five seconds,
recording UTC timestamps, failures and recovery duration. Record the native and
coordinator PIDs before and after. Keep the paired phone open and observe its
connection state. HTTP 200 alone does not prove an authenticated phone works.

| Check | Required observation | Result |
| --- | --- | --- |
| AC, HDMI unplugged | Close lid for at least ten minutes; SSH, named HTTP and paired phone remain reachable or the phone recovers automatically. Explicitly play then pause the permitted title from that phone while the lid remains closed. Record command timing and playback state. | Pending |
| AC, HDMI connected, TV off | Repeat closed-lid reachability checks; record whether Linux still detects HDMI. | Pending |
| AC, HDMI connected, TV on | Repeat closed-lid reachability checks and observe TV output. | Pending |
| Lid reopened | Local picture, keyboard/pointer and Couch controls remain usable after each AC case. | Pending |
| Battery only, undocked, HDMI unplugged | Confirm AC reads 0, close lid and observe suspend in the journal. Reopen or wake locally, restore AC, and confirm service/phone recovery. | Pending |
| Explicit power controls | With the operator ready to wake or power on locally, exercise the power button and administrator suspend/reboot/poweroff actions according to the retained local policy. Record shutdown/suspend and recovery separately. | Pending |
| Installed preservation | Compare private pre/post data and stable pairings, configuration, trust and running identities after the supported upgrade. | Pending |

Capture the test interval from `journalctl -u systemd-logind -u systemd-suspend`
and relevant Couch startup/error entries. An AC case fails on a lid-triggered
suspend even if reopening promptly restores networking. Record every failure
and any skipped action. Keep #246 open until its physical criteria pass.
