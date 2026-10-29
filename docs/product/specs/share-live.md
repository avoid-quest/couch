# Share live

*Send what you're playing to the screens around you.* Maturity: **in
preview**.

## Who and when

Someone is playing a game, demoing something, or showing a video from their own
laptop. Friends want to watch on the TV, or on their own laptops nearby. The player needs to keep playing on their own machine.

## Outcome

The others see and hear it with little delay, picture and sound together, and
the person sharing stays in control of what's shared and when it stops.

## Journey

1. On their laptop, the player presses **Share**, picks the game's screen or
   window, keeps **Include this computer's sound** on, and chooses the TV
   under **Play on**.
2. Their system asks for capture permission; they allow it.
3. The TV shows the game; a friend adds their own laptop in **Where it plays**.
4. The header shows who's watching. **Stop sharing** ends it everywhere.

## Requirements

- Low delay matters more than devices matching each other: each viewer plays
  as soon as the picture arrives.
- Picture and sound stay together on each viewer.
- The sharer never hears or sees their own share echoed back.
- Only the sharing device starts, changes or stops its capture; others can
  only choose to watch.
- If a viewer can't connect directly, it still gets the share, later, and is
  marked as behind; the others are unaffected.
- Permissions and failures are explained in Couch's words.

## Today and limits

In published preview.5: screen, window, this computer's sound,
microphone or audio input; picture up to 1080p30 by default. Current main adds
independent resolution and 30/60/120 FPS targets, with 60 as the default.
These are requested ceilings, not measured delivery rates; see the
[video measurements](../../video-performance.md) and
[current audit](../../release-audit-2026-10-29.md). Limits: system
sound needs macOS 14.2+ or Windows, not Linux; it's the whole computer's mix,
not one app's; the sharer's upload grows with each viewer; viewers aren't
aligned with each other. A viewer that can't connect directly plays a few
seconds behind until sharing restarts. **In sync** aligns viewers at the cost of
a few seconds. Current-main integration coverage verifies adding a speaker-only
viewer to a running relaxed microphone share without requesting its private
screen; physical capture and phone/browser qualification remain separate.

## Scope

In: one device sharing to others on the same network. Out: sharing across the
internet, recording, remote control of the shared game, guaranteed latency.

## Open decisions

- Whether many viewers justify a forwarding relay (only once measured).
- How to describe delay to users without numbers.

## Evidence for stronger claims

- "Fast enough for games": measured capture-to-screen delay on named devices.
- "Lip sync": audio/picture alignment measured on each viewer.
- Viewer counts: publisher load measured at that count.
