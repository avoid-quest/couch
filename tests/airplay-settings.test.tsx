import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { AirPlaySettings } from "../src/client/sections/settings/sources/AirPlaySettings";
import type { AirPlayAvailability, AirPlayState } from "../src/shared/airplay";

const credentials = { origin: "http://127.0.0.1:44340", token: "test" };
const privateState: AirPlayState = { enabled: true, status: "receiving", error: null, name: "Linux Couch", code: "private-airplay-code", sender: "Private sender" };
function render(client: QueryClient, availability: AirPlayAvailability | undefined, administrator: boolean, connected = true) {
  return renderToStaticMarkup(<QueryClientProvider client={client}>
    <AirPlaySettings availability={availability} credentials={credentials} connected={connected} administrator={administrator} couch="Test Couch" />
  </QueryClientProvider>);
}

test("AirPlay stays hidden on unsupported hosts and before discovery, for every role and connection state", () => {
  const client = new QueryClient();
  try {
    // Even a previously populated admin cache must not override the host's capability.
    client.setQueryData(["airplay"], privateState);
    for (const availability of [undefined, "unsupported"] as const)
      for (const administrator of [true, false])
        for (const connected of [true, false]) expect(render(client, availability, administrator, connected)).toBe("");
  } finally { client.clear(); }
});

test("Linux controllers see availability without mounting a privileged settings query", () => {
  const client = new QueryClient();
  try {
    for (const connected of [true, false]) {
      const available = render(client, "available", false, connected);
      expect(available).toContain("Receive AirPlay");
      expect(available).toContain("Only an admin can change this.");
      const unavailable = render(client, "unavailable", false, connected);
      expect(unavailable).toContain("The AirPlay receiver isn&#x27;t available on this Couch.");
      expect(unavailable).not.toContain("Receive AirPlay");
      expect(unavailable).not.toContain("Play sound from");
      expect(client.getQueryCache().getAll()).toHaveLength(0);
    }
  } finally { client.clear(); }
});

test("demotion hides cached AirPlay secrets, promotion restores admin controls, and disconnect disables them", () => {
  const client = new QueryClient();
  try {
    client.setQueryData(["airplay"], privateState);
    const admin = render(client, "available", true);
    expect(admin).toContain(privateState.code);
    expect(admin).toContain(privateState.sender!);
    const demoted = render(client, "available", false);
    for (const text of [privateState.code, privateState.sender!, privateState.name, 'role="switch"', "New code"])
      expect(demoted).not.toContain(text);
    expect(demoted).toContain("Only an admin can change this.");
    const offline = render(client, "available", true, false);
    expect(offline).toMatch(/<button[^>]*role="switch"[^>]*disabled/);
    expect(offline).toMatch(/<button[^>]*disabled[^>]*>New code<\/button>/);
    expect(render(client, "available", true)).toContain(privateState.code);
  } finally { client.clear(); }
});

test("a Linux admin retains the unavailable receiver diagnosis without streaming instructions", () => {
  const client = new QueryClient();
  try {
    client.setQueryData(["airplay"], { ...privateState, enabled: false, status: "unavailable", error: "This Couch build doesn't include the AirPlay receiver." });
    const html = render(client, "unavailable", true);
    expect(html).toContain("This Couch build doesn&#x27;t include the AirPlay receiver.");
    expect(html).not.toContain("Receive AirPlay");
    expect(html).not.toContain(privateState.code);
  } finally { client.clear(); }
});
