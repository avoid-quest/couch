# Descriptions and metadata

One line everywhere a short description appears, so Couch reads the same in a
search result, an app store listing, a link preview and the repository.

**Short:** A media player everyone shares. *(Placeholder: the headline is still open; see [positioning](positioning.md#the-headline-is-open).)*

**Long (≤ 160 characters):** Run Couch on one computer. Phones and laptops join
with a QR code to choose what plays, play it, or share their own screen and
sound.

## In this repository

| Where | Text |
| --- | --- |
| `package.json` `description`, Linux `synopsis` | Short |
| PWA manifest (`vite.config.ts`) | Short |
| Home `<title>` | couch.avoid.quest (unchanged) |
| About page `<title>` | About Couch |
| Home hover/tap line | Avoid the couch. About Couch |
| Website description, `og:description` | Long |
| Download page `<title>` / description | Download Couch / Download Couch for Mac, Windows and Linux. (unchanged) |
| README first line | Short |

## Outside the repository (proposed, not applied)

**GitHub description**, replacing "The living-room player for avoid.quest.":

> A free, open-source media player everyone shares. Phones and laptops join with a QR code to choose, play and share. A project of avoid.quest.

**GitHub website:** `https://couch.avoid.quest` (unchanged).

**GitHub topics:** `media-player`, `shared-playback`, `synchronized-audio`,
`multiroom-audio`, `screen-sharing`, `living-room`, `home-theater`, `radio`,
`iptv`, `yt-dlp`, `electron`, `self-hosted`, `open-source`.

Apply the description and `open-source` once the MIT `LICENSE` is on main.
Leave out `concert` and `low-latency` until live sound ships.

**Social preview image** (GitHub repository and `og:image`; 1280×640): the
site's hero, the `couch.avoid.quest` wordmark with the sofa across it, on
black, with the headline, once chosen, small beneath. No product
screenshot: the UI changes too often. Until it exists, the site sends no
`og:image`.

**Release notes:** PR titles stay plain sentences (docs/ci.md). Use the words
in [voice](voice.md): "Play in sync", "Share", "Where it plays".
