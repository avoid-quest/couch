import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DurationBar, durationScale } from "./DurationBar";

test("duration bar separates total runtime width from watched progress", () => {
  const markup = renderToStaticMarkup(<DurationBar duration={600} position={120} />);
  expect(markup).toContain('role="progressbar"');
  expect(markup).toContain('aria-valuenow="20"');
  expect(markup).toContain(`width:${durationScale(600) * 100}%`);
  expect(markup).toContain("Resume at 2:00");
});
