# Identify a song on radio

Play a radio station and open its player. Choose **Identify song** to take a
short excerpt and look up the song. Playback continues while it listens. A
match shows the artist, title, time of the excerpt and a link to Shazam. If
there is no match, try another part of the stream. **Cancel** stops the request.

Recognition runs only when someone presses the button. Opening the player,
playing a station and receiving state updates never start it. The result
belongs to that open player; changing the station, playback or Couch, leaving
the player or disconnecting clears it. It does not replace the station or
programme title, change playback, create a history or update other viewers.

## What the prototype needs

Core must be able to reach the station and Shazam over the internet. It uses
Couch's existing FFmpeg helper, which Couch provisions if needed. There is no
Python environment, API key, recognition server or local song database to set
up. The fingerprint generator is TypeScript and bundles with Core; `fft.js`
provides its Fourier transform.

Only saved public HTTP(S) radio streams are supported by this prototype.
This includes Radio Browser favorites queued with their stream URL.
Private-network streams, local files and stations requiring custom headers or
sign-in cannot be sampled. A station can still play in Couch even when it
cannot be identified. One identification runs at a time per Couch; another
viewer can try again after it finishes. The whole request has a 45-second
deadline, including a maximum 20 seconds for the service request.

Couch opens a separate connection to the station and decodes up to 12 seconds
into mono, 16 kHz PCM, passed directly to the fingerprint generator. The sample
stays in memory. It generates an acoustic fingerprint locally and sends that
fingerprint and duration to Shazam, along
with a request timestamp, random request identifiers and protocol headers.
It sends no raw audio, station URL, Couch identity or device token. No location
is supplied; Shazam can see the server's IP address as with any network request.
Couch does not persist the sample or recognition result.

Recognition uses Shazam's **unofficial** protocol and proprietary catalog.
The TypeScript implementation is open source; the matching service is external
and may change, become unavailable or limit requests. There are no automatic
retries. Speech, silence, DJ transitions, live performances and songs outside
the catalog may produce no match. A match is a best effort, not a guarantee.

Because sampling uses a new connection, it may be ahead of buffered playback
on a listening device. The displayed time is when Couch started the excerpt,
after helper preparation, not a promise that the identified song is still
playing. Press the button
again when you want a fresh result.

## Implementation and checks

To try this branch beside an installed Couch, use an isolated data directory
and port from the checkout:

```sh
COUCH_DATA_DIR="$PWD/.data/pr-901" COUCH_PORT=49101 bun run app
```

Choose **This computer**, play a saved public radio station, open its player
and press **Identify song**. Try Cancel, retry, switching stations and leaving
the player. Quit this scratch app when finished; the installed Couch and its
data stay untouched.

The authenticated `POST /api/radio/recognize` endpoint accepts only
`{ "stationId": "<saved station id>" }`. Core resolves the URL from its saved
radio data, rechecks authorization before sending the fingerprint and before
returning the result, and uses its public-media proxy for the sample. Redirects
and HLS child requests pass through that proxy too. Canceling, disconnecting or
shutting down Core aborts active work and releases its decoder/helper resources.

The small fingerprint/signature port follows the MIT-licensed `shazamio-core`,
with source revision and notices in
[vendor/shazam-signature](../vendor/shazam-signature/README.md). FFmpeg owns
audio decoding; the port covers peak extraction and signature encoding only.
It yields during fingerprinting so playback work can continue on Core's event
loop. The provider response is bounded and only supported song metadata is
returned to the UI.

Run the focused checks with the pinned Bun/Node versions:

```sh
bun test tests/shazam-signature.test.ts tests/song-recognition.test.ts
bun build tests/radio-recognition.integration.ts --target=node --outfile=build/radio-recognition.integration.mjs
COUCH_TEST_FFMPEG="$(command -v ffmpeg)" node --test build/radio-recognition.integration.mjs
bun run typecheck
bun run build
```

The integration tests use an isolated stream fixture and real FFmpeg selected
with `COUCH_TEST_FFMPEG`, plus injected recognition responses. Without that
override, the decoder cases explicitly skip. They cover the manual API,
authorization changes, concurrency, cancellation, bounded decoding and rejected
private stream destinations. The browser regression
`tests/radio-recognition.browser.tsx` exercises the actual player route with
deterministic provider replies at desktop, phone and TV sizes. Neither suite
depends on a live Shazam response. Synthetic PCM fixtures check the fingerprint
port without committing recorded music.
