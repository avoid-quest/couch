import { expect, test } from "bun:test";
import { languageName, playbackLanguages } from "./playback-languages";

test("language choices show names and preserve existing two- and three-letter saved values", () => {
  for (const code of ["en", "eng", "it", "ita", "fre", "fra"]) {
    const name = languageName(code);
    expect(name).not.toBe(code);
    expect(playbackLanguages(code).filter(option => option.name === name)).toEqual([{ code, name }]);
  }
  expect(playbackLanguages("")[0]).toEqual({ code: "", name: "Automatic" });
  expect(playbackLanguages("zzz")).toContainEqual({ code: "zzz", name: "Language zzz" });
});
