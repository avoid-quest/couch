import { setupUiTests, renderWithQueryClient, screen } from "@/testing/react";
import { expect, spyOn, test } from "bun:test";
import { SettingsSources } from "./SettingsSources";

setupUiTests();

for (const [source, name] of [["metadata", "TMDB metadata settings"], ["streaming-community", "StreamingCommunity settings"]] as const) {
  test(`${source} settings mount without an offline read`, () => {
    const request = spyOn(globalThis, "fetch");
    renderWithQueryClient(<SettingsSources connected={false} credentials={null} canManage={false} source={source} />);
    expect(screen.getByRole("group", { name })).toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
  });
}
