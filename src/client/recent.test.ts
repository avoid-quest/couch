import { expect, test } from "bun:test";
import type { HistoryItem } from "../shared/library";
import type { RadioStation } from "../shared/radio";
import { mergeRecent } from "./recent";

const media = (id: string): HistoryItem => ({ mediaId: id, title: id, libraryItemId: null, position: 0, duration: null, watched: false, lastPlayedAt: null });
const station = (id: string): RadioStation => ({ id, name: id, url: `https://${id}.example/stream`, homepage: `https://${id}.example`, countryCode: "", codec: "MP3", bitrate: 128 });

test("recent entries list live stations first, then media, newest source order preserved", () => {
  const entries = mergeRecent([media("clip"), media("film")], [station("lyl"), station("sygma")]);
  expect(entries.map(entry => entry.key)).toEqual(["radio:lyl", "radio:sygma", "clip", "film"]);
  expect(entries[0]).toEqual({ key: "radio:lyl", kind: "radio", station: station("lyl") });
  expect(entries[2].kind === "media" && entries[2].item.title).toBe("clip");
});

test("recent entries drop the excluded media item and tolerate empty sources", () => {
  expect(mergeRecent([media("clip"), media("hero")], [station("sygma")], "hero").map(entry => entry.key)).toEqual(["radio:sygma", "clip"]);
  expect(mergeRecent([], [])).toEqual([]);
});
