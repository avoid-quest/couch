import { expect, spyOn, test } from "bun:test";
import { browseRaiPlay, createRaiPlayProgrammeLoader } from "../src/server/providers/raiplay";
import type { ProviderItem } from "../src/shared/providers";

const programme = "https://www.raiplay.it/programmi/the-show";
const season = `${programme}/ContentSet-abcd.json`;
const episode = (index: number): ProviderItem => ({ id: `episode-${index}`, provider: "raiplay", kind: "media", title: `Episode ${index}`, url: `https://www.raiplay.it/video/2026/09/episode-${index}.html` });

test("queueing a RaiPlay season reads its full JSON once while browsing retains pages", async () => {
  const items = Array.from({ length: 500 }, (_, index) => ({ name: `Episode ${index}`, weblink: episode(index).url }));
  const request = spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ name: "Season", items }));
  try {
    const browse = await browseRaiPlay({ url: season });
    expect(browse.items).toHaveLength(24);
    expect(browse.nextCursor).toBe("24");
    request.mockClear();
    const result = await createRaiPlayProgrammeLoader()(season);
    expect(result.items).toHaveLength(500);
    expect(result.items[499]?.collection?.index).toBe(499);
    expect(request).toHaveBeenCalledTimes(1);
  } finally { request.mockRestore(); }
});

test("RaiPlay queue expansion rejects a 501st episode even on the final page", async () => {
  const request = spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ name: "Season", items: Array.from({ length: 501 }, (_, index) => ({ name: `Episode ${index}`, weblink: episode(index).url })) }));
  try {
    await expect(createRaiPlayProgrammeLoader()(season)).rejects.toThrow("more than 500 episodes");
    expect(request).toHaveBeenCalledTimes(1);
  } finally { request.mockRestore(); }
});

test("RaiPlay queue expansion follows provider cursors and counts distinct episodes across seasons", async () => {
  const calls: string[] = [];
  const load = createRaiPlayProgrammeLoader(async ({ url, cursor }) => {
    calls.push(`${url}:${cursor ?? ""}`);
    if (url === programme) return { title: "Show", items: [episode(0), ...["abcd", "efab", "abcdabcd"].map(id => ({ id, provider: "raiplay" as const, kind: "collection" as const, title: id, url: `${programme}/ContentSet-${id}.json` }))] };
    if (url === season) return { items: Array.from({ length: 250 }, (_, index) => episode(index + (cursor ? 250 : 0))), ...(!cursor ? { nextCursor: "250" } : {}) };
    return { items: [episode(0), episode(500)] };
  });
  await expect(load(programme)).rejects.toThrow("more than 500 episodes");
  expect(calls).toEqual([`${programme}:`, `${season}:`, `${season}:250`, `${programme}/ContentSet-efab.json:`]);
});

test("RaiPlay queue expansion deduplicates its first episode and stops between seasons on cancellation", async () => {
  const controller = new AbortController();
  let calls = 0, abortAfterProgramme = false;
  const load = createRaiPlayProgrammeLoader(async ({ url }) => {
    calls++;
    if (url === programme) {
      if (abortAfterProgramme) controller.abort();
      return { title: "Show", items: [episode(0), { id: "season", provider: "raiplay", kind: "collection", title: "Season", url: season }] };
    }
    return { items: [episode(0), episode(1)] };
  });
  expect((await load(programme)).items.map(item => item.id)).toEqual(["episode-0", "episode-1"]);
  abortAfterProgramme = true;
  await expect(load(programme, controller.signal)).rejects.toThrow();
  expect(calls).toBe(3);
});
