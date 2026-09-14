# Named LAN address

This guide covers the Debian 13 app's direct LAN listener. Enable Allow remote
control locally and verify the IP address shown in Connection before adding a
name. Couch uses HTTP on port 4100 by default. Sharing off leaves only the
loopback listener used by the local app.

The machine/network administrator owns IP assignment, LAN DNS and any narrowly
scoped firewall rule. Couch setup does not install a proxy or DNS daemon,
configure router forwarding or expose Couch to the internet. LAN TLS is deferred.

## Select the local address

Couch discovers its private IPv4 address every ten seconds. With several eligible
interfaces, set `COUCH_LAN_INTERFACE` to the intended interface. If that interface
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

## Add an optional DNS name

Configure a LAN DNS name that resolves only to the selected Couch IPv4 address.
The name must work from the TV and each phone that will use it. Add its HTTP
origin using the same port as Couch:

```sh
COUCH_ADVERTISE_URLS=http://couch.home:4100
```

Set this in the same launching environment or TV environment file and restart
Couch. Multiple names can be comma-separated. Origins cannot contain credentials,
paths, queries or fragments. HTTPS and names on a different port are unsupported
by this listener. Setting an origin does not create a DNS or mDNS record.

Couch checks each name before admitting its Host and Origin or adding it to
Connection links and QR codes. A failed lookup, timeout, wrong address or invalid
origin omits that alias and displays a warning. The direct IP listener and
recovery URL remain available. Valid aliases continue working, and a repaired
alias returns after a successful refresh. Couch never forwards an existing
pairing credential to an advertised alias; a browser opening a new origin may
need pairing again.

After configuration, open the named URL from the intended phone network, pair,
open Settings and reconnect after a Couch restart. Keep the IP URL shown in
Connection available for DNS recovery.

The [earlier proxy and local TLS guide](https://github.com/avoid-quest/couch/blob/a742d35a4e03764ef613620cf82471b9eafdac8f/docs/lan-origin.md)
records the POC setup. It does not describe this Debian listener. Existing POC
installations are outside this setup's migration scope.
