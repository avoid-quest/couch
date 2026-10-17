// Evaluate in the compiled renderer attached to a real, isolated Core, then call
// couchPlaybackReview.original(mediaUrl). Uses the live SessionGate commands,
// REST endpoints and actual row/Details controls; never replaces application state.
(() => {
  const gate = () => {
    const root = document.getElementById("root");
    const container = root[Object.keys(root).find(key => key.startsWith("__reactContainer"))];
    const nodes = [container.stateNode.current];
    while (nodes.length) {
      const node = nodes.pop(), value = node?.memoizedProps?.value;
      if (value?.run && value?.command && value?.queryClient) return value;
      if (node?.child) nodes.push(node.child);
      if (node?.sibling) nodes.push(node.sibling);
    }
    throw new Error("No rendered SessionGate");
  };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async (predicate, label, timeout = 12_000) => {
    const start = performance.now();
    while (!predicate()) {
      if (performance.now() - start > timeout) throw new Error(`Timed out: ${label}`);
      await sleep(25);
    }
  };
  const click = (selector, text) => {
    const element = [...document.querySelectorAll(selector)].find(element => text === undefined || element.textContent.trim() === text);
    if (!element || element.disabled) throw new Error(`Unavailable control: ${selector} ${text ?? ""}`);
    element.click();
  };
  const page = async href => {
    click(`a[href='${href}']`);
    await wait(() => location.pathname + location.search === href, href);
    await sleep(100);
  };
  const api = async (path, body) => {
    const response = await fetch(gate().credentials.origin + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${gate().credentials.token}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result;
  };
  const toasts = () => [...document.querySelectorAll("[data-sonner-toast]")].map(node => node.textContent.trim());
  const observe = () => {
    const state = gate().state, video = document.querySelector("video");
    return { route: location.pathname + location.search, current: state?.currentEntryId ?? null, playedBy: !!state?.playedBy,
      presentation: state?.presentationId ?? null, outputs: state?.outputs ?? [],
      queue: (state?.queue ?? []).map(({ id, title }) => ({ id, title })), toasts: toasts(),
      video: video && { ready: video.readyState, time: video.currentTime, paused: video.paused } };
  };
  const results = [];
  let savedPlaylist;
  let savedItem, historyItem, playbackSource;
  const check = (name, ok) => results.push({ name, pass: !!ok, ...observe() });
  const quiet = () => wait(() => !toasts().some(text => text.startsWith("Queued")), "previous queue toast dismissed", 8_000);
  const run = async action => { if (!await gate().run(action)) throw new Error(`Failed command ${action.type}`); await sleep(100); };
  const pause = () => run({ type: "pause", playbackId: gate().state.player.playbackId, paused: true });
  const openSavedList = async id => {
    await page("/library");
    await wait(() => document.querySelector("a[href='/library?tab=lists']"), "Lists link");
    await page("/library?tab=lists");
    await wait(() => document.querySelector(`[data-playlist-id='${id}']`), "saved list row");
    click(`[data-playlist-id='${id}'] button[aria-label^='Open ']`);
    await wait(() => [...document.querySelectorAll("section[aria-label='Lists'] button")].some(node => node.textContent === "Queue"), "saved list detail Queue");
  };
  // A row is one target; its other verbs wait in its context menu, which a right-click opens on the real Radix trigger.
  const row = title => [...document.querySelectorAll("li[data-nav-row]")].find(node => node.querySelector("[data-play] span")?.textContent === title);
  const menu = async (title, label) => {
    const target = row(title);
    if (!target) throw new Error(`Unavailable row: ${title}`);
    const box = target.getBoundingClientRect();
    target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: box.left + 8, clientY: box.top + 8 }));
    await wait(() => document.querySelector("[role='menuitem']"), "row context menu");
    click("[role='menuitem']", label);
  };
  const queueChannel = async name => {
    await page("/live");
    await wait(() => row(name), "channel row");
    await menu(name, "Queue");
    await wait(() => toasts().some(text => text.includes(`Queued ${name}`)), "channel confirmation");
  };
  // Details holds Queue in its row of verbs; rows keep it in their context menu.
  const queue = title => location.pathname === "/item" ? click("[data-page='Item'] header button", "Queue") : menu(title, "Queue");
  const confirmation = title => {
    const queued = [...document.querySelectorAll("[data-sonner-toast]")].filter(node => node.querySelector("[data-title]")?.textContent.startsWith("Queued"));
    return queued.length === 1 && queued[0].querySelector("[data-title]").textContent === `Queued ${title}` && queued[0].querySelector("[data-button]")?.textContent === "Up next";
  };
  // Home's tiles do one verb (Continue resumes, Played recently opens Details), so a history item's other verbs are on its Details.
  const openItem = async (surface, verbs = true) => {
    const item = surface.startsWith("history") ? historyItem : savedItem;
    const home = surface.startsWith("history");
    await page(surface === "saved-row" || surface === "saved-details" ? "/library" : "/");
    await wait(() => document.querySelector(`button[aria-label='Details ${item.title}']`), `${surface} Details`);
    if (surface.endsWith("details") || home && (verbs || surface === "history-recent")) {
      click(`button[aria-label='Details ${item.title}']`);
      await wait(() => location.pathname === "/item" && document.querySelector("h1")?.textContent === item.title, "item Details");
    }
    return item;
  };
  window.couchPlaybackReview = { gate, wait, sleep, click, page, api, toasts, observe, results, check, quiet, run, pause, openSavedList, menu, queue, confirmation, openItem,
    async loadItems(savedId, mediaId) {
      savedItem = (await api("/api/for-later")).items.find(item => item.id === savedId);
      historyItem = (await api(`/api/progress/${encodeURIComponent(mediaId)}`)).item;
      if (!savedItem || !historyItem?.playable) throw new Error("Missing shared review items");
      return { savedItem, historyItem };
    },
    async setupItems(mediaUrl) {
      await wait(() => gate().connected, "connected");
      const suffix = crypto.randomUUID();
      const entry = { id: crypto.randomUUID(), title: `For later coverage ${suffix}`, source: `${mediaUrl}?saved=${suffix}` };
      await run({ type: "enqueue", entry });
      savedItem = (await api("/api/for-later", { reference: { kind: "queue", id: entry.id } })).item;
      const history = { id: crypto.randomUUID(), title: `History coverage ${suffix}`, source: `${mediaUrl}?history=${suffix}` };
      playbackSource = `${mediaUrl}?active=${suffix}`;
      await run({ type: "enqueue", entry: history, playNow: true, deviceId: gate().identity.device.id });
      await wait(() => document.querySelector("video")?.readyState === 4 && document.querySelector("video").currentTime > 2, "real decoded history progress");
      await pause();
      await run({ type: "stop", playbackId: gate().state.player.playbackId });
      historyItem = (await api("/api/progress/history?limit=40")).items.find(item => item.title === history.title);
      if (!historyItem?.playable || historyItem.position <= 0) throw new Error("No playable actual history progress");
      return { savedItem, historyItem };
    },
    async itemQueue(surface, active = false) {
      const start = results.length;
      if (active && !gate().state.currentEntryId) {
        await run({ type: "enqueue", entry: { id: crypto.randomUUID(), title: "Active Queue coverage", source: playbackSource }, playNow: true, deviceId: gate().identity.device.id });
        await wait(() => document.querySelector("video")?.readyState === 4, "active decoded video");
        await pause();
      } else if (!active && gate().state.currentEntryId) await run({ type: "stop", playbackId: gate().state.player.playbackId });
      if (surface === "history-recent" || surface === "history-continue") {
        await api(`/api/progress/${encodeURIComponent(historyItem.mediaId)}`, { watched: surface === "history-recent" });
        await gate().queryClient.invalidateQueries({ queryKey: ["progress"] });
      }
      const item = await openItem(surface);
      await quiet();
      const before = observe();
      await queue(item.title);
      await wait(() => gate().state.queue.length === before.queue.length + 1, `actual ${surface} REST append`);
      await sleep(200);
      check(`${active ? "active" : "idle"} ${surface} Queue confirms exact title once and preserves playback`,
        confirmation(item.title) && gate().state.queue.at(-1).title === item.title && gate().state.currentEntryId === before.current && !!before.current === active);
      if (confirmation(item.title)) {
        click("[data-sonner-toast] button", "Up next");
        await wait(() => location.pathname + location.search === "/now?queue=true", "actual item Up next action");
        check(`${surface} Up next opens the actual queue`, gate().state.queue.at(-1).title === item.title && document.body.innerText.includes(item.title));
      }
      return { failures: results.slice(start).filter(result => !result.pass).length, results: results.slice(start) };
    },
    async remoteAppend(entryId) {
      await wait(() => gate().state.queue.some(entry => entry.id === entryId), "other controller's real REST append");
      await sleep(200);
      check("other controller's REST Queue snapshot stays quiet", !toasts().some(text => text.startsWith("Queued")));
      return results.at(-1);
    },
    async itemGuard(surface, kind, mediaUrl) {
      const item = await openItem(surface);
      await quiet();
      const owner = gate().credentials, originalFetch = window.fetch, before = observe();
      const path = surface.startsWith("history") ? `/api/progress/${encodeURIComponent(item.mediaId)}/queue` : `/api/for-later/${item.id}/load`;
      let release, completed = false;
      const held = new Promise(resolve => { release = resolve; });
      // Hold only delivery of a completed real response to the actual UI handler.
      window.fetch = async (input, init) => {
        const response = await originalFetch(input, init);
        if (String(input).endsWith(path) && init?.method === "POST") {
          if (!response.ok) throw new Error("Guard fixture append failed");
          completed = true;
          await held;
        }
        return response;
      };
      try {
        await queue(item.title);
        await wait(() => completed && gate().state.queue.length === before.queue.length + 1, "held successful actual REST append");
        if (kind === "credentials") { gate().setCredentials(null); await sleep(100); }
        else if (kind === "reconnect") gate().reconnect();
        else if (kind === "newer-command") await run({ type: "mute", muted: false });
        else if (kind === "target") {
          await gate().command({ type: "enqueue", entry: { id: crypto.randomUUID(), title: "Guard self target", source: mediaUrl }, playNow: true, deviceId: gate().identity.device.id });
          await wait(() => gate().state.controlling !== before.controlling, "actual changed target");
        } else if (kind === "overlap") {
          window.fetch = originalFetch;
          await run({ type: "enqueue", entry: { id: crypto.randomUUID(), title: "Newer Queue title", source: mediaUrl } });
        } else throw new Error(`Unknown guard ${kind}`);
        release();
        await sleep(200);
        check(`${surface} completed REST Queue suppresses stale ${kind} feedback`, kind === "overlap" ? confirmation("Newer Queue title") : !toasts().some(text => text.startsWith("Queued")));
        return results.at(-1);
      } finally {
        release();
        window.fetch = originalFetch;
        if (kind === "credentials") gate().setCredentials(owner);
        await wait(() => gate().connected, "guard connection restored");
      }
    },
    async itemPlay(surface) {
      if (gate().state.currentEntryId) await run({ type: "stop", playbackId: gate().state.player.playbackId });
      const item = await openItem(surface, false);
      await quiet();
      const before = gate().state.player.playbackId;
      if (location.pathname === "/item") click("[data-page='Item'] header button", surface.startsWith("history") ? "Resume" : "Play");
      else if (surface.startsWith("history")) click(`button[aria-label='Resume ${item.title}']`);
      else await menu(item.title, "Play");
      await wait(() => gate().state.player.playbackId !== before && gate().state.queue.find(entry => entry.id === gate().state.currentEntryId)?.title === item.title && document.querySelector("video")?.readyState === 4, "actual REST Play decodes");
      check(`${surface} actual Play has no Queued feedback`, !toasts().some(text => text.startsWith("Queued")));
      await pause();
      return results.at(-1);
    },
    async itemError(surface) {
      const item = await openItem(surface);
      await quiet();
      const before = observe(), originalFetch = window.fetch;
      const path = surface.startsWith("history") ? `/api/progress/${encodeURIComponent(item.mediaId)}/queue` : `/api/for-later/${item.id}/load`;
      let failure;
      // A real Core rejection of this UI request, without changing the response or state.
      window.fetch = async (input, init) => {
        if (String(input).endsWith(path) && init?.method === "POST") {
          const missing = surface.startsWith("history") ? `/api/progress/${encodeURIComponent("media:" + "0".repeat(64))}/queue` : "/api/for-later/missing-review-item/load";
          const response = await originalFetch(new URL(missing, gate().credentials.origin), init);
          failure = { status: response.status, ...(await response.clone().json()) };
          return response;
        }
        return originalFetch(input, init);
      };
      try {
        await queue(item.title);
        await wait(() => failure, "actual REST rejection");
        await sleep(200);
        const message = document.body.innerText;
        check(`${surface} actual REST error stays visible without Queued or append`, failure.status >= 400 && gate().state.queue.length === before.queue.length && !toasts().some(text => text.startsWith("Queued")) && (failure.error && message.includes(failure.error) || message.includes(`Couldn't queue ${item.title}.`)));
        return { ...results.at(-1), failure };
      } finally { window.fetch = originalFetch; }
    },
    async savedUndo() {
      await openItem("saved-row");
      await quiet();
      await menu(savedItem.title, "Remove");
      await wait(() => !document.querySelector(`[data-saved-details='${savedItem.id}']`) && toasts().some(text => text.includes(`Removed ${savedItem.title} from Library.`) && text.includes("Undo")), "actual saved removal and Undo notice");
      check("For later Remove preserves its notice and stays free of Queued", !toasts().some(text => text.startsWith("Queued")));
      click("[data-sonner-toast] button", "Undo");
      await wait(() => document.querySelector(`[data-saved-details='${savedItem.id}']`), "actual restored saved row");
      check("For later Undo restores the real saved item without Queued", (await api("/api/for-later")).items.some(item => item.id === savedItem.id) && !toasts().some(text => text.startsWith("Queued")));
      return results.slice(-2);
    },
    async forLaterRow(mediaUrl) {
      if (gate().state.currentEntryId) await run({ type: "stop", playbackId: gate().state.player.playbackId });
      const entry = { id: crypto.randomUUID(), title: `For later row ${crypto.randomUUID()}`, source: mediaUrl + "?saved=" + crypto.randomUUID() };
      await run({ type: "enqueue", entry });
      const { item } = await api("/api/for-later", { reference: { kind: "queue", id: entry.id } });
      await page("/library");
      await wait(() => document.querySelector(`[data-saved-details='${item.id}']`), "saved row");
      await quiet();
      const before = gate().state.queue.length;
      await queue(item.title);
      await wait(() => gate().state.queue.length === before + 1, "actual For later REST append");
      await sleep(200);
      check("idle For later row Queue confirms its exact title and Up next", confirmation(item.title));
      return { failures: results.slice(-1).filter(result => !result.pass).length, results: results.slice(-1) };
    },
    async original(mediaUrl) {
      results.length = 0;
      await wait(() => gate().connected, "connected");
      if (gate().state.currentEntryId) await run({ type: "stop", playbackId: gate().state.player.playbackId });
      for (const entry of gate().state.queue) await run({ type: "remove", entryId: entry.id });
      const prefix = crypto.randomUUID();
      const entry = (id, title) => ({ id: prefix + id, title, source: mediaUrl });
      const own = gate().identity.device.id;
      await run({ type: "enqueue", entry: entry("natural-first", "Natural first"), playNow: true, deviceId: own });
      await wait(() => location.pathname === "/now" && document.querySelector("video")?.readyState === 4, "explicit decoded video opens Now");
      await run({ type: "enqueue", entry: entry("natural-second", "Natural second") });
      await page("/search");
      await wait(() => gate().state.currentEntryId === prefix + "natural-second", "real video naturally advances");
      await pause();
      check("natural advance preserves Search and clears actor", location.pathname === "/search" && !gate().state.playedBy && !gate().state.presentationId);
      await run({ type: "output", deviceId: own, picture: false });
      await run({ type: "output", deviceId: own, picture: true });
      await sleep(200);
      check("own Picture reselection after natural advance opens Now", location.pathname === "/now");

      await run({ type: "stop", playbackId: gate().state.player.playbackId });
      await run({ type: "enqueue", entry: entry("saved-seed", "Saved seed") });
      const { playlist } = await api("/api/playlists", { name: `Review saved list ${prefix}`, scope: "upNext" });
      savedPlaylist = playlist;
      await openSavedList(playlist.id);
      await quiet();
      const before = gate().state.queue.length;
      click("section[aria-label='Lists'] button", "Queue");
      await wait(() => gate().state.queue.length > before, "REST list append");
      await sleep(200);
      check("idle Saved list Queue confirms successful action", toasts().some(text => text.includes(`Queued ${playlist.name}`) && text.includes("Up next")));
      await quiet();

      const outcomes = await Promise.all([
        gate().run({ type: "enqueue", entry: entry("burst-first", "Burst first") }),
        gate().run({ type: "enqueue", entry: entry("burst-second", "Burst second") }),
      ]);
      await sleep(200);
      check("overlapping Queue confirms Burst second once", outcomes.every(Boolean) && toasts().filter(text => text.startsWith("Queued")).length === 1 && toasts().some(text => text.includes("Queued Burst second")));
      return { failures: results.filter(result => !result.pass).length, results };
    },
    // Run after original(); the media fixture also serves channels.m3u naming channelName.
    async rest(mediaUrl, channelName) {
      await quiet();
      await run({ type: "play", entryId: gate().state.queue.find(entry => entry.title === "Saved seed").id });
      await pause();
      await openSavedList(savedPlaylist.id);
      const before = gate().state.queue.length;
      click("section[aria-label='Lists'] button", "Queue");
      await wait(() => gate().state.queue.length > before, "active Saved list append");
      await sleep(200);
      check("active Saved list Queue confirms once", toasts().filter(text => text.includes(`Queued ${savedPlaylist.name}`)).length === 1);
      click("[data-sonner-toast] [data-button]", "Up next");
      await wait(() => location.pathname + location.search === "/now?queue=true", "Saved Up next action");
      check("actual Saved confirmation Up next opens queue", true);
      await quiet();
      await run({ type: "stop", playbackId: gate().state.player.playbackId });
      await api("/api/iptv/sources", { name: `Review TV ${crypto.randomUUID()}`, playlistUrl: new URL("channels.m3u", mediaUrl).href });
      await queueChannel(channelName);
      check("idle actual Live TV Queue confirms once", !gate().state.currentEntryId && toasts().filter(text => text.startsWith(`Queued ${channelName}`)).length === 1);
      await quiet();
      await run({ type: "play", entryId: gate().state.queue.find(entry => entry.title === "Saved seed").id });
      await pause();
      await queueChannel(channelName);
      check("active actual Live TV Queue confirms once", !!gate().state.currentEntryId && toasts().filter(text => text.startsWith(`Queued ${channelName}`)).length === 1);
      click("[data-sonner-toast] [data-button]", "Up next");
      await wait(() => location.pathname + location.search === "/now?queue=true", "Live TV Up next action");
      check("actual Live TV Up next opens queue", true);
      await quiet();
      const count = gate().state.queue.length;
      const ok = await gate().run({ type: "enqueue", entry: gate().state.queue[0] });
      await sleep(200);
      check("duplicate-ID Queue rejection emits no feedback", !ok && count === gate().state.queue.length && !toasts().some(text => text.startsWith("Queued")));
      return { failures: results.filter(result => !result.pass).length, results };
    },
    async radio(mediaUrl) {
      await page("/search");
      await run({ type: "enqueue", entry: { id: crypto.randomUUID(), title: "Decoded fixture radio", source: mediaUrl, kind: "radio", live: true }, playNow: true, deviceId: gate().identity.device.id });
      await wait(() => document.querySelector("video")?.readyState === 4, "decoded fixture radio");
      check("decoded audio-only radio start preserves Search", location.pathname === "/search" && gate().state.playbacks.find(playback => playback.id === gate().state.playback)?.audioOnly);
      const initial = gate().state.player.playbackId;
      await wait(() => gate().state.radioRetry?.attempt > 0, "radio fixture naturally ends and schedules retry", 12_000);
      await wait(() => gate().state.player.playbackId !== initial && gate().state.presentationId === null && gate().state.player.status === "playing" && document.querySelector("video")?.readyState === 4, "radio retry decodes", 5_000);
      check("actual decoded radio retry preserves Search", location.pathname === "/search");
      await run({ type: "stop", playbackId: gate().state.player.playbackId });
      return { failures: results.slice(-2).filter(result => !result.pass).length, results: results.slice(-2) };
    },
  };
  return "Compiled renderer regression harness ready";
})()
