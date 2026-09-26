import { setupUiTests, screen, within, renderWithQueryClient, userEvent } from "@/testing/react";
import { expect, test } from "bun:test";
import type { SessionState } from "../../../shared/protocol";
import { QueuePanel } from "./QueuePanel";

setupUiTests();

const queue = ["Played", "Current", "Next", "Last"].map((title, index) => ({ id: title, title, source: `https://media.example/${title}`, duration: (index + 1) * 60 }));
const state: SessionState = { queue, currentEntryId: "Current", queueCursorEntryId: "Current", activeProfile: { id: "household", name: "Household" }, player: { playbackId: "playing", status: "playing", position: 5, duration: 120, volume: 80, seekable: true, error: null } };
const panel = (value: SessionState) => <QueuePanel state={value} credentials={{ origin: "http://localhost", token: "paired" }} connected available nativeHost={false} defaultQuality="best" run={async () => true} />;
const titles = (name: string) => within(screen.getByRole("list", { name })).getAllByRole("button", { name: /^Play / }).map(button => button.getAttribute("aria-label"));

test("the queue separates upcoming and played items and estimates its finish", async () => {
  renderWithQueryClient(panel(state));
  expect(titles("Up next")).toEqual(["Play Next", "Play Last"]);
  expect(screen.queryByRole("list", { name: "Played" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Played" }));
  expect(titles("Played")).toEqual(["Play Played"]);
  expect(screen.getByRole("heading", { name: /^2 to play · done by/ })).toBeInTheDocument();
});

test("unknown or live lengths suppress uncertain start and finish times", () => {
  const view = renderWithQueryClient(panel({ ...state, queue: [queue[0]!, queue[1]!, { ...queue[2]!, duration: undefined }, queue[3]!] }));
  expect(screen.getByRole("heading", { name: "2 to play" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Play Next" })).toHaveTextContent(/starts /);
  expect(screen.getByRole("button", { name: "Play Last" })).not.toHaveTextContent(/starts /);
  view.rerender(panel({ ...state, queue: [queue[0]!, { ...queue[1]!, live: true }, queue[2]!, queue[3]!] }));
  expect(screen.getByRole("list", { name: "Up next" })).not.toHaveTextContent(/starts /);
  expect(screen.getByRole("heading", { name: "2 to play" })).toBeInTheDocument();
});

test("a stopped queue honors its cursor and an exhausted queue offers an empty state", async () => {
  const view = renderWithQueryClient(panel({ ...state, currentEntryId: null }));
  await userEvent.click(screen.getByRole("button", { name: "Played" }));
  expect(titles("Played")).toEqual(["Play Current", "Play Played"]);
  expect(titles("Up next")).toEqual(["Play Next", "Play Last"]);
  view.rerender(panel({ ...state, currentEntryId: null, queueCursorEntryId: "Last" }));
  expect(screen.queryByRole("list", { name: "Up next" })).not.toBeInTheDocument();
  expect(screen.getByText("Nothing queued")).toBeInTheDocument();
});
