# Voice and words

For anyone writing about Couch: the website, README, release notes, docs and
the app's own copy. The app's interface rules live in
[design → Copy](../design.md#copy); this page is for explaining Couch.

## Voice

Couch talks like the friend who set up the TV: plain, warm, a little dry, and
specific. It describes what people do, not what the software is.

- **Scenes before features.** "The kitchen laptop plays the sound" beats
  "multi-device audio output".
- **Verbs people use.** Join, choose, play, queue, share, hear. Not leverage,
  seamless, empower, experience, solution, unlock.
- **Ambitious, then exact.** Say what we're building in a concrete scene, then
  say how far along it is. Never let a superlative do the work of a scene.
- **One joke at most**, and never at the reader's expense. The site's sofa that
  runs from the pointer is the joke; the copy doesn't need another.
- **Sentence case**, short sentences, commas not middle dots.

## The three ideas

Keep these apart everywhere. Mixing them is the most common way to overclaim.

| Say | Means | Don't say |
| --- | --- | --- |
| **choose together** | Shared control: anyone paired can search, queue and steer | "remote app" as the whole story |
| **share** / **share live** | A device sends its screen or sound; each receiver plays it as soon as it arrives | "stream", "cast", "mirror" |
| **in sync** | Several devices play the same sound at the same moment | "perfect sync", "zero latency", "real-time" |
| **close to live** | Little delay between the source and what you hear | any number, until one is measured and published |
| **live sound** | The direction: an audio input heard on everyone's devices, close to live and in sync | "concert-ready", "PA", "monitoring" |

## Words

| Use | For | Avoid |
| --- | --- | --- |
| **everyone**, **people who are there** | Who Couch is for | "room" as the product's frame (fine for a literal room: "the kitchen") |
| **Couch** | The product, and one host with its joined devices ("your Couch", "another Couch") | "the server", "the instance" |
| **couch.avoid.quest** | The website and wordmark | — |
| **avoid.quest** | The larger project Couch belongs to ("a project of avoid.quest"); the name explains itself | "parent company", "brand" |
| **free and open source** | Couch's licence stance; forks and contributions welcome | "freemium", "community edition" |
| **film, series and anime catalogues** | The catalogue sources, by category | their site names in public copy |
| **the Couch computer** | The computer that runs Couch for everyone (the app's **This computer**) | "host", "server", "Core" in public copy |
| **join** | Pairing a phone or laptop, by QR code or six-digit code | "connect a client", "register" |
| **device** | Anything joined: phone, laptop, tablet, TV | "client", "node", "endpoint" |
| **screen**, **speaker** | What a device lends when it plays | "output", "sink", "renderer" |
| **Where it plays** | Choosing each device's picture and sound | "routing", "mixer" (in public copy) |
| **Up next** (list), **Queue** (verb) | What's coming | "playlist" for the shared queue |
| **admin** | The one who looks after a Couch | "owner", "root" |
| **preview** | Every current download | "beta", "stable", "release" |

Protocols, codecs, clocks and buffer sizes belong in the docs a curious reader
reaches second (architecture, live-inputs, specs), never in a headline. Say
"fast" or "a few seconds behind"; link to how.

## Checks before publishing

1. Does every capability sentence have a row in [claims](claims.md)?
2. Is anything not yet in a preview labelled as where Couch is going?
3. Would someone who has never heard of Couch know it's a media player after
   the first sentence?
4. Could a sound engineer read the live sound copy without wincing?
