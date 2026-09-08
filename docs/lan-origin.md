# Named LAN address

Set `COUCH_ADVERTISE_URLS` in `/etc/couch/appliance.env` to the origin that phones
should open. It accepts comma-separated HTTP or HTTPS origins without credentials,
paths, queries or fragments. Couch uses these addresses for Connection links, QR
codes and its exact Host/Origin allowlists. The existing `COUCH_HOST` and
`COUCH_PORT` settings control the separate HTTP listener, normally `0.0.0.0:4100`.
Tauri keeps using its private loopback connection.

Use [Caddy's official Ubuntu package](https://caddyserver.com/docs/install#debian-ubuntu-raspbian)
to serve the named origin on port 80 or 443. Its systemd service owns the proxy and
certificate storage independently of Couch AppImage updates. Merge the relevant
site block below into the administrator's `/etc/caddy/Caddyfile`; retain any
existing sites. The examples assume Couch's default port 4100.

For `http://couch.avoid.local` on port 80, set:

```sh
COUCH_ADVERTISE_URLS=http://couch.avoid.local
```

```caddyfile
http://couch.avoid.local {
    reverse_proxy 127.0.0.1:4100
}
```

For `https://couch.avoid.local` on port 443, use:

```sh
COUCH_ADVERTISE_URLS=https://couch.avoid.local
```

```caddyfile
https://couch.avoid.local {
    tls internal
    reverse_proxy 127.0.0.1:4100
}
```

[Caddy renews local certificates automatically](https://caddyserver.com/docs/automatic-https#local-https)
and redirects HTTP to HTTPS for the HTTPS site. Its
[reverse proxy preserves Host and supports WebSockets](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy),
so Couch's pairing and token checks still apply. Keep the original Host and Origin
headers. Couch does not use forwarded headers to grant access.

Validate the edited Caddyfile with `sudo caddy validate --config /etc/caddy/Caddyfile`,
then apply it with `sudo systemctl reload caddy`. Restart Couch through General to
load the changed environment. Schedule this restart around playback. The old IP
address remains available with the default listener, and existing pairings and
data remain intact. Opening a different origin has separate browser storage and
may require pairing that browser again. An HTTPS page cannot use insecure HTTP
LAN addresses as a browser fallback.

The chosen name must resolve to the TV from each phone. `.local` names use
[link-local mDNS](https://www.rfc-editor.org/rfc/rfc6762.html#section-3); Caddy does
not publish them. Arrange the named mDNS record on the phone network, or choose a
name served by your existing LAN DNS. Setting an origin does not configure DNS,
mDNS, firewall rules or router port forwarding.

For local HTTPS, each phone/browser must trust the Caddy root certificate. The
[Ubuntu service stores its public root](https://caddyserver.com/docs/running#local-https-with-systemd)
at `/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt`. Transfer that
public file through a trusted administrator channel and install it on the intended
devices. On iPhone, follow Apple's
[certificate trust instructions](https://support.apple.com/en-us/102390).
Installing the root on the TV does not trust it on phones. Keep Caddy's persistent
data and private keys protected across upgrades; replacing its CA requires clients
to trust the replacement. Never distribute the CA private key.

After configuration, verify the named URL without certificate warnings, pair,
open Settings and reconnect after a Couch restart. HTTPS browser requests use WSS
automatically. Application tests cover the proxied Host/Origin and authentication
contract; actual name resolution, TLS trust and port reachability require this
check on the intended phone network.
