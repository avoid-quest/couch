// Evaluate in the compiled renderer attached to a real, isolated Core, then call
// couchPlaybackReview.original(mediaUrl). Uses the live SessionGate commands,
// REST endpoints and visible Saved controls; never replaces application state.
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
    return { route: location.pathname + location.search, current: state.currentEntryId, playedBy: !!state.playedBy,
      presentation: state.presentationId, outputs: state.outputs,
      queue: state.queue.map(({ id, title }) => ({ id, title })), toasts: toasts(),
      video: video && { ready: video.readyState, time: video.currentTime, paused: video.paused } };
  };
  const results = [];
  let savedPlaylist;
  const check = (name, ok) => results.push({ name, pass: !!ok, ...observe() });
  const quiet = () => wait(() => !toasts().some(text => text.startsWith("Queued")), "previous queue toast dismissed", 8_000);
  const run = async action => { if (!await gate().run(action)) throw new Error(`Failed command ${action.type}`); await sleep(100); };
  const pause = () => run({ type: "pause", playbackId: gate().state.player.playbackId, paused: true });
  const openSavedList = async id => {
    await page("/saved");
    await wait(() => document.querySelector("a[href='/saved?tab=lists']"), "Lists link");
    await page("/saved?tab=lists");
    await wait(() => document.querySelector(`[data-playlist-id='${id}']`), "saved list row");
    click(`[data-playlist-id='${id}'] button[aria-label^='Open ']`);
    await wait(() => [...document.querySelectorAll("section[aria-label='Lists'] button")].some(node => node.textContent === "Queue"), "saved list detail Queue");
  };
  const queueChannel = async name => {
    await page("/find");
    click("button[aria-label='Open Live TV']");
    await wait(() => document.querySelector(`button[aria-label='Options for ${name}']`), "channel options");
    // Send Enter to the real Radix trigger; T3's click alone doesn't open it.
    document.querySelector(`button[aria-label='Options for ${name}']`).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await wait(() => document.querySelector("[role='menuitem']"), "channel Queue menu");
    click("[role='menuitem']", "Queue");
    await wait(() => toasts().some(text => text.includes(`Queued ${name}`)), "channel confirmation");
  };
  window.couchPlaybackReview = { gate, wait, sleep, click, page, api, toasts, observe, results, check, quiet, run, pause, openSavedList,
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
      await page("/find");
      await wait(() => gate().state.currentEntryId === prefix + "natural-second", "real video naturally advances");
      await pause();
      check("natural advance preserves Find and clears actor", location.pathname === "/find" && !gate().state.playedBy && !gate().state.presentationId);
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
      click("a[href='/now?queue=true']");
      await wait(() => location.pathname + location.search === "/now?queue=true", "Saved Up next link");
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
      click("a[href='/now?queue=true']");
      await wait(() => location.pathname + location.search === "/now?queue=true", "Live TV Up next link");
      check("actual Live TV Up next opens queue", true);
      await quiet();
      const count = gate().state.queue.length;
      const ok = await gate().run({ type: "enqueue", entry: gate().state.queue[0] });
      await sleep(200);
      check("duplicate-ID Queue rejection emits no feedback", !ok && count === gate().state.queue.length && !toasts().some(text => text.startsWith("Queued")));
      return { failures: results.filter(result => !result.pass).length, results };
    },
    async radio(mediaUrl) {
      await page("/find");
      await run({ type: "enqueue", entry: { id: crypto.randomUUID(), title: "Decoded fixture radio", source: mediaUrl, kind: "radio", live: true }, playNow: true, deviceId: gate().identity.device.id });
      await wait(() => document.querySelector("video")?.readyState === 4, "decoded fixture radio");
      check("decoded audio-only radio start preserves Find", location.pathname === "/find" && gate().state.playbacks.find(playback => playback.id === gate().state.playback)?.audioOnly);
      const initial = gate().state.player.playbackId;
      await wait(() => gate().state.radioRetry?.attempt > 0, "radio fixture naturally ends and schedules retry", 12_000);
      await wait(() => gate().state.player.playbackId !== initial && gate().state.presentationId === null && gate().state.player.status === "playing" && document.querySelector("video")?.readyState === 4, "radio retry decodes", 5_000);
      check("actual decoded radio retry preserves Find", location.pathname === "/find");
      await run({ type: "stop", playbackId: gate().state.player.playbackId });
      return { failures: results.slice(-2).filter(result => !result.pass).length, results: results.slice(-2) };
    },
  };
  return "Compiled renderer regression harness ready";
})()
