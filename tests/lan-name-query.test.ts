import { expect, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { originDomainQuery } from "../src/client/api/settings";

test("open network settings refresh when advertised names change or disappear", async () => {
  const fetchOriginal = globalThis.fetch;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  let suggested = "http://couch.example.home.arpa:4100", reads = 0;
  globalThis.fetch = (async () => { reads++; return Response.json({ domain: "", suggested }); }) as typeof fetch;
  const credentials = { origin: "http://127.0.0.1:4100", token: "test" }, ip = "https://192.168.1.20:4100";
  const observer = new QueryObserver(client, originDomainQuery(credentials, ["https://couch.example.home.arpa:4100", ip]));
  const unsubscribe = observer.subscribe(() => {});
  const loaded = async () => {
    const deadline = Date.now() + 1000;
    while (!observer.getCurrentResult().isSuccess || observer.getCurrentResult().isFetching) {
      if (Date.now() > deadline) throw new Error("Network settings did not refresh");
      await new Promise(resolve => setTimeout(resolve, 1));
    }
    return observer.getCurrentResult().data;
  };
  try {
    expect((await loaded())?.suggested).toBe(suggested);
    suggested = "http://couch.other.home:4100";
    observer.setOptions(originDomainQuery(credentials, ["https://couch.other.home:4100", ip]));
    expect((await loaded())?.suggested).toBe(suggested);
    suggested = "";
    observer.setOptions(originDomainQuery(credentials, [ip]));
    expect((await loaded())?.suggested).toBe("");
    expect(reads).toBe(3);
  } finally { unsubscribe(); client.clear(); globalThis.fetch = fetchOriginal; }
});
