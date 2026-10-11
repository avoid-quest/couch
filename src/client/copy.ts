// Copy that repeats across screens. See docs/design.md "Copy".

/** The TV computer's name, falling back to "Couch". */
export const deviceName = (name?: string | null) => name || "Couch";

export const offline = (name?: string | null) => `Offline. Reconnecting to ${deviceName(name)}…`;

export const ADMIN_ONLY = "Only an admin can change this.";

export const TRY_AGAIN = "Try again";

/** Copy for Saved recovery actions. */
export const savedNotice = (title: string, saved: boolean) => saved ? `Saved ${title}.` : `Removed ${title} from Saved.`;
