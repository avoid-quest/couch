import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import WebSocket from "ws";
import { createHub } from "../src/server/hub";
import { openStore } from "../src/server/store";
import type { Action, ServerMessage, SessionState } from "../src/shared/protocol";
import { applyUndo, undoPlan } from "../src/client/session/undo";
import { withState } from "./whole-state.fixture";

const hostId = "h".repeat(43),
  phoneId = "p".repeat(43),
  speakerId = "s".repeat(43),
  hostToken = "h".repeat(64);

async function until(predicate: () => boolean) {
  const deadline = Date.now() + 3_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Expected server selection was not published.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "couch-server-selection-")),
    databasePath = join(directory, "couch.sqlite");
  const store = openStore(databasePath, true);
  const phoneToken = store.pair(phoneId, "Phone"),
    speakerToken = store.pair(speakerId, "Speaker");
  store.close();
  // Hold resolution until shutdown so routing tests never start a decoder or fetch external media.
  const source = createServer(() => {});
  await new Promise<void>((resolve) => source.listen(0, "127.0.0.1", resolve));
  const address = source.address();
  assert.ok(address && typeof address === "object");
  const hub = await createHub({ databasePath, hostToken, hostname: "127.0.0.1", port: 0 });
  const sockets: WebSocket[] = [];
  async function connect(token: string, id: string, sharing = "") {
    const socket = new WebSocket(
      `${hub.origin.replace("http:", "ws:")}/api/ws?token=${token}&device=${id}${sharing}`,
      { headers: { Origin: hub.origin } },
    );
    sockets.push(socket);
    const pending = new Map<
      string,
      (message: Extract<ServerMessage, { type: "result" }>) => void
    >();
    let state: SessionState | undefined,
      sequence = 0;
    await new Promise<void>((resolve, reject) => {
      socket.once("error", reject);
      socket.onmessage = (event) => {
        const message = withState(socket, JSON.parse(String(event.data)) as ServerMessage);
        if (message.type === "state") {
          state = message.state;
          resolve();
        }
        if (message.type === "result") {
          pending.get(message.requestId)?.(message);
          pending.delete(message.requestId);
        }
      };
    });
    return {
      socket,
      get state() {
        return state!;
      },
      command: (action: Action, targetDeviceId?: string) =>
        new Promise<void>((resolve, reject) => {
          const requestId = String(++sequence);
          pending.set(requestId, (message) =>
            message.ok ? resolve() : reject(new Error(message.error)),
          );
          socket.send(JSON.stringify({ type: "command", requestId, action, targetDeviceId }));
        }),
    };
  }
  const host = await connect(hostToken, hostId, "&tv=1"),
    phone = await connect(phoneToken, phoneId),
    speaker = await connect(speakerToken, speakerId, "&audio=1&video=1");
  const entry = (id: string) => ({
    id,
    title: id,
    source: `http://127.0.0.1:${address.port}/media`,
  });
  return {
    hub,
    host,
    phone,
    speaker,
    rest: async (path: string, body?: unknown, token = phoneToken) => {
      const response = await fetch(`${hub.origin}${path}`, {
        method: body === undefined ? "DELETE" : "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      return result;
    },
    entry,
    play: (controller: typeof phone, id: string, deviceId: string) =>
      controller.command({ type: "enqueue", entry: entry(id), playNow: true, deviceId }),
    reconnect: async () => {
      phone.socket.close();
      await until(() => phone.socket.readyState === WebSocket.CLOSED);
      return connect(phoneToken, phoneId);
    },
    close: async () => {
      for (const socket of sockets) socket.terminate();
      await hub.close();
      source.closeAllConnections();
      await new Promise<void>((resolve) => source.close(() => resolve()));
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("a controller picks a running Playback and keeps its selection when a private pick is refused", async () => {
  const f = await fixture();
  try {
    await f.play(f.phone, "film", phoneId);
    await until(() => f.phone.state.currentEntryId === "film");
    const film = f.phone.state.playback!;
    await f.play(f.speaker, "radio", speakerId);
    await until(() => f.speaker.state.currentEntryId === "radio");
    const radio = f.speaker.state.playback!;

    await f.phone.command({ type: "control", deviceId: hostId });
    await f.phone.command({ type: "selectPlayback", playbackId: radio }, hostId);
    await f.phone.command({ type: "control", deviceId: null });
    await until(() => f.phone.state.playback === radio);
    assert.equal(f.phone.state.controlling, speakerId);

    await assert.rejects(
      f.speaker.command({ type: "selectPlayback", playbackId: film }),
      /not sharing its outputs/,
    );
    await f.speaker.command({ type: "enqueue", entry: f.entry("next") });
    await until(() => f.phone.state.queue.some((entry) => entry.id === "next"));
    assert.equal(f.speaker.state.playback, radio);
    assert.equal(f.speaker.state.controlling, speakerId);

    await f.phone.command({ type: "stop" });
    await until(() => f.phone.state.currentEntryId === "film" && !f.speaker.state.currentEntryId);
    await assert.rejects(
      f.phone.command({ type: "selectPlayback", playbackId: radio }),
      /no longer running/,
    );
    assert.equal(f.phone.state.controlling, phoneId);
  } finally {
    await f.close();
  }
});

test("Stop returns to this Device's film and Undo returns to the stopped Playback", async () => {
  const f = await fixture();
  try {
    await f.play(f.phone, "film", phoneId);
    await until(() => f.phone.state.currentEntryId === "film");
    const film = f.phone.state.playback;
    await f.play(f.phone, "radio", speakerId);
    await until(() => f.phone.state.currentEntryId === "radio");
    const radio = f.phone.state;
    const stoppedId = radio.player.playbackId!;
    await f.play(f.host, "newer", hostId);
    await f.phone.command({ type: "stop" });
    await until(() => f.phone.state.playback === film);
    assert.equal(f.phone.state.controlling, phoneId);
    assert.equal(f.phone.state.currentEntryId, "film");
    const undo = undoPlan({ type: "stop", playbackId: stoppedId }, radio, f.phone.state);
    assert.ok(undo);
    await applyUndo(undo, f.phone.command, () => f.phone.state);
    await until(
      () => f.phone.state.playback === radio.playback && f.phone.state.currentEntryId === "radio",
    );
    assert.equal(f.phone.state.controlling, speakerId);
    assert.notEqual(f.phone.state.player.playbackId, stoppedId);
    await assert.rejects(f.phone.command({ type: "undoStop", stoppedId }));
  } finally {
    await f.close();
  }
});

test("an ended Playback returns to the newest running Playback the controller may control", async () => {
  const f = await fixture();
  try {
    await f.play(f.host, "shared", hostId);
    await f.play(f.speaker, "newer", speakerId);
    for (const expected of ["newer", "shared"]) {
      await f.play(f.phone, "ended", phoneId);
      await f.phone.command({ type: "remove", entryId: "ended" });
      await until(() => f.phone.state.currentEntryId === expected);
      assert.equal(f.phone.state.controls?.programme, true);
      await f.speaker.command({ type: "sharing", sharing: { audio: false, video: false } });
    }
  } finally {
    await f.close();
  }
});

test("leaving Remote or closing its window restores the previously controlled Playback", async () => {
  const f = await fixture();
  try {
    await f.play(f.phone, "here", phoneId);
    await f.play(f.phone, "film", speakerId);
    await until(() => f.phone.state.currentEntryId === "film");
    const film = f.phone.state.playback;
    await f.phone.command({ type: "control", deviceId: hostId });
    await until(() => f.phone.state.controlling === hostId);
    await f.phone.command({ type: "control", deviceId: null });
    await until(() => f.phone.state.playback === film);
    assert.equal(f.phone.state.controlling, speakerId);
    await f.phone.command({ type: "control", deviceId: hostId });
    await until(() => f.phone.state.controlling === hostId);
    const returned = await f.reconnect();
    assert.equal(returned.state.playback, film);
    assert.equal(returned.state.controlling, speakerId);
    await returned.command({ type: "control", deviceId: hostId });
    await f.speaker.command({ type: "remove", entryId: "film" });
    await returned.command({ type: "control", deviceId: null });
    await until(() => returned.state.currentEntryId === "here");
  } finally {
    await f.close();
  }
});

test("leaving Remote never hands a window a Playback it did not control before", async () => {
  const f = await fixture();
  try {
    await f.play(f.speaker, "elsewhere", speakerId);
    await until(() => !!f.phone.state.playbacks?.some((item) => item.title === "elsewhere"));
    const idle = f.phone.state.playback;
    await f.phone.command({ type: "control", deviceId: hostId });
    await f.phone.command({ type: "control", deviceId: null });
    await new Promise((resolve) => setTimeout(resolve, 200));
    // Still nothing chosen: the Couch's own Device, and what an idle window looks at.
    assert.equal(f.phone.state.controlling, hostId);
    assert.equal(f.phone.state.playback, idle);
  } finally {
    await f.close();
  }
});

test("an idle window reaches what plays elsewhere, and its Play still starts on the Couch", async () => {
  const f = await fixture();
  try {
    await f.play(f.speaker, "elsewhere", speakerId);
    await until(() => f.phone.state.currentEntryId === "elsewhere");
    assert.equal(f.phone.state.controls?.programme, true);
    // The Couch's own window, a TV, keeps to its own Playback.
    assert.equal(f.host.state.playback, null);
    await f.phone.command({ type: "enqueue", entry: f.entry("film"), playNow: true });
    await until(() => f.phone.state.currentEntryId === "film");
    assert.deepEqual(
      f.phone.state.outputs?.map((output) => output.deviceId),
      [hostId],
    );
  } finally {
    await f.close();
  }
});

test("unpairing a Playback's last receiver releases it even when nothing else plays", async () => {
  const f = await fixture();
  try {
    await f.play(f.phone, "film", speakerId);
    await f.rest(`/api/devices/${speakerId}`, undefined, hostToken);
    await until(() => f.phone.state.devices?.some((device) => device.id === speakerId) === false);
    assert.equal(f.phone.state.controlling, hostId);
  } finally {
    await f.close();
  }
});

test(
  "controllers start on server outputs and return to their selected live mix",
  { timeout: 15_000 },
  async () => {
    const f = await fixture();
    try {
      assert.equal(f.phone.state.controlling, hostId);
      await f.phone.command({
        type: "enqueue",
        entry: f.entry("mix"),
        playNow: true,
        deviceId: speakerId,
      });
      await f.phone.command({ type: "output", deviceId: hostId, level: 30 });
      await until(
        () => f.phone.state.controlling === speakerId && f.phone.state.outputs?.length === 2,
      );
      const playback = f.phone.state.playback;
      const returned = await f.reconnect();
      assert.equal(returned.state.controlling, speakerId);
      assert.equal(returned.state.playback, playback);
      assert.deepEqual(
        returned.state.outputs?.map((output) => output.deviceId),
        [speakerId, hostId],
      );
    } finally {
      await f.close();
    }
  },
);

test(
  "reconnecting to a selection that went idle falls back to the server's default outputs",
  { timeout: 15_000 },
  async () => {
    const f = await fixture();
    try {
      await f.phone.command({
        type: "enqueue",
        entry: f.entry("ended"),
        playNow: true,
        deviceId: speakerId,
      });
      await f.phone.command({ type: "remove", entryId: "ended" });
      await until(() => !f.phone.state.playbacks?.length);
      assert.equal(f.phone.state.controlling, speakerId);
      assert.equal((await f.reconnect()).state.controlling, hostId);
    } finally {
      await f.close();
    }
  },
);

test(
  "ordinary Play keeps a mix and explicit Play on isolates only its named output",
  { timeout: 15_000 },
  async () => {
    const f = await fixture();
    try {
      await f.phone.command({ type: "enqueue", entry: f.entry("waiting") });
      await f.phone.command({ type: "output", deviceId: speakerId, level: 30 });
      await until(() => f.phone.state.outputs?.length === 2);
      const mix = f.phone.state.playback;
      await f.phone.command({ type: "enqueue", entry: f.entry("ordinary"), playNow: true });
      await until(() => f.phone.state.currentEntryId === "ordinary");
      assert.equal(f.phone.state.playback, mix);
      assert.deepEqual(
        f.phone.state.outputs?.map((output) => output.deviceId),
        [hostId, speakerId],
      );
      await f.phone.command({
        type: "enqueue",
        entry: f.entry("explicit"),
        playNow: true,
        deviceId: hostId,
      });
      await until(() => f.phone.state.currentEntryId === "explicit");
      assert.equal(f.phone.state.controlling, hostId);
      assert.notEqual(f.phone.state.playback, mix);
      assert.deepEqual(
        f.phone.state.outputs?.map((output) => output.deviceId),
        [hostId],
      );
      assert.deepEqual(
        f.phone.state.playbacks
          ?.find((playback) => playback.id === mix)
          ?.outputs.map((output) => output.deviceId),
        [speakerId],
      );
      // The host's own window follows its Device into the new Playback.
      assert.equal(f.host.state.controlling, hostId);
      await until(() => f.host.state.playback === f.phone.state.playback);
    } finally {
      await f.close();
    }
  },
);

test(
  "a Play on whose item fails, now or after loading, leaves its target in the mix and the selection as it was",
  { timeout: 15_000 },
  async () => {
    const f = await fixture();
    try {
      await f.phone.command({ type: "enqueue", entry: f.entry("waiting") });
      await f.phone.command({ type: "output", deviceId: speakerId, level: 30 });
      await until(() => f.phone.state.outputs?.length === 2);
      const mix = f.phone.state.playback;
      const failures = [
        () =>
          f.phone.command({
            type: "enqueueRadio",
            stationId: "missing",
            entryId: "radio",
            playNow: true,
            deviceId: speakerId,
          }),
        // A provider list fails only once it has loaded.
        () =>
          f.phone.command({
            type: "enqueueProvider",
            provider: "bandcamp",
            url: "https://example.com/not-an-album",
            shape: "playlist",
            playNow: true,
            deviceId: speakerId,
          }),
        () =>
          f.rest(`/api/progress/media:${"0".repeat(64)}/play?on=${speakerId}`, {
            profileId: f.phone.state.activeProfile.id,
          }),
      ];
      for (const failure of failures) {
        await assert.rejects(failure());
        assert.equal(f.phone.state.controlling, hostId);
        assert.equal(f.phone.state.playback, mix);
        assert.deepEqual(
          f.phone.state.playbacks?.map((playback) =>
            playback.outputs.map((output) => output.deviceId),
          ),
          [[hostId, speakerId]],
        );
      }
    } finally {
      await f.close();
    }
  },
);

test(
  "Play falls back to the actor's own Device while the server's outputs are offline",
  { timeout: 15_000 },
  async () => {
    const f = await fixture();
    try {
      f.host.socket.close();
      await until(
        () => f.phone.state.devices?.find((device) => device.id === hostId)?.online === false,
      );
      await f.phone.command({ type: "enqueue", entry: f.entry("here"), playNow: true });
      await until(() => f.phone.state.currentEntryId === "here");
      assert.equal(f.phone.state.controlling, phoneId);
      assert.deepEqual(
        f.phone.state.outputs?.map((output) => output.deviceId),
        [phoneId],
      );
    } finally {
      await f.close();
    }
  },
);

test(
  "Playback titles follow the outputs each device may control as sharing changes",
  { timeout: 15_000 },
  async () => {
    const f = await fixture();
    try {
      await f.phone.command({
        type: "enqueue",
        entry: f.entry("first"),
        playNow: true,
        deviceId: speakerId,
      });
      await f.speaker.command({
        type: "enqueueWeb",
        entryId: "film",
        title: "film",
        url: f.entry("film").source,
        thumbnail: "https://example.com/film.jpg",
        playNow: true,
        deviceId: speakerId,
      });
      await until(() => f.phone.state.currentEntryId === "film");
      const summary = (state: SessionState) =>
        state.playbacks?.find((item) =>
          item.outputs.some((output) => output.deviceId === speakerId),
        );
      assert.equal(summary(f.phone.state)?.title, "film");
      assert.equal(summary(f.phone.state)?.thumbnail, "https://example.com/film.jpg");
      assert.equal(summary(f.phone.state)?.private, undefined);

      await f.speaker.command({ type: "sharing", sharing: { audio: true, video: false } });
      await until(() => !!summary(f.phone.state)?.private && !!summary(f.host.state)?.private);
      for (const viewer of [f.phone, f.host]) {
        assert.equal("title" in summary(viewer.state)!, false);
        assert.equal("thumbnail" in summary(viewer.state)!, false);
        assert.equal(summary(viewer.state)?.private, true);
      }
      assert.equal(summary(f.speaker.state)?.title, "film");
      assert.equal(summary(f.speaker.state)?.private, undefined);
      // The phone still selects this device for its shared speakers, but the film uses its private screen too.
      assert.equal(f.phone.state.controlling, speakerId);
      await until(() => !f.phone.state.queue.length);
      await assert.rejects(f.rest("/api/playlists", { name: "Copy" }), /not sharing its outputs/);

      await f.speaker.command({ type: "sharing", sharing: { audio: true, video: true } });
      await until(
        () => f.phone.state.currentEntryId === "film" && summary(f.host.state)?.title === "film",
      );
      assert.equal(summary(f.phone.state)?.title, "film");
      assert.equal(summary(f.phone.state)?.private, undefined);
    } finally {
      await f.close();
    }
  },
);

test(
  "explicit Play on cannot replace a target's private video while its audio is shared",
  { timeout: 15_000 },
  async () => {
    const f = await fixture();
    try {
      await f.speaker.command({ type: "sharing", sharing: { audio: true, video: false } });
      await f.phone.command({ type: "enqueue", entry: f.entry("waiting") });
      await f.speaker.command({ type: "output", deviceId: speakerId, picture: true, level: 30 });
      await until(
        () =>
          f.phone.state.outputs?.length === 2 &&
          f.phone.state.outputs.some(
            (output) => output.deviceId === speakerId && output.picture && output.local,
          ),
      );
      const mix = f.phone.state.playback;
      await assert.rejects(
        f.phone.command({
          type: "enqueue",
          entry: f.entry("forbidden"),
          playNow: true,
          deviceId: speakerId,
        }),
        /not sharing video/,
      );
      assert.equal(f.phone.state.playback, mix);
      assert.deepEqual(
        f.phone.state.outputs?.map((output) => output.deviceId),
        [hostId, speakerId],
      );
      assert.equal(
        f.phone.state.outputs?.find((output) => output.deviceId === speakerId)?.picture,
        true,
      );
      await f.phone.command({ type: "volume", deviceId: speakerId, volume: 40 });
      await until(
        () => f.phone.state.devices?.find((device) => device.id === speakerId)?.volume === 40,
      );
    } finally {
      await f.close();
    }
  },
);

test(
  "Play on starts where it was chosen, and refuses a channel a device doesn't lend before anything moves",
  { timeout: 15_000 },
  async () => {
    const f = await fixture();
    try {
      await f.phone.command({
        type: "enqueue",
        entry: f.entry("chosen"),
        playNow: true,
        deviceId: speakerId,
        outputs: [
          { deviceId: speakerId, picture: true, sound: false },
          { deviceId: phoneId, picture: false, sound: true },
        ],
      });
      await until(() => f.phone.state.currentEntryId === "chosen");
      const chosen = f.phone.state.playback;
      assert.equal(f.phone.state.controlling, speakerId);
      assert.deepEqual(
        f.phone.state.outputs?.map(({ deviceId, picture, sound }) => ({
          deviceId,
          picture,
          sound,
        })),
        [
          { deviceId: speakerId, picture: true, sound: false },
          { deviceId: phoneId, picture: false, sound: true },
        ],
      );
      await f.speaker.command({ type: "sharing", sharing: { audio: true, video: false } });
      await assert.rejects(
        f.phone.command({
          type: "enqueue",
          entry: f.entry("refused"),
          playNow: true,
          deviceId: phoneId,
          outputs: [
            { deviceId: phoneId, picture: false, sound: true },
            { deviceId: speakerId, picture: true, sound: false },
          ],
        }),
        /not sharing video/,
      );
      assert.equal(f.phone.state.playback, chosen);
      assert.equal(f.phone.state.currentEntryId, "chosen");
    } finally {
      await f.close();
    }
  },
);

for (const [how, end] of [
  [
    "withdrawing consent",
    (f: Awaited<ReturnType<typeof fixture>>) =>
      f.speaker.command({ type: "sharing", sharing: { audio: false, video: false } }),
  ],
  [
    "unpairing",
    (f: Awaited<ReturnType<typeof fixture>>) =>
      f.rest(`/api/devices/${speakerId}`, undefined, hostToken),
  ],
] as const)
  test(
    `${how} moves a target's controllers to the rest of its mix`,
    { timeout: 15_000 },
    async () => {
      const f = await fixture();
      try {
        await f.phone.command({
          type: "enqueue",
          entry: f.entry("mix"),
          playNow: true,
          deviceId: speakerId,
        });
        await f.phone.command({ type: "output", deviceId: phoneId, level: 30 });
        await until(() => f.phone.state.outputs?.length === 2);
        const mix = f.phone.state.playback;
        await end(f);
        await until(() => f.phone.state.outputs?.length === 1);
        assert.equal(f.phone.state.controlling, phoneId);
        assert.equal(f.phone.state.playback, mix);
        assert.deepEqual(
          f.phone.state.outputs?.map((output) => output.deviceId),
          [phoneId],
        );
      } finally {
        await f.close();
      }
    },
  );
