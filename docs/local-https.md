# Optional local HTTPS

Couch is for the local computer and home network. Ordinary LAN access uses the
existing listener and pairing. Use HTTPS only when a browser feature needs a secure
context (for example WebCodecs or the service worker), or local encrypted transport
is wanted. This requires neither public hosting nor router port forwarding.

For an independently running Core behind a local proxy:

```sh
COUCH_HTTPS_ORIGIN=https://couch.home.arpa
COUCH_HTTPS_PROXY_IPS=127.0.0.1
```

Use one canonical HTTPS origin, without a path or trailing slash, and the exact IP
of the proxy connection to Core. The Core listener can remain on loopback. Point
your local DNS name at the LAN host. For example, Caddy on that host:

```caddyfile
couch.home.arpa {
    bind 192.168.1.10
    tls internal
    reverse_proxy 127.0.0.1:4100
}
```

Replace the example LAN address with the host's address. Trust Caddy's local CA on
each browser device using the platform's normal certificate installation. Caddy
may trust its own host automatically; other devices need that trust explicitly.
See Caddy's [local HTTPS](https://caddyserver.com/docs/automatic-https#local-https)
and [reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)
documentation. Certificate provisioning stays with the maintained proxy.

Pair with the ordinary Couch code at the HTTPS address. Browser credentials belong
to that origin. Allow remotes and revocation work exactly as on direct LAN access;
there is no separate public-access or external-pairing mode. The private native host
token is never accepted through the proxy. Host, Origin and forwarding headers must
match the configured address and trusted transport peer.

If this HTTPS client joins Couch's Sendspin host, set the Sendspin configuration's
`publicUrl` (the client-reachable endpoint, despite the field name) to
`wss://couch.home.arpa/sendspin`. Replace the single proxy directive above with:

```caddyfile
reverse_proxy /sendspin 127.0.0.1:8927
reverse_proxy 127.0.0.1:4100
```

Both application and Sendspin traffic stay on the LAN. HTTPS pages require WSS;
ordinary media still travels directly from provider to client and remains subject
to browser CORS and mixed-content rules. Earlier isolated HTTPS/WSS browser receipts
are retained in the playback validation records; they make no public deployment claim.
