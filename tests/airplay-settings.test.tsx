import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { AirPlaySettings } from "../src/client/sections/settings/sources/AirPlaySettings";
import type { AirPlayState } from "../src/shared/airplay";

const credentials = { origin: "http://127.0.0.1:44340", token: "test" };
const privateState: AirPlayState = {
  enabled: true,
  status: "receiving",
  error: null,
  name: "Linux Couch",
  code: "private-airplay-code",
  sender: "Private sender",
};
function render(client: QueryClient, administrator: boolean) {
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <AirPlaySettings
        availability="available"
        credentials={credentials}
        connected
        administrator={administrator}
        couch="Test Couch"
      />
    </QueryClientProvider>,
  );
}

test("demotion hides cached AirPlay secrets and promotion restores them", () => {
  const client = new QueryClient();
  try {
    client.setQueryData(["airplay"], privateState);
    const admin = render(client, true);
    expect(admin).toContain(privateState.code);
    expect(admin).toContain(privateState.sender!);
    const demoted = render(client, false);
    for (const text of [privateState.code, privateState.sender!])
      expect(demoted).not.toContain(text);
    expect(render(client, true)).toContain(privateState.code);
  } finally {
    client.clear();
  }
});
