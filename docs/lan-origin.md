# Named LAN address

This guide covers the Debian 13 app's direct LAN listener. Enable Allow remote
control locally and verify the IP address shown in Connection before adding a
name. Couch uses HTTPS with its own self-signed certificate on port 4100 by
default; plain HTTP on the LAN redirects there. Sharing off leaves only the
loopback listener used by the local app.

The machine/network administrator owns IP assignment, LAN DNS and any narrowly
scoped firewall rule. Couch setup does not install a proxy or DNS daemon,
configure router forwarding or expose Couch to the internet.

## Select the local address

Couch checks its private IPv4 selection every second, so sharing can start after
DHCP assigns an address and recover when an address or occupied port returns.
Custom DNS names are rechecked every minute. With several eligible interfaces,
set `COUCH_LAN_INTERFACE` to the intended interface. If that interface
has multiple private IPv4 addresses, also set `COUCH_LAN_ADDRESS` to the specific
local address to use. For example, if `eth0` owns `192.168.1.20`:

```sh
COUCH_LAN_INTERFACE=eth0
COUCH_LAN_ADDRESS=192.168.1.20
```

The selected address must already belong to that interface. These variables do
not assign an IP address. Couch binds only that address and admits peers from its
subnet. If a pinned address disappears, Couch reports the missing selection and
closes LAN access until it returns. Update the selection if the administrator
changes the assigned address.

Set the variables in the desktop app's launching environment, or in
`/etc/couch/appliance.env` for TV setup, then restart Couch. Schedule the restart
around playback.

## TVs that refuse the certificate

HTTPS remains the default. Some TV browsers cannot bypass a self-signed
certificate warning. To permit HTTP on the selected LAN as well, quit Couch,
then launch it with `COUCH_ALLOW_HTTP=1` in its environment. On Linux:

```sh
COUCH_ALLOW_HTTP=1 couch
```

For an AppImage, replace `couch` with its executable path. For TV setup, put
`COUCH_ALLOW_HTTP=1` in `/etc/couch/appliance.env` and restart Couch.
Enable **Allow remote control**, then open the `http://<LAN-IP>:4100` address
shown in Connection on the TV (use `COUCH_PORT` if customized). HTTPS and the
HTTPS QR code remain available. The separate port 80 listener still redirects to HTTPS, so include
Couch's port in the HTTP address. A new browser origin requires pairing again.
If the browser cached an old HTTPS redirect, clear its data for that address.

HTTP is unencrypted: other people on that network can read or change pairing
and control traffic. Enable it only on a trusted private network. It retains
the selected interface/subnet, Host and Origin checks, pairing, and the sharing
switch. Turning sharing off closes both LAN transports. Remove the environment
variable and restart to return to HTTPS only; Couch never downgrades automatically.
If you suspect someone intercepted HTTP traffic, revoke the affected paired
devices and pair them again over HTTPS. Switching back to HTTPS does not revoke
credentials that may already have been copied.

HTTP cannot install Couch as a PWA and may lack some browser codecs. Sendspin
can use PCM through Web Audio when Opus decoding is unavailable, but TV browser
support and synchronization still need testing on the actual device.

Trusted HTTPS is the longer-term alternative: a certificate trusted by the TV
and a matching DNS name avoid the warning while preserving secure-context
features. A public certificate can use DNS validation without exposing Couch
to the internet; a private CA works only if the TV browser trusts it. Couch's
direct listener currently generates its own certificate. Custom certificate
loading and renewal would be a separate change, not a setting enabled here.

## Add an optional DNS name

Couch proposes the machine's hostname joined to its network search domain by
default. A machine named `couch` with the gateway-provided search domain
`avoid.local` offers `https://couch.avoid.local:4100` when DNS resolves that name
only to the selected Couch IPv4 address. The first working search-domain name
wins; a qualified machine hostname is the fallback. The IP address always stays
available, and a missing or incorrect automatic name does not raise a setup warning.
The detected name still uses Couch's self-signed certificate; naming the server
does not make that certificate trusted by a TV browser.

**Settings → Devices → Network address** shows the detected name. Save a
different address to override it; clearing the field restores automatic selection.
`COUCH_ADVERTISE_URLS` also takes precedence, and setting it to an empty string
disables automatic names. Names use Couch's port, so automatic selection needs no
port 80 permissions. DNS is rechecked every minute. Restart Couch after changing
the machine hostname or network search-domain configuration.

Search domains come from Linux's `/etc/resolv.conf` (with `LOCALDOMAIN` taking
precedence), macOS's system DNS configuration, or Windows DNS Client settings.
Couch does not create a DNS record: the gateway or DNS administrator must already
make the name work on the LAN.

Configure a LAN DNS name that resolves only to the selected Couch IPv4 address.
The name must work from the TV and each phone that will use it. From the
playback computer or a paired Administrator, open **Settings → Devices →
Network address**. Enter `http://couch.home` for port 80, or
`http://couch.home:4100` when port 80 is unavailable. A bare `couch.home` also
uses port 80, which redirects to `https://couch.home:4100`. Couch checks DNS
and the port 80 bind before saving, and names it in its certificate at the next
start. The direct
IP address stays available. Controllers cannot change this setting.

For additional names managed with the machine's configuration, add HTTP origins
through the launching environment:

```sh
COUCH_ADVERTISE_URLS=http://couch.home:4100
```

Set this in the launching environment or TV environment file and restart Couch.
Multiple names can be comma-separated and work alongside the address saved in
Settings. They remain active when that Settings field changes or is cleared;
remove them from the environment and restart Couch if they should no longer be
admitted. Origins cannot contain credentials,
paths, queries or fragments. `https://` names must include Couch's port; names
on any other port are unsupported by this listener. Setting an origin does not create a DNS or mDNS record.

When an administrator changes or clears the Settings address while using that
address, Couch keeps the old address admitted until it restarts so the current
browser and pairing continue working. The old address is no longer offered in
Connection links or QR codes. Restart Couch to retire it.

### Port 80

A name without a port, such as `http://couch.home`, reaches port 80. When such
an alias validates, Couch opens an extra listener on port 80 of the same
selected address itself; it only redirects to HTTPS on Couch's port. There is still no proxy and no daemon of Couch's own.
The operating system must permit the bind:

- On the Debian TV, `couch-tv.service` runs as the unprivileged `couch-tv`
  user, so allow low ports for unprivileged processes and apply it once:

  ```sh
  echo 'net.ipv4.ip_unprivileged_port_start=80' > /etc/sysctl.d/90-couch-port80.conf
  sysctl --system
  ```

  If you run Couch under your own system-managed service instead, grant that
  unit `AmbientCapabilities=CAP_NET_BIND_SERVICE` and leave the sysctl alone.
- Desktop installs (macOS, Windows) cannot take port 80 without privileges.
  Include Couch's port in the name there, for example
  `http://couch.home:4100`.

When port 80 cannot be bound, saving a bare name in Settings fails. A bare name
from `COUCH_ADVERTISE_URLS` is ignored with a warning; the direct port keeps
working. The sysctl change is the administrator's decision;
Couch never asks for privileges or installs it.

Couch checks each name before admitting its Host and Origin or adding it to
Connection links and QR codes. A failed lookup, timeout, wrong address or invalid
origin, or an unbindable port, omits that alias and displays a warning. The
direct IP listener and recovery URL remain available. Valid aliases continue
working, and a repaired alias returns after a successful refresh. Couch never
forwards an existing pairing credential to an advertised alias; a browser
opening a new origin may need pairing again.

After configuration, open the named URL from the intended phone network, pair,
open Settings and reconnect after a Couch restart. Keep the IP URL shown in
Connection available for DNS recovery.

The [earlier proxy and local TLS guide](https://github.com/avoid-quest/couch/blob/a742d35a4e03764ef613620cf82471b9eafdac8f/docs/lan-origin.md)
records the POC setup. It does not describe this Debian listener. Existing POC
installations are outside this setup's migration scope.
