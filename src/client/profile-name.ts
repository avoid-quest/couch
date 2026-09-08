import type { WatchingProfile } from "../shared/library";

// The legacy default anchors existing history; it is not a person's name.
export function personalProfileName(profile: WatchingProfile | null | undefined) {
  return profile && !(profile.id === "household" && profile.name === "Household") ? profile.name : null;
}

export function profileDisplayName(profile: WatchingProfile | null | undefined) {
  return personalProfileName(profile) ?? "Your profile";
}
