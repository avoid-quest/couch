import { expect, test } from "bun:test";
import type { BrowserWindow } from "electron";
import { loadCouch } from "../app/navigation";

test("only a successful explicit Couch switch clears history", async () => {
  let entries = ["http://old/", "http://old/saved"];
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const window = {
    loadURL: (url: string) => new Promise<void>((yes, no) => {
      resolve = () => { entries.push(url); yes(); };
      reject = no;
    }),
    webContents: { navigationHistory: { clear: () => { entries = entries.slice(-1); } } },
  } as unknown as BrowserWindow;
  const failed = loadCouch(window, "http://unreachable/", true);
  reject(new Error("Connection failed"));
  await expect(failed).rejects.toThrow("Connection failed");
  expect(entries).toEqual(["http://old/", "http://old/saved"]);
  const switched = loadCouch(window, "http://new/", true);
  expect(entries).toHaveLength(2);
  resolve(); await switched;
  expect(entries).toEqual(["http://new/"]);
  entries.push("http://new/saved");
  const reload = loadCouch(window, "http://new/saved");
  resolve(); await reload;
  expect(entries).toContain("http://new/");
});
