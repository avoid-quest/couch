import { constants } from "node:fs";
import { access, lstat, opendir, readFile, readdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { FolderBrowse, FolderLocation } from "../shared/folders";

export class FolderError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export type FolderIdentity = { filesystem: string; directory: string; mountRoot: string };
type Mount = { id: string; parent: string; device: string; target: string; root: string; type: string; source: string; options: string[] };
const within = (root: string, path: string) => { const part = relative(root, path); return part !== ".." && !part.startsWith(`..${sep}`) && !isAbsolute(part); };
const unescapeMount = (value: string) => value.replace(/\\(040|011|012|134)/g, (_, code: string) => String.fromCharCode(parseInt(code, 8)));

function mounts(text: string): Mount[] {
  return text.trim().split("\n").filter(Boolean).map(line => {
    const [before, after] = line.split(" - ");
    const fields = before?.split(" "), filesystem = after?.split(" ");
    if (!fields || fields.length < 6 || !filesystem || filesystem.length < 3) throw new FolderError("Could not inspect the TV's mounted filesystems.");
    return { id: fields[0]!, parent: fields[1]!, device: fields[2]!, target: unescapeMount(fields[4]!), root: unescapeMount(fields[3]!), type: filesystem[0]!, source: unescapeMount(filesystem[1]!), options: [...fields[5]!.split(","), ...filesystem[2]!.split(",")] };
  });
}

function visibleMounts(mounted: Mount[]) {
  const byId = new Map(mounted.map(mount => [mount.id, mount]));
  const covered = new Set(mounted.filter(mount => byId.get(mount.parent)?.target === mount.target && mount.parent !== mount.id).map(mount => mount.parent));
  return mounted.filter(mount => {
    if (covered.has(mount.id)) return false;
    const visited = new Set<string>();
    for (let current = mount; !visited.has(current.id);) {
      visited.add(current.id);
      const parent = byId.get(current.parent);
      if (!parent) break;
      if (parent.target !== current.target && covered.has(parent.id)) return false;
      current = parent;
    }
    return true;
  });
}

const linuxDevice = (device: bigint) => `${(device >> 8n & 0xfffn) | (device >> 32n & ~0xfffn)}:${(device & 0xffn) | (device >> 12n & ~0xffn)}`;

function validPath(value: unknown): string {
  if (typeof value !== "string" || !isAbsolute(value) || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value) || value.split(sep).includes("..")) throw new FolderError("Choose a permitted folder on the TV.");
  return resolve(value);
}

function folderError(error: unknown): FolderError {
  if (error instanceof FolderError) return error;
  const code = (error as NodeJS.ErrnoException)?.code;
  return new FolderError(code === "EACCES" || code === "EPERM"
    ? "Couch cannot read this folder. Allow the TV account to read and enter it, then test again."
    : "This folder is unavailable. Reconnect its drive or network mount, then test again.");
}

export function createMediaFolders(options: {
  roots?: string[];
  home?: string;
  mountInfo?: () => Promise<string | null>;
  uuidDirectory?: string;
} = {}) {
  const home = options.home ?? homedir();
  const roots = (options.roots ?? [join(home, "Music"), join(home, "Videos"), "/media", "/mnt"]).map(validPath);
  if (roots.length > 20 || roots.some(root => root === sep)) throw new FolderError("Configure at most 20 specific TV media locations.");
  const mountInfo = options.mountInfo ?? (() => process.platform === "linux" ? readFile("/proc/self/mountinfo", "utf8") : Promise.resolve(null));

  async function permitted(path: string, selectable = false) {
    path = validPath(path);
    if (!roots.some(root => within(root, path)) || selectable && ["/media", "/mnt"].includes(path)) throw new FolderError("Choose a folder inside a permitted TV media location.", 403);
    try {
      const canonical = await realpath(path);
      if (canonical !== path || !(await lstat(path)).isDirectory()) throw new FolderError("Choose a real folder inside a permitted TV media location.");
      await access(path, constants.R_OK | constants.X_OK);
      return path;
    } catch (error) { throw folderError(error); }
  }

  async function identity(path: string): Promise<FolderIdentity> {
    try {
      const info = await lstat(path, { bigint: true });
      if (!info.isDirectory() || await realpath(path) !== path) throw new FolderError("The saved folder has been replaced. Restore the original folder before scanning.");
      await access(path, constants.R_OK | constants.X_OK);
      const table = await mountInfo();
      if (table === null) return { filesystem: `device:${info.dev}`, directory: String(info.ino), mountRoot: "" };
      const mounted = visibleMounts(mounts(table));
      const mount = mounted.filter(candidate => candidate.device === linuxDevice(info.dev) && within(candidate.target, path)).sort((a, b) => b.target.length - a.target.length)[0];
      if (!mount) throw new FolderError("Could not identify this folder's filesystem.");
      if (mounted.some(candidate => candidate.target !== path && within(path, candidate.target))) throw new FolderError("This folder contains another mounted filesystem. Add the mounted folder as its own source instead.");
      let filesystem: string;
      if (mount.source.startsWith("/dev/")) {
        const device = await realpath(mount.source);
        const uuidDirectory = options.uuidDirectory ?? "/dev/disk/by-uuid";
        const uuids = await readdir(uuidDirectory).catch(() => []);
        let uuid: string | undefined;
        for (const name of uuids) if (await realpath(join(uuidDirectory, name)).catch(() => null) === device) { uuid = name; break; }
        if (!uuid) throw new FolderError("This drive has no readable filesystem UUID. Mount a drive with a stable filesystem identity before adding it.");
        filesystem = `uuid:${uuid}`;
      } else if (["nfs", "nfs4", "cifs", "smb3"].includes(mount.type)) filesystem = `${mount.type}:${mount.source}`;
      else filesystem = `${mount.type}:${info.dev}`;
      // CIFS without serverino generates a new client inode after remounting the same export.
      const clientInodes = ["cifs", "smb3"].includes(mount.type) && (!mount.options.includes("serverino") || mount.options.includes("noserverino"));
      return { filesystem, directory: clientInodes ? "" : String(info.ino), mountRoot: join(mount.root, relative(mount.target, path)) };
    } catch (error) { throw folderError(error); }
  }

  return {
    async browse(path: string | null = null, offset = 0): Promise<FolderBrowse> {
      if (!Number.isInteger(offset) || offset < 0 || offset > 100_000) throw new FolderError("Invalid folder page.");
      if (path === null) {
        const locations = await Promise.all(roots.map(async root => {
          const location: FolderLocation = { name: basename(root), path: root, selectable: !["/media", "/mnt"].includes(root) };
          try { await permitted(root); } catch (error) { location.error = folderError(error).message; }
          return location;
        }));
        return { path: null, parent: null, locations, offset: 0, more: false };
      }
      path = await permitted(path);
      try {
        const entries = await opendir(path);
        const locations: FolderLocation[] = [];
        let seen = 0, more = false;
        for await (const entry of entries) {
          if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith(".")) continue;
          if (seen++ < offset) continue;
          if (locations.length === 100) { more = true; break; }
          locations.push({ name: entry.name, path: join(path, entry.name), selectable: true });
        }
        return { path, parent: roots.includes(path) ? null : dirname(path), locations, offset, more };
      } catch (error) { throw folderError(error); }
    },
    async inspect(path: string) { path = await permitted(path, true); return { path, identity: await identity(path) }; },
    async verify(path: string, expected: FolderIdentity) {
      const actual = await identity(path);
      if (actual.filesystem !== expected.filesystem || actual.directory !== expected.directory || actual.mountRoot !== expected.mountRoot) throw new FolderError("The original drive or folder is unavailable. Restore it before scanning; the saved catalog has been kept.");
      return actual;
    },
  };
}

export type MediaFolders = ReturnType<typeof createMediaFolders>;
