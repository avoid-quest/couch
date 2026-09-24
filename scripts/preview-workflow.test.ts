import { expect, test } from "bun:test";

const desktop = Bun.YAML.parse(await Bun.file(".github/workflows/package-desktop.yml").text()) as any;
const publisher = Bun.YAML.parse(await Bun.file(".github/workflows/publish-preview.yml").text()) as any;
const steps = (workflow: any) => Object.fromEntries(workflow.jobs[Object.keys(workflow.jobs)[0]].steps.filter((step: any) => step.name).map((step: any) => [step.name, step]));

test("native packages are signed and uploaded only in the release environment", () => {
  const job = desktop.jobs.package, selected = steps(desktop);
  expect(job["runs-on"]).toBe("macos-26");
  expect(job.environment).toBe("couch-release");
  expect(job.if).toContain("github.ref == 'refs/heads/main'");
  expect(job.if).toContain("COUCH_RELEASES_ENABLED == 'true'");
  expect(desktop.on.push).toBeUndefined();
  expect(selected["Check the signed Debian draft and source run"].run).toContain("preview-receipt-source.ts deb");
  expect(selected["Build and verify the native package"].env.TAURI_SIGNING_PRIVATE_KEY).toContain("secrets.TAURI_SIGNING_PRIVATE_KEY");
  expect(selected["Seal the verified native bytes and signed receipts"].env.TAURI_SIGNING_PRIVATE_KEY).toContain("secrets.TAURI_SIGNING_PRIVATE_KEY");
  expect(selected["Upload only the qualified bytes to the Debian Preview draft"].env.CN_API_KEY).toContain("secrets.CN_API_KEY");
  expect(selected["Retain small signed receipts"].with.path).not.toContain("/public/");
  expect(selected["Retain small signed receipts"].with.path).not.toContain("inventory");
  expect(selected["Retain small signed receipts"]["continue-on-error"]).toBe(true);
});

test("publication checks all source runs and assembled assets before publish", () => {
  const job = publisher.jobs.publish, selected = steps(publisher);
  expect(job.environment).toBe("couch-publication");
  expect(job.if).toContain("github.ref == 'refs/heads/main'");
  expect(job.if).toContain("COUCH_RELEASES_ENABLED == 'true'");
  expect(publisher.on.push).toBeUndefined();
  expect(Object.keys(publisher.on.workflow_dispatch.inputs)).toHaveLength(11);
  expect(publisher.jobs.publish.steps[0].with.ref).toContain("inputs.source-revision");
  for (const format of ["deb", "appimage", "dmg", "nsis"]) expect(selected["Restore and check all four signed source runs"].run).toContain(`preview-receipt-source.ts ${format}`);
  const names = job.steps.map((step: any) => step.name);
  expect(names.indexOf("Restore and check all four signed source runs")).toBeLessThan(names.indexOf("Verify the assembled draft or published release"));
  expect(names.indexOf("Verify the assembled draft or published release")).toBeLessThan(names.indexOf("Publish all six qualified Preview assets together"));
  expect(names.indexOf("Publish all six qualified Preview assets together")).toBeLessThan(names.indexOf("Check public downloads, updater feeds and GitHub mirror"));
  expect(selected["Publish all six qualified Preview assets together"].if).toContain("!inputs.readiness-only");
  expect(selected["Retain publication and readiness receipts"].with.path).not.toContain("/public/");
});
