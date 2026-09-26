import { setupUiTests, render, screen } from "../testing/react";
import { expect, test } from "bun:test";
import { DurationBar } from "./DurationBar";

setupUiTests();

test("duration bar reports watched progress and remaining playback time", () => {
  render(<DurationBar duration={600} position={120} />);
  expect(screen.getByRole("progressbar", { name: /Resume at 2:00 · 8:00 left · ends/ })).toHaveAttribute("aria-valuenow", "20");
});

test("unknown film and track runtimes stay blank while explicitly live media keeps its label", () => {
  render(<><DurationBar /><DurationBar duration={null} /><DurationBar live /><DurationBar collection /></>);
  expect(screen.getAllByText("Live")).toHaveLength(1);
  expect(screen.getByText("Channel")).toBeInTheDocument();
  expect(screen.queryByRole("progressbar")).toBeNull();
});
