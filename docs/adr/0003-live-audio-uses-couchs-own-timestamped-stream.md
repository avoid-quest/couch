---
status: superseded
---

# Historical: Live audio used Couch's own timestamped stream

> Superseded on 2026-10-27 by the owner's [upstream Sendspin baseline](../live-audio.md).
> Claims below describe the discarded custom/patched implementations. They are
> neither stock-Sendspin measurements nor requirements for future work.

Live audio has to reach every listener within 100 ms of the input, in sync, on up to about 50 Wi-Fi devices, most of them phone browsers. Sendspin fed by Couch's native capture could not get there. On a wired listener its lowest clean lead was 75 ms, about 77 ms from the input to the listener. At 45 ms it refused listeners. Its browser player handles the socket and the audio scheduling on the page's main thread, so the page's own 25–38 ms stalls set that floor. Two linear-interpolation stages cost it 10–15 dB of signal-to-noise above 2 kHz. A prototype on the same rig, with the same capture and listener, held 31–37 ms. Moving the work off the main thread inside the SDK would mean writing a new transport inside a patch. [Live audio](../live-audio.md) has the measurements.

Core therefore streams Live audio itself. The audio worker turns the native capture into packets of 128-frame PCM or 2.5 ms Opus, each stamped with its capture position and host time. One shared lead per share decides when every listener plays a sample. The lead follows the listeners' measured need, up to an operator maximum (100 ms by default). A listener that needs more keeps playing, behind by what it lacks, instead of being refused. Browsers receive the stream in a Worker and render it in an AudioWorklet. The listener fits its clocks to Core's, picks its interpolator by measuring its cost, and recovers from late audio by holding and then catching up, never by going silent. Only the operator removes a listener.

Sendspin stays for relaxed sharing: Audio input without Live, AirPlay and In sync. The Live admission and the SDK patches it needed go. This supersedes ADR 0002 where that ADR has Live share Sendspin's receiver preparation and fixed-deadline sender.
