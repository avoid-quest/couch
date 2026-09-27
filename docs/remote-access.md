# Explicit HTTPS access

Couch can accept paired browser controllers through a deliberately configured HTTPS
reverse proxy. Core still owns playback and authorization; the proxy owns its public
certificate and routing. This does not install a proxy, open a router port, or create
separate user accounts. Use an address and proxy you administer.

Configure the independently running Core with both values:

```sh
COUCH_EXTERNAL_ORIGIN=https://couch.example.com
COUCH_TRUSTED_PROXY_IPS=127.0.0.1
```

The origin must be canonical, with no trailing slash, path, credentials, query or
fragment. Trusted peers are exact literal IP addresses of the proxy's connections to
Core, comma-separated if necessary. They are not client addresses or subnets.
Observe the actual transport peer when using containers; Docker forwarding differs
between platforms. Keep the Core listener private to the proxy and the intended LAN.
Never forward the native host token or expose the private native interface.

For example, Caddy on the same host can serve a domain whose DNS points to that host:

```caddyfile
couch.example.com {
    reverse_proxy 127.0.0.1:4100
}
```

Caddy preserves Host, sets X-Forwarded-Host and X-Forwarded-Proto, and proxies WebSocket
upgrades. Configure another proxy to overwrite these headers with the canonical host
and `https`; do not preserve client-supplied values or add a `Forwarded` header.
Couch trusts these fields only from configured direct peers. X-Forwarded-For never
grants LAN or host access. Missing, conflicting and untrusted forwarding headers are
rejected. See [Caddy's reverse proxy documentation](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).

External pairing is disabled by default. To enroll a browser at the external origin,
set `COUCH_EXTERNAL_PAIRING=1` deliberately and use the pairing code from Core's
console. Browser pairings belong to their origin: a pairing saved at a LAN address
is not automatically available at the public address. After enrollment, disable
external pairing and restart Core if new enrollment is no longer needed. Existing
paired browsers can reconnect; disabling Allow remotes or revoking a controller
ends its access. The existing administrator claim process remains separate from
pairing. Use the configured admin recovery code for an independently running Core.

External discovery advertises only the canonical HTTPS address. Browser rendering
remains explicit. Public compatible HTTPS media stays provider-direct; provider CORS
and mixed-content rules still apply. Jellyfin's header-authenticated direct-play
media uses the existing scoped range relay through the same HTTPS origin. That relay
consumes Core's upload bandwidth. Select an existing lower rendition where available;
external access does not start an encoder or bypass unsupported source formats.

Qualification uses a real Caddy TLS proxy, WSS controller/renderer protocol and
Jellyfin range delivery. See the dated playback validation record for measured
results and browser certificate limitations. The setup does not claim Internet
routing, DNS/certificate provisioning, cross-browser media compatibility, or private
session isolation beyond the existing household controller model.
