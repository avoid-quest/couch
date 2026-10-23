// Run runArtworkMountRegression() on an empty Vite fixture with #fixture.
import { Profiler, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import { MediaArtwork, useArtRatio } from "../src/client/components/MediaArtwork";

const wait = () => new Promise(resolve => setTimeout(resolve, 80));
export async function runArtworkMountRegression() {
  const canvas = document.createElement('canvas');
  canvas.width = 240; canvas.height = 80;
  canvas.getContext('2d')!.fillRect(0, 0, 240, 80);
  const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!)));
  const src = URL.createObjectURL(blob);
  const root = createRoot(document.getElementById('fixture')!);
  const commits: string[] = [];
  const ratios: number[] = [];
  function Picture({ source = src }: { source?: string }) {
    const [ref, ratio] = useArtRatio(source, 1);
    ratios.push(ratio);
    return <div ref={ref} style={{ width: 240, '--art-ratio': ratio } as CSSProperties}><MediaArtwork thumbnail={source} title="Wide artwork" priority /></div>;
  }
  const render = (key: string, source = src) => root.render(<Profiler id="artwork" onRender={(_id, phase) => commits.push(phase)}><Picture key={key} source={source} /></Profiler>);
  try {
    render('cold'); await wait();
    if (ratios.at(-1) !== 3) throw new Error('Cold artwork did not learn its real proportions');
    root.render(null); await wait();
    commits.length = 0; ratios.length = 0;
    render('warm'); await wait();
    const warm = { commits: [...commits], ratios: [...ratios] };
    render('warm', ''); await wait();
    if (ratios.at(-1) !== 1) throw new Error('Missing artwork retained the previous picture\'s proportions');
    if (warm.ratios.some(ratio => ratio !== 3) || warm.commits.length !== 1) throw new Error(`Cached artwork remount must render once at its known proportions: ${JSON.stringify(warm)}`);
    return { passed: true, warm };
  } finally { root.unmount(); URL.revokeObjectURL(src); }
}
