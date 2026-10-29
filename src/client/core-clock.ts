// Core's wall clock, from the time it sends each connection, so elapsed Live times don't
// depend on this device's own clock.
let offset = 0;
export const setCoreTime = (now: number) => { offset = now - Date.now(); };
export const coreNow = () => Date.now() + offset;
