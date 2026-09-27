# Sendspin roles

Sendspin is Couch's only synchronized-audio backend. Its optional host runs inside Bun. It uses `@sonn-audio/node-sendspin` 0.6.2 for encrypted protocol sessions and the existing FFmpeg PCM decoder for HTTP audio sources. There is no Python helper or runtime. A Sendspin client joins an existing server; enabling that client role does not enable Couch's host role.

The frontend uses the official `@sendspin/sendspin-js` 5.0.0 client, which owns clock synchronization, decoding and Web Audio scheduling. Explicitly choose `suite: "aesgcm"`: Bun's current `node:crypto` implementation does not support the server dependency's ChaCha cipher. A client that only uses ChaCha cannot connect to this host yet.

## Hosting and enrollment

Set `COUCH_SENDSPIN_CONFIG` to a JSON configuration file before starting Core:

```json
{"host":"0.0.0.0","port":8927,"name":"Couch audio"}
```

The option is independent of native playback and is disabled when unset. Core-only
installations can host groups; browser/Tauri clients can join without hosting.

Configure the local listen IP, port and group name. The optional `publicUrl` is the client-reachable address on your LAN, not a public deployment. This URL is a `ws://` or `wss://` endpoint without embedded credentials, query or fragment. An HTTPS application needs a reachable WSS endpoint; see [optional local HTTPS](local-https.md). Private identity and per-client PSKs remain in Core's durable store; public URLs contain no credentials.

Couch enrollment provisions a random per-client long-term PSK through its authenticated channel. The official client accepts it through `longTermPsks: [{ psk, serverId }]`, with `unpairedAccess: false`. The server dependency verifies it through its public `PskProvider`; unknown clients, incorrect PSKs and legacy plaintext connections are refused. Revocation disconnects current connections as well as denying future handshakes. PIN pairing and arbitrary external-client onboarding are not provided by this dependency; external players must support explicit long-term-PSK provisioning and AES-GCM.

To enroll an external receiver that supports explicit PSKs:

1. Persist its cryptographic identity and obtain its 43-character base64url `clientId`. Reusing the identity is necessary for reconnects.
2. From an already paired Couch controller, `POST /api/sendspin/enrollment` with `Authorization: Bearer <controller token>`, `Content-Type: application/json`, and `{"clientId":"<clientId>"}`. The response contains `url`, `serverId`, and a client-specific `psk`.
3. Store the PSK and server ID in the receiver's protected settings. With [`@sendspin/sendspin-js`](https://github.com/Sendspin/sendspin-js#encryption-and-pairing), use the persisted identity/storage, `baseUrl: url.replace(/\/sendspin$/, "")`, `suite: "aesgcm"`, `longTermPsks: [{ psk, serverId }]`, and `unpairedAccess: false`. Connect to the returned endpoint and select that connected receiver as a group member in Couch. Pass credentials through protected settings or standard input rather than shell arguments or logs.

This provisions a long-term PSK through Couch's authenticated controller channel; it is not Sendspin PIN or pairing-token onboarding. The latest published [`@sonn-audio/node-sendspin` 0.6.2](https://github.com/sonn-audio/node-sendspin#encryption) only exposes a PSK provider and explicitly lacks server dynamic PIN, static PIN, pairing PSK, trust-store, and management flows. The [Sendspin spec](https://github.com/Sendspin/spec#pairing) requires those server pairing flows. The [Rust `sendspin-rs` library](https://github.com/Sendspin/sendspin-rs#current-status) still documents client foundations as its completed work, so it supplies no supported replacement host pairing path. PIN-only receivers require a maintained TypeScript or Rust server dependency to add those flows; when one exists, integrate its pairing API with Couch's durable credential store.

In the existing output menu, choose **Join Sendspin server…**, then **This Couch**
or **Another server**. Continue prepares credentials; Join is the explicit browser
audio gesture. This Couch provisions credentials through the current pairing.
Another server uses the official client's pairing flow. The dialog keeps volume,
transport controls and Leave accessible even if the Couch control connection drops.

Stop local direct playback before joining; other targets continue playing. In Tauri,
use the existing Another Couch mode with native receiver enrollment disabled. This
keeps one renderer on the local device. Leaving restores normal direct rendering.
Opening a page or restarting a client never connects or plays automatically.

Only explicitly selected, connected members receive audio. Restoring membership does not start playback. The library owns protocol encoding and Noise; Couch owns session intent, member selection and media pacing. Client controller commands return through Core authorization instead of creating an independent queue. Volume and mute are published from observed client state.

## Buffering and transfer safety

The producer reads bounded 48 kHz, 16-bit stereo PCM blocks and sends one timestamped timeline to all joined clients. It limits scheduled audio to 500 ms ahead, caps socket backlog and fails closed if delivery misses its deadline. Client timing changes, connection loss and decoding failures make the group unavailable. Reconnect clears output and restores idle; it never resumes automatically.

Stop, pause, seek and membership changes clear/end the previous stream and wait a one-second software drain interval. **This interval alone does not prove that an arbitrary speaker is silent.** The optional `qualifiedClientIds` configuration is an operator assertion that the listed identities still use the qualified SDK/software-output configuration. Handoff is enabled only when that assertion identifies a qualified renderer and its reported static delay is zero with lead and buffer requirements at most 250 ms. Other groups advertise unverified transfer safety. Enrollment authenticates an identity; it does not qualify its audio output. Physical speaker synchronization and hardware output latency require separate measurements.

## Verification

`bun test src/server/sendspin.test.ts` runs actual official JavaScript protocol clients against the host, verifies encrypted admission and rejection, decodes real FFmpeg PCM, checks seek/speed and command cancellation, and observes volume and revocation. These tests validate protocol and decoded data, not an audible sink. `tests/linux/sendspin.ts` is the separate software-output qualification fixture; its receipts must identify the client version, rendering environment and exact observations before enabling a qualified client.
