# Identify a song on radio

In a radio station's player, **Identify song** takes a short excerpt and looks
it up. Recognition runs only when someone presses the button. A match links to
Couch Search (YouTube, Bandcamp, SoundCloud) with its artist and title.
Completed lookups, no-matches included, are saved under **Saved → Identified
songs** with station, programme and requester as they were at the time.

## How it works

- `POST /api/radio/recognize` takes only `{ "stationId" }`. Core resolves the
  stream from its saved radio data, so only saved public HTTP(S) streams work;
  private-network streams and stations needing headers or sign-in can't be
  sampled. Core supplies requester and station metadata; the client can't.
- Core opens its own connection to the station through its public-media proxy,
  decodes up to 12 s of mono 16 kHz PCM with FFmpeg, and fingerprints it in
  memory. It sends Shazam the fingerprint, its duration and a timestamp, no
  audio, station URL or Couch identity; Shazam still sees Core's IP address. One identification runs at a time per Couch, with a 45 s
  deadline (20 s for the service).
- The fingerprint port follows MIT-licensed `shazamio-core`
  ([vendor/shazam-signature](../vendor/shazam-signature/README.md)); `fft.js`
  provides the transform.
- Shazam's protocol is **unofficial**: it may change, fail or limit requests.
  There are no automatic retries.
- The sample uses a new connection, so it can be ahead of what a listener hears.

`tests/radio-recognition.integration.ts` uses a stream fixture, real FFmpeg
(`COUCH_TEST_FFMPEG`) and injected recognition responses; nothing depends on a
live Shazam reply.
