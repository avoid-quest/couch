import type { WatchingProfile } from "../shared/library";

// Keep stored labels intact without treating them as a person or device identity.
export function storedProfileName(profile: WatchingProfile | null | undefined) {
  return profile && !(profile.id === "household" && profile.name === "Household") ? profile.name : null;
}

export function profileDisplayName(profile: WatchingProfile | null | undefined) {
  return storedProfileName(profile) ?? "Default profile";
}

// Legacy labels do not establish a person's identity. Only the explicit name form does.
export function personDisplayName(profile: WatchingProfile | null | undefined) {
  return profile?.personName || "Your name";
}
