# Live sound

*The show in everyone's ears.* Maturity: **experimental, not in any
release.** This is Couch's long-term centre.

## Who and when

A concert or gathering (other scenes are
[suggestions](../vision.md#suggested-not-decided)). The sound desk has a stereo mix. A laptop running Couch sits next to it
with a sound card. The audience have phones; some have headphones, some would
rather put a phone on the table as a speaker.

Two listening situations, with different needs:

- **Personal listening.** Headphones, each person alone. Being in step with
  others matters less than being close to what's happening on stage and
  sounding good.
- **Shared speakers.** Phones, laptops or speakers playing out loud in the same
  space. Being in step matters a lot: people hear each other's devices, and
  devices a moment apart sound like an echo.

## Outcome

Someone walks in, joins the Wi-Fi, scans a code and is listening within
moments. What they hear is close to live, in step with the devices around them,
clean, and keeps going; a dropped connection comes back to the present, not to
a backlog.

## Journey

1. The organiser plugs the mix into the sound card, opens Couch and chooses the
   input. They check the level.
2. A QR code is shown at the door or on a screen. Guests scan it, name their
   phone and tap to listen.
3. A guest turns their phone's sound up and puts it on the table; another
   plugs in headphones.
4. Someone's phone locks, or walks out of Wi-Fi range and back; it rejoins the
   present moment.
5. The organiser sees who's listening and whether anyone is falling behind.

## Requirements

What the product must do to earn the promise, independent of how:

- **Close to live.** Delay from input to ear as low as the devices allow while
  staying steady; never drift further behind over a long set.
- **In step.** Devices playing out loud near each other sound like one source,
  not an echo.
- **Good sound.** Stereo kept as stereo; no clipping, needless compression or
  hidden gaps. Fidelity is not traded for speed silently.
- **Continuous.** Hours, not minutes, without growing delay or dropouts.
- **Recovers sensibly.** After an interruption, rejoin the present rather than
  replay the past; tell the listener when it couldn't.
- **Simple to join**, with no install and no account, and with honest messages
  when a phone or browser can't keep up.
- **Defaults first.** Expert controls for buffer and delay come later, show
  what each costs, and offer only what the device actually honours.

## Today and limits

- **In preview:** a sound card's input can already be shared from the Couch
  computer as an audio input, to other devices. A known defect stops a
  speaker-only device from joining that playback once it's running. Each device plays it as
  soon as it arrives (fast, not in step), or with **In sync** together, a few
  seconds behind. Neither is live sound.
- **In the lab:** one stereo input delivered directly to one wired laptop has
  worked in short, controlled runs, far faster than the in-sync path. It is not
  in any build, and isn't yet qualified for long sets, Wi-Fi, several
  listeners, recovery or sound quality.
- **Being worked on:** keeping the input's clock and the listeners' clocks
  steady over a long set.

Do not publish lab numbers; they are test settings, not targets.

## Scope

In, first: one stereo input on the Couch computer; listeners on the same local
network; phones, laptops, headphones and speakers they bring.

Later: several sound cards, more channels, input selection and routing,
expert audio settings.

Out: performer or stage monitoring; phase-coherent speaker arrays; matching
Bluetooth's own delay on every device; unlimited audiences; listening across
the internet.

## Open decisions

- The delay and in-step budgets for personal and shared-speaker listening,
  per named device profile.
- Whether headphone listeners should trade being in step for lower delay.
- Whether Bluetooth outputs join shared-speaker mode, or only personal.
- How the organiser chooses the input and sees listener health.
- Whether a native receiver is needed where browsers can't meet the budget.

## Evidence for stronger claims

| To say | Need |
| --- | --- |
| "Live sound, in preview" | The direct path in a preview build, with a stable clock over a full set on the lab rig |
| "In step across phones" | Two or more physical receivers measured in step over Wi-Fi |
| "Close to live" | Measured input-to-ear delay on named devices, stable over time |
| "Good sound" | Continuity and fidelity checks that catch gaps and repeats |
| "For gigs", any audience size | A measured group of that size on a realistic network |
