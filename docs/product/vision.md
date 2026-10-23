# Couch: vision

Couch is a free, open-source media player that everyone around it shares,
and one of the projects of [avoid.quest](https://avoid.quest). One computer runs
it; phones, laptops and TVs join with a QR code; together they choose what
plays and which devices play it.

The idea underneath: **whoever's here can join in, with what they already
have.** A device that joins a Couch can do three things: choose what plays,
play it (as a screen, a speaker or both), and share its own screen or sound.
Every experience Couch offers is a combination of those three, at a different
scale and with a different demand on time.

## Three experiences, one grammar

| | Living room | Game night | The gig |
| --- | --- | --- | --- |
| Who chooses | Everyone on the couch | The player | The sound desk |
| What plays where | The TV, the kitchen laptop, a phone | The player's screen on the TV and on friends' laptops | Everyone's phones and headphones |
| What matters | Easy, shared, reliable | Fast, picture and sound together | Close to live, in step, good sound, keeps going |
| Spec | [Shared playback](specs/shared-playback.md) | [Share live](specs/share-live.md) | [Live sound](specs/live-sound.md) |
| Today | In preview | In preview | Experimental |

The scenes differ mostly in how they treat time:

- **Shared playback** can buffer freely: the media is known ahead, so devices
  can be held in sync without anyone noticing a delay.
- **Share live** must be fast. Each viewer plays as soon as the picture
  arrives; two viewers a moment apart is fine, sound slipping off the picture
  isn't.
- **Live sound** must be close to live *and* in step across devices, because
  people hear each other's phones and the room itself. That's the hard one,
  and the one Couch is built toward.

## Where it's going

**Live sound is the long-term centre**, not a casting feature. A mixer or
other stereo source plugs into a sound card on the Couch computer. People join
the local Wi-Fi, scan a code, and hear the show on their own phones,
headphones, laptops or speakers: close to live, in step with each other,
sounding good, and coming back quickly if Wi-Fi drops.

The path, in order, without dates:

1. One stereo input, delivered directly to listening devices, stable for a
   whole set. *(Lab work under way.)*
2. Two or more listening devices measured in step, then over Wi-Fi.
3. Live sound as a choice in Couch, with sensible defaults.
4. Expert audio settings, modelled on what music software does well:
   understandable defaults, then real controls for buffer and delay, showing
   what each one costs.
5. More inputs, more channels, choosing and routing them.

The same work should make shared screens playable in step, not only fast.

## Suggested, not decided

Scenes the same grammar would fit. They are proposals for discussion, not
product intent:

- **Music through the house:** one radio station in step in every room, from
  the devices already there. Mostly possible today.
- **Talks and lectures:** a speaker's microphone in the headphones of people
  who need it louder or closer, an accessibility case for live sound.
- **Silent disco or listening party:** live sound with headphones only, where
  being close to live matters more than being in step.
- **Interpretation:** several inputs as language channels, once Couch has
  more than one input.

## What Couch is not

- **Not a stage monitor.** Performers need lower, guaranteed delay than
  phones on Wi-Fi can give.
- **Not a speaker array.** Devices in step are not phase-aligned speakers;
  Couch doesn't promise a coherent field from scattered phones.
- **Not a cloud service.** It runs on your own network; nobody needs an
  account.
- **Not a library manager.** Local files and media servers were removed;
  Couch plays the internet, radio, TV playlists and live sources.

## How we'll know

A claim moves from this page to the website only when [claims](claims.md) has
evidence for it at the scale the copy implies. Each spec lists the evidence
its experience needs before Couch says more about it.
