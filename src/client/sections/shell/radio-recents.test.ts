import { setupUiTests } from "@/testing/react";
import { expect, test } from "bun:test";
import { radioRecentsKey, readRadioRecents, writeRadioRecents } from "./radio-recents";

setupUiTests();

test("radio recents remain scoped to their installation", () => {
  const old = { id: "old", name: "Old TV", url: "https://old.example", homepage: "", countryCode: "", codec: "MP3", bitrate: 128 };
  const replacement = { id: "new", name: "Replacement TV", url: "https://new.example", homepage: "", countryCode: "", codec: "MP3", bitrate: 128 };
  writeRadioRecents("old-tv", [old]);
  writeRadioRecents("replacement-tv", [replacement]);
  expect(radioRecentsKey("old-tv")).not.toBe(radioRecentsKey("replacement-tv"));
  expect(readRadioRecents("replacement-tv")).toEqual([replacement]);
});
