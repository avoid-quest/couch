// Core's runtime, Node: Bun replaces ws with its own.
import assert from "node:assert/strict";
import { test } from "node:test";
import { WebSocket, WebSocketServer } from "ws";
import { createListenerFanout, pairedFrom, type ListenerEvent } from "../src/server/live-fanout";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const waitFor = async (check: () => boolean) => { const deadline = Date.now() + 5000; while (!check()) { assert.ok(Date.now() < deadline, "bounded wait"); await sleep(1); } };

test("a stalled listener loses its audio after half a second and is closed after two, while the others keep theirs", async () => {
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise(resolve => server.once("listening", resolve));
  const events: ListenerEvent[] = [], fanout = createListenerFanout(event => events.push(event));
  // When Core wrote audio to each listener.
  const sends: number[][] = [];
  server.on("connection", (socket, request) => {
    const at: number[] = []; sends.push(at);
    const send = socket.send.bind(socket);
    socket.send = ((data: Buffer) => { at.push(performance.now()); send(data); }) as typeof socket.send;
    fanout.listen(socket, request.socket, "source", `device ${sends.length}`);
  });
  const connect = async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${(server.address() as { port: number }).port}`), received: number[] = [];
    socket.on("message", () => received.push(performance.now()));
    const closed = new Promise<number>(resolve => socket.once("close", resolve));
    await new Promise(resolve => socket.once("open", resolve));
    return { socket, received, closed };
  };
  const steady = await connect(), stalled = await connect();
  await sleep(50);
  const ids = events.filter(event => event.type === "listenerOpen").map(event => event.id);
  // A packet about the size of a PCM packet every 2.67 ms; the stalled listener stops reading.
  const packet = new Uint8Array(536);
  const sending = setInterval(() => fanout.receive({ type: "listenerAudio", packet, to: ids }), 2.67);
  (stalled.socket as unknown as { _socket: { pause(): void } })._socket.pause();
  const stalledAt = performance.now();
  await sleep(2500);
  assert.ok(events.some(event => event.type === "listenerClosed" && event.id === ids[1]));
  const closedAt = performance.now();
  clearInterval(sending);
  // Its next ping goes unanswered within 100 ms, and its audio stops half a second later.
  const last = sends[1]!.at(-1)!;
  assert.ok(last > stalledAt + 450 && last < stalledAt + 700, `audio stopped ${Math.round(last - stalledAt)} ms after the stall`);
  const steadily = steady.received.filter(at => at >= stalledAt && at <= closedAt);
  assert.ok(steadily.length > 0.8 * (closedAt - stalledAt) / 2.67, `${steadily.length} packets reached the other listener`);
  assert.ok(Math.max(...steadily.slice(1).map((at, i) => at - steadily[i]!)) < 100);
  (stalled.socket as unknown as { _socket: { resume(): void } })._socket.resume();
  assert.equal(await stalled.closed, 4002);
  steady.socket.close(); server.close();
});

test("from twenty listeners, audio leaves in pairs, a lone packet leaves within 5 ms and messages never overtake it", async () => {
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise(resolve => server.once("listening", resolve));
  const events: ListenerEvent[] = [], fanout = createListenerFanout(event => events.push(event));
  let sent = 0;
  server.on("connection", (socket, request) => {
    const send = socket.send.bind(socket);
    socket.send = ((data: Buffer) => { sent++; send(data); }) as typeof socket.send;
    fanout.listen(socket, request.socket, "source", "device");
  });
  const clients = await Promise.all(Array.from({ length: pairedFrom }, async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${(server.address() as { port: number }).port}`), received: (number | string)[] = [];
    socket.on("message", (data, binary) => received.push(binary ? (data as Buffer)[0]! : String(data)));
    await new Promise(resolve => socket.once("open", resolve));
    return { socket, received };
  }));
  await waitFor(() => events.length === pairedFrom);
  const ids = events.map(event => event.type === "listenerOpen" ? event.id : 0), first = clients[0]!.received;
  const audio = (n: number) => fanout.receive({ type: "listenerAudio", packet: Uint8Array.of(n), to: ids });
  audio(1);
  assert.equal(sent, 0, "the first packet waits for its pair");
  audio(2);
  assert.equal(sent, 2 * pairedFrom);
  await waitFor(() => first.length === 2);
  audio(3);
  const lone = performance.now();
  await waitFor(() => first.length === 3);
  assert.ok(performance.now() - lone < 30);
  audio(4);
  fanout.receive({ type: "listenerSend", id: ids[0]!, text: "hello" });
  await waitFor(() => first.length === 5);
  assert.deepEqual(first, [1, 2, 3, 4, "hello"]);
  await waitFor(() => clients.every(client => client.received.filter(value => typeof value === "number").length === 4));
  for (const { socket } of clients) socket.close();
  server.close();
});
