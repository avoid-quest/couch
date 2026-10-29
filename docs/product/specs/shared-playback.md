# Shared playback

*Choose together, play it where you want.* Maturity: **in preview**.

## Who and when

A household, flatmates or friends on a sofa. One computer is connected to the
TV (or is the TV). Everyone has a phone. Tonight someone wants a video, someone
else a radio station, and the kitchen should hear it too.

## Outcome

Nobody hands round a remote or a login. Anyone can add what they found, the
queue is shared and fair to see, and the picture and sound go where people
want them.

## Journey

1. The admin opens Couch on the computer by the TV and turns on sharing.
2. A friend scans the QR code on screen, accepts the browser's one-time
   certificate warning, names their phone and joins.
3. They search YouTube, open a radio station or paste a link; **Play** starts
   it now, **Queue** adds it to Up next.
4. In **Where it plays** someone adds the kitchen laptop's sound; it plays in
   step with the TV.
5. Later, someone picks up where they left off, or saves a list for next time.

## Requirements

- Joining takes a QR scan or six digits, in the phone's browser, no install.
- Everyone joined to a playback sees its Up next and now-playing state.
- Joined devices can control shared media playback; private outputs retain
  their owner's control. Admin-only
  settings are visible but read-only to others.
- Each device chooses for itself whether others may use its screen or speakers.
- Several playbacks can run at once, each with its own Up next and devices.
- Sound on several devices stays in step for media that supports it, and says
  so when it can't.
- Playback recovers from a dropped device without stopping everyone else.
- A locked phone keeps playing its sound where the browser allows.

## Today and limits

Available in the latest preview. Limits: per-source support varies ([usage
table](../../usage.md#what-plays-where)); Safari, Firefox and iPhone are
unverified; lock-screen playback is confirmed in Chrome on iPad and Android
phones only; the Linux TV layout hasn't run on a real TV; some sources play
only on the Couch computer.

## Scope

In: online video and music, radio, Live TV playlists, shared queue, saved
lists, per-device picture and sound. Out: local files, media servers, accounts,
playback across the internet.

## Open decisions

- Which browsers and phones to verify and name.
- Whether guests should join without an admin present.

## Evidence for stronger claims

- "Works on iPhone": a verified Safari run of join, control and synced sound.
- "Runs on your TV": the Debian TV setup on real TV hardware.
- Any statement about how many devices: a measured group on one Wi-Fi network.
