import { setupUiTests, act, renderWithQueryClient, screen, userEvent, waitFor } from "@/testing/react";
import { beforeEach, expect, spyOn, test } from "bun:test";
import { useRef, useState } from "react";
import { PairingDialog } from "./PairingDialog";

setupUiTests();

let request: ReturnType<typeof spyOn>;
const host = { origin: "http://localhost", token: "host-secret", urls: ["http://couch.local:4100", "http://192.168.1.10:4100"] };
const button = (label: string) => screen.getByRole("button", { name: label });
const qr = () => screen.queryByRole("img", { name: /Pair another device with code/ });
const findQr = () => screen.findByRole("img", { name: "Pair another device with code 123456" });
function renderDialog(connected = true, urls = host.urls) {
  return renderWithQueryClient(<PairingDialog credentials={host} urls={urls} connected={connected} open onOpenChange={() => {}} />);
}
beforeEach(() => {
  request = spyOn(globalThis, "fetch").mockImplementation((async (_input: RequestInfo | URL) => Response.json({ code: "123456" })) as typeof fetch);
});

test("native shortcut renders a pairing QR and matching visible code", async () => {
  renderDialog();
  expect(await findQr()).toBeInTheDocument();
  expect(screen.getByText("123456")).toBeInTheDocument();
  expect(screen.getAllByRole("link").map(link => link.getAttribute("href"))).toEqual(host.urls);
  expect(screen.queryByText(host.token)).not.toBeInTheDocument();
  expect(request.mock.calls[0]?.[0]).toBe("http://localhost/api/controllers/pairing-code");
  expect(new Headers(request.mock.calls[0]?.[1]?.headers).get("Authorization")).toBe(`Bearer ${host.token}`);
});

test("loading, failure and retry retain manual recovery without an address-only QR", async () => {
  const user = userEvent.setup();
  let resolve!: (response: Response) => void;
  request.mockImplementation(() => new Promise(done => { resolve = done; }));
  renderDialog();
  expect(qr()).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Loading…");
  await act(async () => resolve(Response.json({ error: "Unavailable" }, { status: 503 })));
  expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load the code.");
  expect(qr()).not.toBeInTheDocument();
  request.mockImplementation(async () => Response.json({ code: "123456" }));
  await user.click(button("Try again"));
  expect(await findQr()).toBeInTheDocument();
});

test("disconnect removes a valid QR, ignores late responses and reconnect fetches again", async () => {
  const { rerender } = renderDialog();
  const reconnect = (connected: boolean) => act(async () => { rerender(<PairingDialog credentials={host} urls={host.urls} connected={connected} open onOpenChange={() => {}} />); });
  await findQr();
  await reconnect(false);
  expect(qr()).not.toBeInTheDocument();
  expect(await screen.findByRole("status")).toHaveTextContent("Offline. Reconnecting to Couch…");
  let resolve!: (response: Response) => void;
  request.mockImplementation(() => new Promise(done => { resolve = done; }));
  await reconnect(true);
  expect(qr()).not.toBeInTheDocument();
  const signal = request.mock.calls.at(-1)?.[1]?.signal;
  await reconnect(false);
  expect(signal?.aborted).toBe(true);
  await act(async () => resolve(Response.json({ code: "654321" })));
  expect(qr()).not.toBeInTheDocument();
  request.mockImplementation(async () => Response.json({ code: "123456" }));
  await reconnect(true);
  expect(await findQr()).toBeInTheDocument();
});

test("no advertised address leaves Close and manual recovery available", () => {
  renderDialog(true, []);
  expect(qr()).not.toBeInTheDocument();
  expect(request).not.toHaveBeenCalled();
  expect(screen.getByRole("status")).toHaveTextContent("No network. Connect Couch to Wi-Fi or Ethernet.");
  expect(button("Close")).toBeEnabled();
});

for (const close of ["Close", "Escape"] as const) test(`${close} restores focus to the native shortcut and reopening refreshes the QR`, async () => {
  const user = userEvent.setup();
  function Shortcut() {
    const [open, setOpen] = useState(false);
    const openerRef = useRef<HTMLButtonElement>(null);
    return <><button ref={openerRef} onClick={() => setOpen(true)}>Pair a remote</button><PairingDialog credentials={host} urls={host.urls} connected open={open} onOpenChange={setOpen} openerRef={openerRef} /></>;
  }
  renderWithQueryClient(<Shortcut />);
  expect(request).not.toHaveBeenCalled();
  await user.click(button("Pair a remote"));
  await findQr();
  if (close === "Close") await user.click(button("Close"));
  else await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await waitFor(() => expect(button("Pair a remote")).toHaveFocus());
  request.mockImplementation(async () => Response.json({ code: "654321" }));
  await user.click(button("Pair a remote"));
  expect(await screen.findByRole("img", { name: "Pair another device with code 654321" })).toBeInTheDocument();
});
