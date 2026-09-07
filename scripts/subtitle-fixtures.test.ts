import { expect, test } from "bun:test";
import manifest from "../tests/fixtures/subtitles/manifest.json";
import accepted from "../tests/fixtures/subtitles/local-result.json";

const fixtures = `${import.meta.dir}/../tests/fixtures/subtitles`;
for (const [name, record] of Object.entries(manifest.files)) {
  test(`${name} retains the accepted subtitle corpus bytes`, async () => {
    expect(record).toEqual(accepted.files[name as keyof typeof accepted.files]);
    const bytes = await Bun.file(`${fixtures}/${name}`).arrayBuffer();
    expect(bytes.byteLength).toBe(record.bytes);
    expect(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")).toBe(record.sha256);
  });
}
for (const name of ["CouchCorpusSans.ttf", "FONT-LICENSE.txt", "forced.ass", "plain.srt", "styled.ass"] as const) {
  test(`${name} retains the accepted subtitle source bytes`, async () => {
    const bytes = await Bun.file(`${fixtures}/${name}`).arrayBuffer();
    expect(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")).toBe(accepted.sources[name]);
  });
}
