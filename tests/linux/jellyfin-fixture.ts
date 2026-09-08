import { chmod, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

/** Official startup API: https://jellyfin.org/docs/general/installation/container/ */
export async function startJellyfinFixture({ root, image, artifacts, continuity }: { root: string; image: string; artifacts: string; continuity?: { fixtures: string; tracks: string } }) {
  const name = `couch-jellyfin-${crypto.randomUUID().slice(0, 8)}`;
  const directory = resolve(artifacts, name);
  const configPath = join(directory, "connection.json");
  const media = join(directory, "media");
  const dockerConfig = join(directory, "docker-config");
  const jellyfinImage = "jellyfin/jellyfin:10.11.11";
  let networkCreated = false;
  let containerCreated = false;
  let docker = ["docker"];
  async function run(args: string[]) {
    const child = Bun.spawn([...docker, ...args], { cwd: root, stdout: "pipe", stderr: "inherit" });
    const output = await new Response(child.stdout).text();
    if (await child.exited !== 0) throw new Error(`Jellyfin fixture Docker ${args[0]} failed.`);
    return output.trim();
  }
  async function close() {
    let failure: unknown;
    if (containerCreated) try { await run(["rm", "--force", name]); containerCreated = false; } catch (error) { failure = error; }
    if (networkCreated) try { await run(["network", "rm", name]); networkCreated = false; } catch (error) { failure = error; }
    await rm(configPath, { force: true });
    if (failure) throw failure;
  }
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await mkdir(dockerConfig, { mode: 0o700 });
    // Public-image pulls need no registry credentials. Keep the selected local Docker daemon.
    const endpoint = process.env.DOCKER_HOST || await run(["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"]);
    docker = ["docker", "--config", dockerConfig, "--host", endpoint];
    const generated = continuity?.fixtures ?? join(directory, "generated");
    if (!continuity) {
      await mkdir(generated);
      await run(["run", "--rm", "--mount", `type=bind,source=${root},target=/source,readonly`, "--mount", `type=bind,source=${generated},target=/mnt/fixtures`, image, "bun", "/source/tests/linux/fixtures.ts"]);
    }
    for (const [folder, filename] of [["Movies/Fixture", "multitrack.mkv"], ["Music/Fixture/Fixture", "radio.mp3"]] as const) {
      await mkdir(join(media, folder), { recursive: true });
      await Bun.write(join(media, folder, filename), Bun.file(join(generated, filename)));
    }
    await Bun.write(join(media, "Movies/Fixture/multitrack.ita.srt"), Bun.file(join(generated, "jellyfin-italian.srt")));
    if (continuity) {
      await mkdir(join(media, "Music/Continuity"), { recursive: true });
      for (const part of [1, 2]) await Bun.write(join(media, `Music/Continuity/part-${part}.flac`), Bun.file(join(continuity.tracks, `part-${part}.flac`)));
    }
    await run(["pull", jellyfinImage]);
    await run(["network", "create", name]);
    networkCreated = true;
    containerCreated = true;
    await run(["run", "--detach", "--name", name, "--network", name, "--network-alias", "jellyfin", "--publish", "127.0.0.1::8096", "--mount", `type=bind,source=${media},target=/media,readonly`, "--tmpfs", "/config", "--tmpfs", "/cache", "--memory", "2g", "--cpus", "2", jellyfinImage]);
    const binding = await run(["port", name, "8096/tcp"]);
    if (!/^127\.0\.0\.1:\d+$/.test(binding)) throw new Error("Jellyfin fixture did not bind a local test port.");
    const url = `http://${binding}`;
    const authorization = `MediaBrowser Client="Couch fixture", Device="Test", DeviceId="${name}", Version="0.1.0"`;
    async function request<T = unknown>(path: string, body?: unknown, accessToken?: string): Promise<T> {
      const response = await fetch(`${url}${path}`, {
        method: body === undefined ? "GET" : "POST", signal: AbortSignal.timeout(10_000),
        headers: { "Content-Type": "application/json", Authorization: authorization + (accessToken ? `, Token="${accessToken}"` : "") },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`Jellyfin fixture API returned ${response.status}.`);
      const text = await response.text();
      return (text ? JSON.parse(text) : undefined) as T;
    }
    async function until<T>(check: () => Promise<T | null>, label: string): Promise<T> {
      const deadline = Date.now() + 90_000;
      while (Date.now() < deadline) {
        try { const result = await check(); if (result !== null) return result; } catch { /* Startup and scans are asynchronous. */ }
        await Bun.sleep(500);
      }
      throw new Error(`Jellyfin fixture timed out waiting for ${label}.`);
    }
    const info = await until(async () => {
      const result = await request<{ Version?: string; StartupWizardCompleted?: boolean }>("/System/Info/Public");
      return typeof result.Version === "string" && typeof result.StartupWizardCompleted === "boolean" ? result : null;
    }, "server startup");
    if (info.StartupWizardCompleted) throw new Error("Refusing to configure an existing Jellyfin server.");
    await until(() => request("/Startup/Configuration"), "startup configuration");
    const username = "couch-test";
    const password = crypto.randomUUID() + crypto.randomUUID();
    await request("/Startup/Configuration", { UICulture: "en-US", MetadataCountryCode: "US", PreferredMetadataLanguage: "en" });
    await request("/Startup/User");
    await request("/Startup/User", { Name: username, Password: password });
    await request("/Startup/RemoteAccess", { EnableRemoteAccess: true, EnableAutomaticPortMapping: false });
    await request("/Startup/Complete", {});
    const auth = await request<{ AccessToken: string; User: { Id: string } }>("/Users/AuthenticateByName", { Username: username, Pw: password });
    for (const [collectionType, folder, types] of [["movies", "Movies", ["Movie"]], ["music", "Music", ["MusicAlbum", "MusicArtist", "Audio"]]] as const) {
      await request(`/Library/VirtualFolders?name=Fixture${folder}&collectionType=${collectionType}&refreshLibrary=true`, { LibraryOptions: {
        PathInfos: [{ Path: `/media/${folder}` }], EnableRealtimeMonitor: false, EnableEmbeddedTitles: true,
        TypeOptions: types.map(Type => ({ Type, MetadataFetchers: [], ImageFetchers: [] })),
      } }, auth.AccessToken);
    }
    await until(async () => {
      const page = await request<{ Items: { Type: string; MediaStreams?: { Type?: string; IsExternal?: boolean; Language?: string }[] }[] }>(`/Items?recursive=true&includeItemTypes=Movie,Audio&fields=MediaStreams&userId=${auth.User.Id}`, undefined, auth.AccessToken);
      return page.Items.some(item => item.Type === "Movie" && item.MediaStreams?.some(stream => stream.Type === "Subtitle" && stream.IsExternal && stream.Language === "ita")) && page.Items.some(item => item.Type === "Audio") ? true : null;
    }, "movie, external Italian subtitle and music library scan");
    await Bun.write(configPath, JSON.stringify({ url, containerUrl: "http://jellyfin:8096", username, password, accessToken: auth.AccessToken, userId: auth.User.Id, version: info.Version }), { mode: 0o600 });
    await chmod(configPath, 0o600);
    console.log(`Jellyfin ${info.Version} fixture ready.`);
    return { configPath, dockerNetwork: name, close };
  } catch (error) {
    await close().catch(() => undefined);
    throw error;
  }
}
