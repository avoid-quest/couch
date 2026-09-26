import { setupUiTests, waitFor } from "@/testing/react";
import { expect, test } from "bun:test";
import { dispatchTvRoute } from "./session-context";

setupUiTests();

test("native TV Home closes an open dialog before navigating", async () => {
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("data-state", "open");
  const close = document.createElement("button");
  close.textContent = "Close";
  for (const element of [dialog, close]) element.getClientRects = () => [{ width: 100, height: 40 }] as unknown as DOMRectList;
  dialog.append(close);
  document.body.append(dialog);
  close.focus();
  const events: string[] = [];
  close.addEventListener("keydown", event => { if (event.key === "Escape") { events.push("dismiss"); dialog.remove(); } });
  window.addEventListener("couch-home", () => events.push("home"), { once: true });

  dispatchTvRoute("home");
  expect(events).toEqual(["dismiss"]);
  await waitFor(() => expect(events).toEqual(["dismiss", "home"]));
});
