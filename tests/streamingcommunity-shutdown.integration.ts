import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHub } from '../src/server/hub';
import { openStore } from '../src/server/store';
import { healStreamingCommunityOrigin } from '../src/server/streamingcommunity';

test('a late startup origin redirect after Core closes never writes its closed store', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'couch-playback-shutdown-'));
  const originalFetch = globalThis.fetch;
  let release!: (response: Response) => void;
  const errors: string[] = [];
  const rejected = (error: unknown) => errors.push(error instanceof Error ? error.message : String(error));
  t.mock.method(console, 'error', (...args: unknown[]) => { errors.push(args.map(arg => arg instanceof Error ? arg.message : String(arg)).join(' ')); });
  process.on('unhandledRejection', rejected);
  globalThis.fetch = (async (input: string | URL | Request) => {
    assert.match(String(input), /^https:\/\/streamingcommunity/);
    return await new Promise<Response>(resolve => { release = resolve; });
  }) as typeof fetch;
  let hub: Awaited<ReturnType<typeof createHub>> | undefined;
  try {
    hub = await createHub({ databasePath: join(directory, 'couch.sqlite'), hostToken: 'h'.repeat(64), hostname: '127.0.0.1', port: 0 });
    assert.equal(typeof release, 'function');
    await hub.close();
    const response = new Response('<div data-page="{&quot;component&quot;:&quot;Home&quot;,&quot;props&quot;:{}}"></div>');
    Object.defineProperty(response, 'url', { value: 'https://streamingcommunityz.rip' });
    release(response);
    await new Promise(resolve => setTimeout(resolve, 30));
    console.log('SHUTDOWN_ERRORS', JSON.stringify(errors));
    assert.deepEqual(errors, [], 'startup healing must respect the Core store lifetime');
  } finally {
    globalThis.fetch = originalFetch;
    process.off('unhandledRejection', rejected);
    await hub?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

const site = (origin: string) => {
  const response = new Response('<div data-page="{&quot;component&quot;:&quot;Home&quot;,&quot;props&quot;:{}}"></div>');
  Object.defineProperty(response, 'url', { value: origin });
  return response;
};
const originStore = (name: string) => {
  let origin = `https://streamingcommunity${name}.test`;
  const writes: string[] = [];
  return { writes, streamingCommunityOrigin: () => origin, saveStreamingCommunityOrigin: (value: string) => { writes.push(value); origin = value; } };
};
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Expected origin check did not finish.');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

test('shutdown aborts startup fetch and repeated close completes before it settles', { timeout: 2_000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'couch-origin-cancel-'));
  let signal: AbortSignal | undefined;
  let aborted = false;
  t.mock.method(globalThis, 'fetch', async (_input: unknown, init: RequestInit) => {
    signal = init.signal as AbortSignal;
    return new Promise<Response>((_resolve, reject) => signal!.addEventListener('abort', () => { aborted = true; reject(signal!.reason); }, { once: true }));
  });
  const hub = await createHub({ databasePath: join(directory, 'couch.sqlite'), hostToken: 'h'.repeat(64), hostname: '127.0.0.1', port: 0 });
  try {
    const first = hub.close();
    assert.equal(hub.close(), first);
    await first;
    assert.equal(signal?.aborted, true);
    assert.equal(aborted, true);
    await hub.close();
    await new Promise(resolve => setImmediate(resolve));
  } finally { await hub.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('late body completion cannot save or cache an origin after cancellation', async t => {
  const store = originStore('latebody'), controller = new AbortController();
  const initial = store.streamingCommunityOrigin(), moved = 'https://streamingcommunitylatebodymoved.test';
  let release!: (text: string) => void;
  let reads = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    reads++;
    const response = site(moved);
    if (reads === 1) response.text = () => new Promise<string>(resolve => { release = resolve; });
    return response;
  });
  const healing = healStreamingCommunityOrigin(store, controller.signal);
  await until(() => !!release);
  controller.abort();
  release(await site(moved).text());
  await assert.rejects(healing, error => error === controller.signal.reason);
  assert.deepEqual(store.writes, []);
  const next = originStore('latebody');
  assert.equal(next.streamingCommunityOrigin(), initial);
  assert.equal(await healStreamingCommunityOrigin(next, new AbortController().signal), moved);
  assert.equal(reads, 2, 'the cancelled redirect must not populate the origin cache');
  assert.deepEqual(next.writes, [moved]);
});

test('startup follows and saves a successful redirect while Core is open', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'couch-origin-open-')), databasePath = join(directory, 'couch.sqlite');
  const seeded = openStore(databasePath);
  seeded.saveStreamingCommunityOrigin('https://streamingcommunityopen.test');
  seeded.close();
  let release!: (response: Response) => void;
  t.mock.method(globalThis, 'fetch', () => new Promise<Response>(resolve => { release = resolve; }));
  const hub = await createHub({ databasePath, hostToken: 'h'.repeat(64), hostname: '127.0.0.1', port: 0 });
  const observer = openStore(databasePath);
  try {
    release(site('https://streamingcommunityopenmoved.test'));
    await until(() => observer.streamingCommunityOrigin() === 'https://streamingcommunityopenmoved.test');
    await hub.close();
    assert.equal(observer.streamingCommunityOrigin(), 'https://streamingcommunityopenmoved.test');
  } finally { observer.close(); await hub.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('unreachable discovery while active keeps the saved origin', async t => {
  const store = originStore('unreachable'), calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: unknown) => { calls.push(String(input)); throw new Error('Network unavailable'); });
  const origin = store.streamingCommunityOrigin();
  assert.equal(await healStreamingCommunityOrigin(store, new AbortController().signal), origin);
  assert.equal(calls.length, 3, 'the current site and both published address pages are tried');
  assert.deepEqual(store.writes, []);
});

test('active startup discovery errors are reported and handled', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'couch-origin-failure-')), databasePath = join(directory, 'couch.sqlite');
  const seeded = openStore(databasePath);
  seeded.saveStreamingCommunityOrigin('https://streamingcommunityfailure.test');
  seeded.close();
  const failure = new Error('Address page body failed'), reports: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => { reports.push(args); });
  t.mock.method(globalThis, 'fetch', async (input: unknown) => {
    if (String(input).includes('streamingcommunityfailure.test')) throw new Error('Site unavailable');
    const response = new Response('');
    response.text = async () => { throw failure; };
    return response;
  });
  const hub = await createHub({ databasePath, hostToken: 'h'.repeat(64), hostname: '127.0.0.1', port: 0 });
  try {
    await until(() => reports.some(args => args.includes(failure)));
    await new Promise(resolve => setImmediate(resolve));
  } finally { await hub.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('address page fetches share cancellation and later heals use the same lifetime', async t => {
  const store = originStore('subsequent'), controller = new AbortController();
  let signal: AbortSignal | undefined, release!: (response: Response) => void;
  t.mock.method(globalThis, 'fetch', async (input: unknown, init: RequestInit) => {
    if (String(input) === store.streamingCommunityOrigin()) throw new Error('Site unavailable');
    signal = init.signal as AbortSignal;
    return new Promise<Response>(resolve => { release = resolve; });
  });
  const healing = healStreamingCommunityOrigin(store, controller.signal);
  await until(() => !!release);
  controller.abort();
  assert.equal(signal?.aborted, true);
  release(new Response('https://streamingcommunitypublished.test'));
  await assert.rejects(healing, error => error === controller.signal.reason);
  const reads = t.mock.method(store, 'streamingCommunityOrigin');
  await assert.rejects(healStreamingCommunityOrigin(store, controller.signal), error => error === controller.signal.reason);
  assert.equal(reads.mock.callCount(), 0, 'a later heal must not read a closed store');
  assert.deepEqual(store.writes, []);
});

test('a live store write defect remains a rejected heal', async t => {
  const store = originStore('brokenstore'), failure = new Error('SQLite write defect');
  t.mock.method(globalThis, 'fetch', async () => site('https://streamingcommunitybrokenstoremoved.test'));
  t.mock.method(store, 'saveStreamingCommunityOrigin', () => { throw failure; });
  await assert.rejects(healStreamingCommunityOrigin(store, new AbortController().signal), error => error === failure);
});

test('one Core closing does not cancel another Core origin check', async t => {
  const first = originStore('firstcore'), second = originStore('secondcore');
  const closing = new AbortController(), alive = new AbortController();
  const releases = new Map<string, (response: Response) => void>();
  t.mock.method(globalThis, 'fetch', (input: unknown) => new Promise<Response>(resolve => { releases.set(String(input), resolve); }));
  const firstHeal = healStreamingCommunityOrigin(first, closing.signal), secondHeal = healStreamingCommunityOrigin(second, alive.signal);
  await until(() => releases.size === 2);
  closing.abort();
  releases.get(first.streamingCommunityOrigin())!(site('https://streamingcommunityfirstmoved.test'));
  releases.get(second.streamingCommunityOrigin())!(site('https://streamingcommunitysecondmoved.test'));
  await assert.rejects(firstHeal, error => error === closing.signal.reason);
  assert.equal(await secondHeal, 'https://streamingcommunitysecondmoved.test');
  assert.deepEqual(first.writes, []);
  assert.deepEqual(second.writes, ['https://streamingcommunitysecondmoved.test']);
});
