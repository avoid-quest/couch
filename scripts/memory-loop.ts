// Memory feedback loop for the Couch client UI (manual, not part of bun test).
// Usage: bun scripts/memory-loop.ts --url http://127.0.0.1:4100 --code 505366 --minutes 10 [--out /tmp/mem-loop.jsonl]
// Pairs like a browser remote, drives SPA navigation cycles, samples heap/DOM/listeners via CDP.
import { parseArgs } from "node:util";
import { createWriteStream } from "node:fs";
import { chromium } from "playwright";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://127.0.0.1:4100" },
    code: { type: "string", default: "" },
    minutes: { type: "string", default: "10" },
    interval: { type: "string", default: "10000" },
    out: { type: "string", default: "/tmp/couch-mem-loop.jsonl" },
  },
});
const minutes = Number(values.minutes), interval = Number(values.interval);
const samples: { t: number; heap: number; nodes: number; listeners: number; documents: number }[] = [];
const stream = createWriteStream(values.out, { flags: "a" });

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("pageerror", error => console.error(`[pageerror] ${error.message}`));
await page.goto(values.url, { waitUntil: "networkidle" });

const pairInput = page.getByLabel("Pairing code");
if (await pairInput.isVisible().catch(() => false)) {
  if (!values.code) throw new Error("Pairing required; pass --code <6 digits>");
  await pairInput.fill(values.code);
  await page.locator("#remote-name").fill("memory-loop");
  await page.getByRole("button", { name: "Connect" }).click();
  console.log("paired");
}
await page.locator("nav a[data-source]").first().waitFor({ timeout: 15_000 });

const sections = ["Now", "Find", "Saved", "Now"];
const deadline = Date.now() + minutes * 60_000;
let cycle = 0;
const cdp = await page.context().newCDPSession(page);
await cdp.send("Performance.enable");
while (Date.now() < deadline) {
  for (const name of sections) {
    await page.locator(`nav a[data-source="${name}"]`).click();
    await page.waitForTimeout(250);
  }
  const { metrics } = await cdp.send("Performance.getMetrics");
  const pick = (name: string) => Math.round(metrics.find(metric => metric.name === name)?.value ?? 0);
  const sample = {
    t: Date.now(),
    heap: pick("JSHeapUsedSize"),
    nodes: pick("Nodes"),
    listeners: pick("JSEventListeners"),
    documents: pick("Documents"),
  };
  samples.push(sample);
  stream.write(`${JSON.stringify(sample)}\n`);
  console.log(`${new Date(sample.t).toISOString().slice(11, 19)} heap=${(sample.heap / 1e6).toFixed(1)}MB nodes=${sample.nodes} listeners=${sample.listeners} documents=${sample.documents}`);
  cycle += 1;
  await page.waitForTimeout(Math.max(0, interval - sections.length * 250));
}

// Judge by the linear slope over the back half: one-time warm-up allocation
// (caches, artwork) is not a leak; only sustained drift is.
const warm = samples.filter(sample => sample.t >= samples[0]!.t + 120_000);
const half = Math.max(1, Math.floor(warm.length / 2));
const late = warm.slice(-half);
const slopePerHour = (key: "heap" | "nodes" | "listeners", data: typeof warm) => {
  const n = data.length;
  if (n < 2) return 0;
  const meanT = data.reduce((sum, sample) => sum + sample.t, 0) / n;
  const meanV = data.reduce((sum, sample) => sum + sample[key], 0) / n;
  const num = data.reduce((sum, sample) => sum + (sample.t - meanT) * (sample[key] - meanV), 0);
  const den = data.reduce((sum, sample) => sum + (sample.t - meanT) ** 2, 0);
  return den ? (num / den) * 3_600_000 : 0;
};
const heapGrowth = slopePerHour("heap", late), nodeGrowth = slopePerHour("nodes", late), listenerGrowth = slopePerHour("listeners", late);
console.log(`\ncycles=${cycle} samples=${samples.length} (warm=${warm.length})`);
console.log(`late-half slope/hour: heap=${(heapGrowth / 1e6).toFixed(2)}MB nodes=${nodeGrowth.toFixed(0)} listeners=${listenerGrowth.toFixed(0)}`);
const red = warm.length >= 6 && (heapGrowth > 5e6 || nodeGrowth > 500 || listenerGrowth > 1000);
console.log(red ? "RED: client accumulates memory/DOM/listeners" : "GREEN: no sustained client accumulation detected");
stream.end();
await browser.close();
process.exit(red ? 1 : 0);
