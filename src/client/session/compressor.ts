import type { CompressorSettings } from "../../shared/compressor";

// Web Audio owns the DSP thread. This graph also works in an OfflineAudioContext for signal checks.
// Keep device gain after the detector; a listener's volume must not change the compression curve.
export function createCompressor(context: BaseAudioContext, settings: CompressorSettings) {
  const input = context.createGain(), compressor = context.createDynamicsCompressor();
  const makeup = context.createGain(), wet = context.createGain(), dry = context.createGain();
  const delay = context.createDelay(0.1), output = context.createGain();
  // DynamicsCompressorNode has fixed 6 ms lookahead. Align bypass during a short crossfade.
  delay.delayTime.value = 0.006;
  let wetConnected = false, dryConnected = false, enabled = settings.enabled;
  let settled: ReturnType<typeof setTimeout> | undefined;
  const connect = (compressed: boolean) => {
    if (compressed && !wetConnected) { input.connect(compressor).connect(makeup).connect(wet).connect(output); wetConnected = true; }
    if (!compressed && !dryConnected) { input.connect(delay).connect(dry).connect(output); dryConnected = true; }
  };
  const disconnect = (compressed: boolean) => {
    if (compressed && wetConnected) { input.disconnect(compressor); compressor.disconnect(); makeup.disconnect(); wet.disconnect(); wetConnected = false; }
    if (!compressed && dryConnected) { input.disconnect(delay); delay.disconnect(); dry.disconnect(); dryConnected = false; }
  };
  const set = (next: CompressorSettings, immediate = false) => {
    const update = (parameter: AudioParam, value: number) => {
      parameter.cancelScheduledValues(context.currentTime);
      if (immediate) parameter.value = value;
      else parameter.setTargetAtTime(value, context.currentTime, 0.01);
    };
    update(compressor.threshold, next.threshold);
    update(compressor.ratio, next.ratio);
    update(compressor.knee, next.knee);
    update(compressor.attack, next.attack / 1000);
    update(compressor.release, next.release / 1000);
    // An explicit output trim; Web Audio's internal automatic makeup is not configurable.
    update(makeup.gain, 10 ** (next.gain / 20));
    connect(next.enabled);
    if (immediate) {
      wet.gain.value = next.enabled ? 1 : 0; dry.gain.value = next.enabled ? 0 : 1;
    } else if (next.enabled !== enabled) {
      clearTimeout(settled);
      // Prime the newly connected 6 ms path before crossfading. A finite ramp lets us
      // disconnect the unused branch completely instead of processing into a zero gain.
      const at = context.currentTime, begin = at + 0.01, end = begin + 0.04;
      for (const [parameter, value] of [[wet.gain, next.enabled ? 1 : 0], [dry.gain, next.enabled ? 0 : 1]] as const) {
        if (parameter.cancelAndHoldAtTime) parameter.cancelAndHoldAtTime(at);
        else { const held = parameter.value; parameter.cancelScheduledValues(at); parameter.setValueAtTime(held, at); }
        parameter.setValueAtTime(parameter.value, begin);
        parameter.linearRampToValueAtTime(value, end);
      }
      const finish = () => {
        if (context.state === "running" && context.currentTime < end) { settled = setTimeout(finish, 20); return; }
        // A paused context cannot finish its ramp. Settle it silently before its next resume.
        for (const [parameter, value] of [[wet.gain, enabled ? 1 : 0], [dry.gain, enabled ? 0 : 1]] as const) {
          parameter.cancelScheduledValues(context.currentTime); parameter.value = value;
        }
        disconnect(!enabled);
      };
      settled = setTimeout(finish, 70);
    }
    enabled = next.enabled;
  };
  set(settings, true);
  return { input, output, set,
    volume(value: number) { output.gain.setTargetAtTime(value, context.currentTime, 0.01); },
    close() { clearTimeout(settled); for (const node of [input, compressor, makeup, wet, dry, delay, output]) node.disconnect(); },
  };
}
