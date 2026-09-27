# Use Couch from outside the home through an explicit remote-access setup

Type: task
Status: open
Blocked by: 01, 02

## Goal

Use the browser and its playback targets over a deliberately configured HTTPS proxy
or private-network setup. This is separate from supporting remote media providers on LAN.

## Work

- Preserve current LAN admission while adding the chosen topology, canonical external
  origin and explicit trusted-proxy configuration. Don't assume tunnel access works
  through existing subnet checks or expose the private native host interface.
- Use appropriate browser authentication and narrow media grants; keep long-lived
  credentials out of media URLs/logs. Authorize renderer registration/control separately
  from claiming a target ID. Revocation must end access and prevent renewal.
- Ensure destination URLs are reachable outside LAN and that headers, ranges,
  WebSocket upgrades and manifest child resources survive the configured proxy.
- Prefer provider → remote browser directly when allowed. For Couch relay, account
  for home upload, select existing lower renditions, and provide usable quality limits.
- Limit public pairing/bootstrap deliberately. Household-only remote access need not
  wait for independent users, but must not claim private-user isolation until it exists.

## Done when

The chosen external topology supports browsing, playback, control and handoff with
the actual authorization and bandwidth behavior recorded. No unauthenticated URL
proxy, broad host token disclosure or silent weakening of LAN rules. Cloud relay,
automatic router configuration and multi-Core federation are not required.
