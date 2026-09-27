import { setupUiTests, render, screen, testWindow, userEvent, waitFor } from "@/testing/react";
import { expect, mock, spyOn, test } from "bun:test";
import { ShellProviders } from "./test-providers";
import { PairingPage } from "./AppShell";

setupUiTests();

test("a fresh local Core is set up in the browser without an external code", async () => {
  const origin = "http://127.0.0.1:4412";
  const previousUrl = location.href;
  const previousName = localStorage.getItem("couch.device-name");
  testWindow.happyDOM.setURL(origin);
  Object.defineProperty(navigator, "userAgentData", { configurable: true, value: { platform: "macOS", mobile: false, brands: [{ brand: "Google Chrome" }] } });
  const savePairing = mock(() => {});
  const fetch = spyOn(globalThis, "fetch").mockImplementation((async (input, init) => {
    expect(String(input)).toBe(`${origin}/api/setup-local`);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body)).name).toBe("Mac · Chrome");
    return Response.json({ token: "first-owner", installationId: "installation" });
  }) as typeof globalThis.fetch);
  try {
    render(<ShellProviders value={{ localHost: false, credentials: null, details: { name: "Couch", localSetupAvailable: true }, booting: false, status: "pairing-required", savePairing }}><PairingPage /></ShellProviders>);
    expect(screen.getByText("Set up Couch on this computer")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Set up Couch" }));
    await waitFor(() => expect(savePairing).toHaveBeenCalledWith({ origin: expect.any(String), token: "first-owner", installationId: "installation" }));
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally {
    fetch.mockRestore();
    Reflect.deleteProperty(navigator, "userAgentData");
    testWindow.happyDOM.setURL(previousUrl);
    if (previousName === null) localStorage.removeItem("couch.device-name");
    else localStorage.setItem("couch.device-name", previousName);
  }
});

test("an ordinary remote sees the pairing path in Settings → Devices", () => {
  render(<ShellProviders value={{ localHost: false, credentials: null, details: { name: "Living room" }, booting: false, status: "pairing-required", linkedPairingCode: "", pairingOrigin: "http://living-room:4100" }}><PairingPage /></ShellProviders>);
  expect(screen.getByText(/Settings → Devices → Pair a remote/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Set up Couch" })).not.toBeInTheDocument();
});
