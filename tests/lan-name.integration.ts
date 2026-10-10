import { test } from "node:test";
import assert from "node:assert/strict";
import type { lookup } from "node:dns/promises";
import { lanNames, resolverSearchDomains } from "../src/server/lan-name";
import { createLanListener } from "../src/server/lan-listener";

test("the machine hostname joins the resolver search domain and keeps qualified fallback", () => {
  assert.deepEqual(lanNames("couch", resolverSearchDomains("search avoid.local\nnameserver 192.168.1.1")), ["couch.avoid.local"]);
  assert.deepEqual(lanNames("Couch.avoid.local.", ["avoid.local.", "fallback.home"]), ["couch.avoid.local", "couch.fallback.home"]);
  assert.deepEqual(lanNames("couch", []), []);
  assert.deepEqual(lanNames("couch.home", []), ["couch.home"]);
  assert.deepEqual(lanNames("couch", ["~private", "bad/domain", "", "bad domain", "-bad.local"]), []);
});

test("Linux search parsing follows the last directive and LOCALDOMAIN override", () => {
  assert.deepEqual(resolverSearchDomains("# search ignored\n search first.home second.home # comment\ndomain chosen.home ; comment"), ["chosen.home"]);
  assert.deepEqual(resolverSearchDomains("domain first.home\nsearch avoid.local fallback.home"), ["avoid.local", "fallback.home"]);
  assert.deepEqual(resolverSearchDomains("search old.home", "new.home other.home"), ["new.home", "other.home"]);
  assert.deepEqual(lanNames("couch", resolverSearchDomains("search old.home", "")), []);
});

test("automatic names need exact LAN DNS, recover after DNS repair, and yield to customization", async t => {
  const address = "192.168.1.20", port = 4100;
  const automatic = `http://couch.avoid.local:${port}`, custom = `http://cinema.avoid.local:${port}`;
  let available = false, chosen = "", suggested = "", urls: string[] = [], warning: string | null = null;
  const answers = new Map<string, string[]>([["wrong.home", ["192.168.1.99"]], ["mixed.home", [address, "192.168.1.99"]]]);
  const resolve = (async (name: string) => (answers.get(name) ?? (available ? [address] : [])).map(address => ({ address, family: 4 }))) as typeof lookup;
  const lan = createLanListener({
    port, enabled: true, selected: "eth0", advertised: () => chosen ? [chosen] : [],
    suggested: () => chosen ? [] : ["http://wrong.home:4100", "http://mixed.home:4100", automatic], resolve,
    interfaces: () => ({ eth0: [{ address, family: "IPv4", internal: false, netmask: "255.255.255.0", cidr: `${address}/24`, mac: "00:11:22:33:44:55" }] }),
    start: async () => ({ stop: async () => {} }),
    changed: (next, error, name) => { urls = next; warning = error; suggested = name; },
  });
  t.after(() => lan.close());
  await lan.refresh();
  assert.deepEqual(urls, [`https://${address}:${port}`]); assert.equal(warning, null); assert.equal(suggested, "");
  available = true; await lan.refresh();
  assert.deepEqual(urls, ["https://couch.avoid.local:4100", `https://${address}:${port}`]);
  assert.equal(suggested, "https://couch.avoid.local:4100"); assert.equal(warning, null);
  chosen = custom; await lan.refresh();
  assert.deepEqual(urls, ["https://cinema.avoid.local:4100", `https://${address}:${port}`]); assert.equal(suggested, "");
  chosen = ""; await lan.refresh(); assert.equal(suggested, "https://couch.avoid.local:4100");
  available = false; await lan.refresh();
  assert.deepEqual(urls, [`https://${address}:${port}`]); assert.equal(warning, null);
});
