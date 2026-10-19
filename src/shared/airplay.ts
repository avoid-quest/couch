// The AirPlay receiver on the computer that runs Couch: off until an admin turns it on.
// unsupported: not this platform; unavailable: this build or computer lacks what it needs.
export type AirPlayStatus = "unsupported" | "unavailable" | "off" | "starting" | "ready" | "receiving" | "error";
export type AirPlayState = {
  enabled: boolean;
  status: AirPlayStatus;
  error: string | null;
  /** The name senders see. */
  name: string;
  /** What a sender enters the first time it plays here. */
  code: string;
  /** Who is playing here, as the sender names itself. */
  sender: string | null;
};
