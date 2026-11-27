import { mixcloudOrigin } from "../../../shared/mixcloud";
import { mixcloudMixes } from "../mixcloud";
import { matches, maxList, remembered, searchSize } from "./station";

// Radio Alhara publishes its archive only as Mixcloud uploads (a few hundred). Couch keeps the list for a day and
// matches titles and tags; its mixes are Mixcloud items.
const account = "/RadioAlhara/";
const batch = 100;

const uploads = remembered(24 * 60 * 60_000, async (signal) => {
  const items = [];
  for (let offset = 0; offset < maxList; offset += batch) {
    const page = await mixcloudMixes(
      `${account}cloudcasts/`,
      offset,
      batch,
      { title: "Radio Alhara", url: `${mixcloudOrigin}${account}` },
      signal,
    );
    items.push(...page.items);
    if (!page.more) break;
  }
  return items;
});

export async function searchAlhara(query: string, signal: AbortSignal) {
  return (await uploads(signal))
    .filter((item) => matches(query, `${item.title} ${item.description ?? ""}`))
    .slice(0, searchSize);
}
