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

test("RaiPlay queue expansion deduplicates its first episode", async () => {
  const load = createRaiPlayProgrammeLoader(async ({ url }) => {
    if (url === programme) {
      return { title: "Show", items: [episode(0), { id: "season", provider: "raiplay", kind: "collection", title: "Season", url: season }] };
    }
    return { items: [episode(0), episode(1)] };
  });
  expect((await load(programme)).items.map(item => item.id)).toEqual(["episode-0", "episode-1"]);
});
