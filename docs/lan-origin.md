# LAN address

**Settings → Devices & network → Share on network** opens Couch's LAN listener:
HTTPS with its own self-signed certificate on port 4100, with plain HTTP on the
LAN redirected there. Sharing off leaves only the loopback listener the local
app uses. Couch never installs a proxy or DNS daemon, configures router
forwarding or exposes itself to the internet; IP assignment, DNS and firewall
rules belong to the network's administrator.

## Address selection

Couch picks a private IPv4 address automatically: Ethernet first, then Wi-Fi,
then other adapters (ties: interface name, then lowest address). It rechecks every
second, so sharing starts once DHCP assigns an address. Once it selects an
address automatically, it keeps that interface until restart; if it disappears,
LAN access closes until it returns.

Optional overrides, in the app's launching environment or
`/etc/couch/appliance.env` on the TV: `COUCH_LAN_INTERFACE=eth0`,
`COUCH_LAN_ADDRESS=192.168.1.20` (the address must already belong to the
interface). Restart Couch after changing them.

## TVs that refuse the certificate

Some TV browsers can't get past a self-signed certificate. An admin can turn on
**Allow HTTP connections**; then open the `http://<LAN-IP>:4100` address shown
when pairing. A new origin pairs again. HTTP is unencrypted, so use it only on a
trusted network; if traffic may have been intercepted, revoke and re-pair the
devices over HTTPS. HTTP can't install the PWA and may lack codecs (Sendspin
falls back to PCM). `COUCH_ALLOW_HTTP=1` is a startup default; a saved choice wins.

## DNS names

Couch proposes the machine's hostname joined to its network search domain
(`couch.example.home.arpa`) when DNS resolves it only to the selected address.
**Network address** in Settings overrides it; clearing it restores automatic
selection. `COUCH_ADVERTISE_URLS` (comma-separated origins) adds names from the
environment, and an empty value disables automatic names. Couch rechecks DNS
every minute, checks each name before admitting its Host/Origin, and never
forwards a pairing credential to an alias. The name still uses the self-signed
certificate.

A name without a port (`http://couch.home`) needs a port 80 listener, which only
redirects to HTTPS on Couch's port. The OS must allow the bind; on the Debian TV:

```sh
echo 'net.ipv4.ip_unprivileged_port_start=80' > /etc/sysctl.d/90-couch-port80.conf
sysctl --system
```

Desktop installs can't take port 80 without privileges; include Couch's port in
the name there. When an admin changes the address while using it, the old one
stays admitted until restart so the current browser keeps working.
