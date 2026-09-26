import { setupUiTests, render, fireEvent } from "@/testing/react";
import { expect, test } from "bun:test";
import { MediaArtwork } from "./MediaArtwork";

setupUiTests();

test("new programme artwork loads after the previous image fails", () => {
  const view = render(<MediaArtwork thumbnail="https://images.example/old.jpg" title="Old show" />);
  fireEvent.error(view.container.querySelector("img")!);
  expect(view.container.querySelector("img")).toBeNull();
  view.rerender(<MediaArtwork thumbnail="https://images.example/new.jpg" title="New show" />);
  expect(view.container.querySelector("img")).toHaveAttribute("src", "https://images.example/new.jpg");
});
