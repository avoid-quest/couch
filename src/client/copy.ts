// Copy that repeats across screens. See docs/design.md "Copy".

/** The TV computer's name, falling back to "Couch". */
export const deviceName = (name?: string | null) => name || "Couch";

/** Couch can't be reached: the whole app's problem, said once in the header (docs/design.md "Problems"). */
export const offline = (name?: string | null) =>
  `Couldn't reach ${deviceName(name)}. Reconnecting…`;

export const ADMIN_ONLY = "Only an admin can change this.";

export const TRY_AGAIN = "Try again";

/** A page that can't show at all. */
export const PAGE_PROBLEM = "Couldn't open this page.";

/** Copy for Saved recovery actions. */
export const savedNotice = (title: string, saved: boolean) =>
  saved ? `Saved ${title}.` : `Removed ${title} from Saved.`;
