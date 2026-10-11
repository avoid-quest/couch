import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { GuideRequest } from "../src/client/components/GuideSources";

// Capture the request prop at the settings -> editor seam, using the real component and hooks.
let request: GuideRequest;
mock.module("../src/client/components/GuideSources", () => ({ GuideSources: (props: { request: GuideRequest }) => { request = props.request; return null; } }));
const { IptvSettings } = await import("../src/client/sections/settings/sources/IptvSettings");
const client = new QueryClient();
afterEach(() => { mock.restore(); client.clear(); });

test("the settings mutation callback uses the Live TV deadline and invalidates the guide", async () => {
  const timeout = spyOn(AbortSignal, "timeout").mockImplementation(() => new AbortController().signal);
  const fetched = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ source: { channelCount: 30 } }));
  const invalidated = spyOn(client, "invalidateQueries").mockResolvedValue();
  client.setQueryData(["iptv", "sources"], { sources: [] });
  renderToString(createElement(QueryClientProvider, { client }, createElement(IptvSettings, {
    credentials: { origin: "http://couch.local", token: "test-token" }, connected: true, canManage: true,
  })));
  await request("sources/one/refresh", { method: "POST" });
  expect(timeout).toHaveBeenCalledWith(25_000);
  expect(fetched).toHaveBeenCalledTimes(1);
  expect(invalidated).toHaveBeenCalledWith({ queryKey: ["iptv"] });
});
