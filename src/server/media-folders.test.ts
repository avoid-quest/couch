import { afterEach, expect, test } from "bun:test";
import { chmod, lstat, mkdir, mkdtemp, realpath, rename, rm, symlink, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMediaFolders } from "./media-folders";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });
async function deviceFor(path: string) {
  const { dev } = await lstat(path, { bigint: true });
  return `${(dev >> 8n & 0xfffn) | (dev >> 32n & ~0xfffn)}:${(dev & 0xffn) | (dev >> 12n & ~0xffn)}`;
}

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "couch-folders-")));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const media = join(root, "media");
  await mkdir(media);
  const folders = createMediaFolders({ roots: [media], mountInfo: async () => null });
  return { root, media, folders };
}

test("browse stays inside permitted real folders and never lists files or symlinks", async () => {
  const { root, media, folders } = await fixture();
  await mkdir(join(media, "Albums"));
  await mkdir(join(root, "private"));
  await Bun.write(join(media, "Movie.mkv"), "fixture");
  await symlink(join(root, "private"), join(media, "shortcut"));
  expect((await folders.browse()).locations).toEqual([{ name: "media", path: media, selectable: true }]);
  expect((await folders.browse(media)).locations).toEqual([{ name: "Albums", path: join(media, "Albums"), selectable: true }]);
  expect((await folders.browse(join(media, "Albums"))).parent).toBe(media);
  expect((await folders.browse(media)).parent).toBeNull();
  await expect(folders.browse(root)).rejects.toThrow("permitted");
  await expect(folders.inspect(join(media, "shortcut"))).rejects.toThrow("real folder");
  await expect(folders.inspect(`${media}/../private`)).rejects.toThrow("permitted");
  await expect(folders.inspect(`${media}\n`)).rejects.toThrow("permitted");
  expect(() => createMediaFolders({ roots: ["/"] })).toThrow("specific TV media");
});

test("folder pages retain bounded results and expose the next page", async () => {
  const { media, folders } = await fixture();
  await Promise.all(Array.from({ length: 103 }, (_, index) => mkdir(join(media, `album-${index}`))));
  const first = await folders.browse(media);
  const second = await folders.browse(media, 100);
  expect(first.locations).toHaveLength(100);
  expect(first.more).toBe(true);
  expect(second.locations).toHaveLength(3);
  expect(second.more).toBe(false);
  expect(new Set([...first.locations, ...second.locations].map(item => item.path)).size).toBe(103);
  await expect(folders.browse(media, -1)).rejects.toThrow("page");
});

test("missing folders and empty replacement directories fail until the original returns", async () => {
  const { root, media, folders } = await fixture();
  const original = await folders.inspect(media);
  await rename(media, join(root, "original-drive"));
  await expect(folders.verify(media, original.identity)).rejects.toThrow("unavailable");
  await mkdir(media);
  await expect(folders.verify(media, original.identity)).rejects.toThrow("original drive or folder");
  await rm(media, { recursive: true });
  await rename(join(root, "original-drive"), media);
  expect(await folders.verify(media, original.identity)).toEqual(original.identity);
});

test("permission failures remain actionable and recover after access is restored", async () => {
  const { root, media, folders } = await fixture();
  const original = await folders.inspect(media);
  await chmod(media, 0o000);
  try {
    if (process.getuid?.() === 0) {
      await chmod(root, 0o755);
      const child = Bun.spawn([process.execPath, "--eval", `import {createMediaFolders} from ${JSON.stringify(join(import.meta.dir, "media-folders.ts"))};
        const folders = createMediaFolders({roots:[${JSON.stringify(media)}],mountInfo:async()=>null});
        const failure = await folders.inspect(${JSON.stringify(media)}).then(()=>null,error=>error.message);
        console.log(JSON.stringify({failure,browse:(await folders.browse()).locations[0]?.error}));`], { uid: 65534, gid: 65534, stdout: "pipe", stderr: "pipe" });
      const result = await new Response(child.stdout).json();
      expect(await child.exited).toBe(0);
      expect(result.failure).toContain("read and enter");
      expect(result.browse).toContain("read and enter");
    } else {
      await expect(folders.inspect(media)).rejects.toThrow("read and enter");
      expect((await folders.browse()).locations[0]?.error).toContain("read and enter");
    }
  } finally { await chmod(media, 0o700); }
  expect(await folders.verify(media, original.identity)).toEqual(original.identity);
});

test("filesystem UUID survives changed Linux mount IDs and device names", async () => {
  const { root, media } = await fixture();
  const uuidDirectory = join(root, "by-uuid");
  await mkdir(uuidDirectory);
  await symlink("/dev/null", join(uuidDirectory, "same-filesystem"));
  const device = await deviceFor(media);
  let mountInfo = `18 1 ${device} / ${media} rw - ext4 /dev/null rw`;
  const folders = createMediaFolders({ roots: [media], uuidDirectory, mountInfo: async () => mountInfo });
  const original = await folders.inspect(media);
  expect(original.identity.filesystem).toBe("uuid:same-filesystem");
  await unlink(join(uuidDirectory, "same-filesystem"));
  await symlink("/dev/zero", join(uuidDirectory, "same-filesystem"));
  mountInfo = `44 2 ${device} / ${media} rw shared:3 - ext4 /dev/zero rw`;
  expect(await folders.verify(media, original.identity)).toEqual(original.identity);
  await rename(join(uuidDirectory, "same-filesystem"), join(uuidDirectory, "replacement-filesystem"));
  await expect(folders.verify(media, original.identity)).rejects.toThrow("original drive or folder");
});

test("mounted shares recover with new mount IDs but a different export is rejected", async () => {
  const { media } = await fixture();
  const device = await deviceFor(media);
  let mountInfo = `18 1 ${device} / ${media} rw - nfs4 nas:/movies rw`;
  const folders = createMediaFolders({ roots: [media], mountInfo: async () => mountInfo });
  const original = await folders.inspect(media);
  mountInfo = `66 4 ${device} / ${media} rw shared:9 - nfs4 nas:/movies rw`;
  expect(await folders.verify(media, original.identity)).toEqual(original.identity);
  mountInfo = `67 4 ${device} / ${media} rw - nfs4 nas:/other rw`;
  await expect(folders.verify(media, original.identity)).rejects.toThrow("original drive or folder");
});

test("nested mounts require separate sources, including mounts added after registration", async () => {
  const { media } = await fixture();
  const nested = join(media, "share");
  await mkdir(nested);
  const device = await deviceFor(media);
  let mountInfo = `18 1 ${device} / ${media} rw - nfs4 nas:/movies rw`;
  const folders = createMediaFolders({ roots: [media], mountInfo: async () => mountInfo });
  const original = await folders.inspect(media);
  mountInfo += `\n22 18 ${device} / ${nested} rw - cifs //nas/music rw`;
  await expect(folders.verify(media, original.identity)).rejects.toThrow("own source");
  await expect(folders.inspect(media)).rejects.toThrow("own source");
  expect((await folders.inspect(nested)).identity.filesystem).toBe("cifs://nas/music");
});

test("Linux mountpoint escapes resolve to the chosen path", async () => {
  const { media } = await fixture();
  const folder = join(media, "Shared music");
  await mkdir(folder);
  const device = await deviceFor(folder);
  const folders = createMediaFolders({ roots: [media], mountInfo: async () => `18 1 ${device} / ${folder.replaceAll(" ", "\\040")} rw - nfs4 nas:/music rw` });
  expect((await folders.inspect(folder)).identity.mountRoot).toBe("/");
});

test("same-path overmount uses the visible filesystem even when directory inodes collide", async () => {
  const { root, media } = await fixture();
  const device = await deviceFor(media);
  const uuidDirectory = join(root, "by-uuid");
  await mkdir(uuidDirectory);
  await symlink("/dev/null", join(uuidDirectory, "original"));
  await symlink("/dev/zero", join(uuidDirectory, "replacement"));
  const lower = `18 1 ${device} / ${media} rw - ext4 /dev/null rw`;
  const upper = `22 18 ${device} / ${media} rw - ext4 /dev/zero rw`;
  let mountInfo = lower;
  const folders = createMediaFolders({ roots: [media], uuidDirectory, mountInfo: async () => mountInfo });
  const original = await folders.inspect(media);
  // The local directory deliberately stays unchanged, reproducing colliding root inodes.
  for (const lines of [[lower, upper], [upper, lower]]) {
    mountInfo = lines.join("\n");
    await expect(folders.verify(media, original.identity)).rejects.toThrow("original drive or folder");
    expect((await folders.inspect(media)).identity.filesystem).toBe("uuid:replacement");
  }
  mountInfo = lower;
  expect(await folders.verify(media, original.identity)).toEqual(original.identity);
});

test("hidden descendants of an overmounted parent neither win selection nor block a scan", async () => {
  const { media } = await fixture();
  const nested = join(media, "share");
  await mkdir(nested);
  const device = await deviceFor(media);
  const folders = createMediaFolders({ roots: [media], mountInfo: async () => [
    `18 1 ${device} / ${media} rw - nfs4 nas:/old rw`,
    `19 18 ${device} / ${nested} rw - nfs4 nas:/hidden rw`,
    `22 18 ${device} / ${media} rw - nfs4 nas:/visible rw`,
  ].join("\n") });
  expect((await folders.inspect(media)).identity.filesystem).toBe("nfs4:nas:/visible");
  expect((await folders.inspect(nested)).identity).toMatchObject({ filesystem: "nfs4:nas:/visible", mountRoot: "/share" });
});

test("mount topology must also agree with the directory's current device", async () => {
  const { media } = await fixture();
  const folders = createMediaFolders({ roots: [media], mountInfo: async () => `18 1 999999:999999 / ${media} rw - nfs4 nas:/old rw` });
  await expect(folders.inspect(media)).rejects.toThrow("identify");
});

test("CIFS client inode changes recover only for the same mounted export and path", async () => {
  const { root, media } = await fixture();
  const device = await deviceFor(media);
  let mountInfo = `18 1 ${device} / ${media} rw - cifs //nas/movies rw,noserverino`;
  const folders = createMediaFolders({ roots: [media], mountInfo: async () => mountInfo });
  const original = await folders.inspect(media);
  const previousInode = (await lstat(media)).ino;
  await rename(media, join(root, "old-client-inode"));
  await mkdir(media);
  expect((await lstat(media)).ino).not.toBe(previousInode);
  mountInfo = `44 1 ${device} / ${media} rw - cifs //nas/movies rw`;
  expect(await folders.verify(media, original.identity)).toEqual(original.identity);
  mountInfo = `44 1 ${device} / ${media} rw - cifs //nas/replacement rw`;
  await expect(folders.verify(media, original.identity)).rejects.toThrow("original drive or folder");
  mountInfo = `44 1 ${device} /other ${media} rw - cifs //nas/movies rw`;
  await expect(folders.verify(media, original.identity)).rejects.toThrow("original drive or folder");
});
