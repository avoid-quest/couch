# Website

couch.avoid.quest has three pages: a one-screen home, About for the story, and
Download. The copy lives in `apps/web/src/pages/`; this page
explains its order and what a later visual pass should do.

## Structure

The home page is one screen and stays wordless: the `couch.avoid.quest`
wordmark in the app's display face (Mona Sans), with the sofa that dodges the
pointer and leads to the download. Hovering the wordmark, or tapping it on a
phone, reveals one line: "Avoid the couch. About Couch". The name read as a
sentence, while the sofa avoids you; it explains nothing, About does. The line
lingers long enough to reach its link, past a sofa that still dodges.

**About** (`/about`) tells the story, in the download page's layout:

1. The headline (a placeholder until [chosen](positioning.md#the-headline-is-open))
   and one paragraph: run it on one computer, join by QR, choose, play, share.
   One button: Download the preview.
2. **Three ways to join in.** Choose together, Play it where you want, Share
   what you're playing. One scene each, no feature lists.
3. **Get started.** Three steps matching the app's first run; free, open
   source and in preview.
4. **Live sound, Coming soon.** The concert scene, how far Couch is today, and
   a link to the plan. Last, labelled, so it can't be mistaken for a feature.
5. **Footer.** Download, GitHub, What plays where, How sharing works, A project
   of avoid.quest.

**Download** links back to About from its footer. Each channel lists separate
Mac (Apple Silicon, macOS 14+) and Mac (Intel, macOS 15+) downloads when its
release contains those installers. Both include the first-open command.
The user chooses the CPU explicitly; a Mac user agent does not identify it.
The fallback catalog lists only published files, so it gains Intel only after
the first Intel release.

Precise capabilities and limits live in the repository's docs, one click away;
the site never lists sources exhaustively or names protocols.

## Brief for a later visual pass

Not part of this edition; for whoever redesigns the page.

- **Hierarchy.** The sofa is the only spectacle. About is calm type on black,
  as the app's design system: flat, no cards or panels.
- **Imagery.** Each of the three scenes earns one picture, shot or drawn as a
  scene seen from the couch: a TV and phones in hands; a laptop sharing a game
  to the TV; for live sound, a crowd's phones and headphones in low light. Real
  places, not device mockups or UI screenshots, which date quickly.
- **Colour.** Borrow the app's [room](../design.md#room): each scene's picture
  tints the dark around it. No other accent.
- **Interaction.** One idea at most, and it should demonstrate joining in: for
  example, a QR code that, scanned, makes the visitor's phone play a short
  sound in step with the page. Only if it works reliably; otherwise none.
- **Live sound section.** Labelled "Coming soon" (owner's choice), and set as
  a horizon, not a feature.
- **Social image.** See [metadata](metadata.md).
