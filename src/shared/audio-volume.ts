// Sendspin's perceived-volume curve; Couch's direct renderers use linear gain.
// https://github.com/Sendspin/spec#player-messages
const percent = (value: number) => Math.max(0, Math.min(100, value)) / 100;
export const toSendspinVolume = (volume: number) => Math.round(100 * percent(volume) ** (2 / 3));
export const fromSendspinVolume = (volume: number) => Math.round(100 * percent(volume) ** 1.5);
