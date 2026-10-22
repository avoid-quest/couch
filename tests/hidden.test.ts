import { expect, test } from "bun:test";
import { createHidden } from "../src/server/hidden";
import { ControllerError } from "../src/server/devices";
import { hiddenItemKey, matchesHidden, type HiddenRule } from "../src/shared/hidden";

const request = (path: string, method = "GET", body?: unknown) => new Request(`http://couch.test${path}`, { method, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });

test("Core keeps hidden items and words, once each, until one is removed", async () => {
  let changes = 0;
  const hidden = createHidden({ databasePath: ":memory:", onChange: () => changes++ });
  try {
    const word = await hidden.handle(request("/api/hidden", "POST", { rule: { kind: "word", value: " Fiorello ", label: "Fiorello" } }));
    expect(word.status).toBe(201);
    const { rule } = await word.json() as { rule: HiddenRule };
    expect(rule).toMatchObject({ kind: "word", value: "fiorello", label: "Fiorello" });
    // The same word in another case is the same rule.
    const again = await hidden.handle(request("/api/hidden", "POST", { rule: { kind: "word", value: "FIORELLO", label: "FIORELLO" } }));
    expect(again.status).toBe(200);
    expect((await again.json() as { rule: HiddenRule }).rule.id).toBe(rule.id);
    await hidden.handle(request("/api/hidden", "POST", { rule: { kind: "item", value: "twitch:https://www.twitch.tv/random", label: "Random" } }));
    expect(changes).toBe(2);
    const listed = await (await hidden.handle(request("/api/hidden"))).json() as { rules: HiddenRule[] };
    expect(listed.rules.map(item => item.label).sort()).toEqual(["Fiorello", "Random"]);

    expect((await hidden.handle(request("/api/hidden", "POST", { rule: { kind: "word", value: "  " } }))).status).toBe(400);
    expect((await hidden.handle(request("/api/hidden", "POST", { rule: { kind: "channel", value: "x" } }))).status).toBe(400);

    expect((await hidden.handle(request(`/api/hidden/${rule.id}`, "DELETE"))).status).toBe(200);
    expect(changes).toBe(3);
    expect(((await (await hidden.handle(request("/api/hidden"))).json()) as { rules: HiddenRule[] }).rules.map(item => item.label)).toEqual(["Random"]);
  } finally { hidden.close(); }
});

test("a removed device can't read or change what's hidden", async () => {
  const hidden = createHidden({ databasePath: ":memory:", onChange: () => {} });
  try {
    const removed = () => { throw new ControllerError("This device was removed. Pair again.", 401); };
    expect((await hidden.handle(request("/api/hidden"), removed)).status).toBe(401);
    expect((await hidden.handle(request("/api/hidden", "POST", { rule: { kind: "word", value: "x" } }), removed)).status).toBe(401);
  } finally { hidden.close(); }
});

test("an item rule hides that item; a word hides any title, subtitle, creator or collection mentioning it", () => {
  const rule = (kind: HiddenRule["kind"], value: string): HiddenRule => ({ id: value, kind, value, label: value, createdAt: 0 });
  const item = { provider: "raiplay", url: "https://www.raiplay.it/programmi/viva", title: "Viva Rai2", subtitle: "Puntata 3", creator: { title: "Rai 2", url: "" }, collection: { title: "Season 1", url: "", parent: { title: "Viva Fiorello", url: "" } } };
  expect(matchesHidden([], item)).toBe(false);
  expect(matchesHidden([rule("item", hiddenItemKey(item))], item)).toBe(true);
  expect(matchesHidden([rule("item", "twitch:https://www.raiplay.it/programmi/viva")], item)).toBe(false);
  expect(matchesHidden([rule("word", "fiorello")], item)).toBe(true);
  expect(matchesHidden([rule("word", "puntata")], item)).toBe(true);
  expect(matchesHidden([rule("word", "rai 2")], item)).toBe(true);
  expect(matchesHidden([rule("word", "sanremo")], item)).toBe(false);
});

test("a word rule matches the same on a device in any locale", async () => {
  // A Turkish device lowercases "I" to "ı"; Core and every client compare words without the locale.
  const real = String.prototype.toLocaleLowerCase;
  String.prototype.toLocaleLowerCase = function (this: string) { return real.call(this, "tr"); };
  const hidden = createHidden({ databasePath: ":memory:", onChange: () => {} });
  try {
    const { rule } = await (await hidden.handle(request("/api/hidden", "POST", { rule: { kind: "word", value: "I", label: "I" } }))).json() as { rule: HiddenRule };
    expect(rule.value).toBe("i");
    expect(matchesHidden([rule], { provider: "youtube", url: "https://youtu.be/x", title: "Istanbul" })).toBe(true);
  } finally { String.prototype.toLocaleLowerCase = real; hidden.close(); }
});
