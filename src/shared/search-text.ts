/** Text as search compares it: case and accents folded, so "dj ale" finds "DJ Alé". Sources get the text as typed. */
export const fold = (value: string) => value.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

/** A text's folded words, split at anything but letters and digits. */
export const searchWords = (value: string) =>
  fold(value)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
