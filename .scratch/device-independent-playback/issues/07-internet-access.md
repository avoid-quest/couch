# Local Couch access

> Historical issue record (2026-09-27). Its design and completion claims describe the earlier session/group model. Follow [the replacement product contract](../../../docs/playback-product.md) and [current acceptance matrix](../map.md).

Type: scope decision
Status: public deployment retired by the user on 2026-09-27

Couch is used exclusively on the local computer and home network. Public DNS,
Internet hosting, router forwarding and WAN qualification are outside scope.
This issue keeps its filename so existing historical links remain valid.

Direct LAN access uses the existing listener and Couch pairing. Optional
[local HTTPS](../../../docs/local-https.md) retains the small trusted-proxy boundary
for browser secure-context features, using ordinary pairing and revocation.
`COUCH_HTTPS_ORIGIN` and `COUCH_HTTPS_PROXY_IPS` replace the external-access options;
the separate external-pairing toggle is removed. Forwarded requests never receive
native-host authority. Ordinary media remains provider-to-client.

The previous isolated Caddy/WebKit HTTPS/WSS playback, handoff and revocation
receipts remain in [boundary qualification](../boundaries-2026-09-27.md).
They qualify the recorded local topology. There is no missing public-deployment task.
