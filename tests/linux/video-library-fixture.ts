import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

export const videoFixtureTitles = ["Arrival at the observatory", "The tenth signal", "Return to the observatory", "Winter observation"];
export const videoFixtureMovie = "A night at the observatory";

export async function createVideoLibraryFixture(root = "/video-fixtures") {
  const run = async (args: string[]) => {
    const child = Bun.spawn(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", ...args], { stdout: "inherit", stderr: "inherit" });
    if (await child.exited !== 0) throw new Error("Could not generate local video library fixture.");
  };
  const write = async (path: string, value: string | Uint8Array) => { await mkdir(dirname(join(root, path)), { recursive: true }); await Bun.write(join(root, path), value); };
  const image = async (path: string, size: string, color: string) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await run(["-f", "lavfi", "-i", `color=c=${color}:s=${size}`, "-vf", "drawgrid=w=40:h=40:t=3:c=white@0.35", "-frames:v", "1", "-update", "1", join(root, path)]);
  };
  const movie = "Movie/Observatory.mkv";
  await mkdir(join(root, "Movie"), { recursive: true });
  await run(["-i", "/fixtures/multitrack.mkv", "-map", "0", "-c", "copy", "-metadata", "title=Embedded observatory title", join(root, movie)]);
  await write("Movie/Observatory.nfo", `<?xml version="1.0" encoding="UTF-8"?>
<movie><title>${videoFixtureMovie}</title><originaltitle>Notte all'osservatorio</originaltitle><plot>A local film about a night under the stars. This NFO description wins over embedded media tags.</plot><premiered>2020-09-05</premiered><year>1999</year><runtime>99</runtime><genre>Documentary</genre><genre>Science</genre><unknown keep="yes">Original sidecar data stays private.</unknown><playcount>9</playcount><resume><position>17</position></resume></movie>`);
  await image("Movie/Observatory-poster.jpg", "240x360", "0x285b81");
  await image("Movie/fanart.png", "640x360", "0x243448");
  await write("Observatory/tvshow.nfo", `<tvshow><title>Observatory journals</title><originaltitle>Diari dell'osservatorio</originaltitle><plot>Four playable episodes across two seasons, stored entirely in this local folder.</plot><premiered>2021-01-01</premiered><genre>Science</genre></tvshow>`);
  await image("Observatory/poster.png", "240x360", "0x72508c");
  await image("Observatory/fanart.jpg", "640x360", "0x382a55");
  for (const season of [1, 2]) await image(`Observatory/season0${season}-poster.png`, "240x360", season === 1 ? "0x347554" : "0x94723a");
  const files = [movie];
  for (const [index, [season, episode]] of [[1, 2], [1, 10], [2, 1], [2, 10]].entries()) {
    const stem = `Observatory/Season ${season}/Observatory.S0${season}E${String(episode).padStart(2, "0")}`;
    await mkdir(dirname(join(root, `${stem}.mkv`)), { recursive: true });
    await run(["-i", "/fixtures/multitrack.mkv", "-map", "0", "-c", "copy", "-metadata", `title=Embedded episode ${index + 1}`, join(root, `${stem}.mkv`)]);
    await write(`${stem}.nfo`, `<episodedetails><title>${videoFixtureTitles[index]}</title><showtitle>Episode fallback title</showtitle><season>${season}</season><episode>${episode}</episode><aired>202${season}-02-${String(episode).padStart(2, "0")}</aired><plot>Local episode ${season}.${episode}, with native audio, subtitles and chapters from the playable fixture.</plot><runtime>45</runtime></episodedetails>`);
    await image(`${stem}-thumb.png`, "320x180", index % 2 ? "0x88502d" : "0x2d647d");
    files.push(`${stem}.mkv`);
  }
  await write("Malformed/Unbroken video.mkv", await Bun.file(join(root, movie)).bytes());
  await write("Malformed/Unbroken video.nfo", "<movie><title>Malformed sidecar</movie>");
  await write("Malformed/Unbroken video-poster.png", "this is not an image");
  await write("Malformed/fanart.jpg", new Uint8Array(2 * 1024 * 1024 + 1));
  files.push("Malformed/Unbroken video.mkv");
  const hashes: Record<string, string> = {};
  for (const file of new Bun.Glob("**/*").scanSync({ cwd: root, onlyFiles: true })) hashes[file] = createHash("sha256").update(await Bun.file(join(root, file)).bytes()).digest("hex");
  await Bun.write(join(root, "fixture-manifest.json"), JSON.stringify({ movies: 2, shows: 1, seasons: 2, episodes: 4, files, hashes }, null, 2));
}
