export interface ClockFit { x0: number; y0: number; slope: number }
export type ClockPoint = [number, number];

// Centre both axes on the newest observation, preserving precision at epoch-sized times.
// A short history cannot distinguish drift from noise: hold the nominal slope.
export function line(points: readonly ClockPoint[], span: number, nominal = 1): ClockFit {
  const n = points.length;
  if (!n) throw new RangeError("A clock fit needs an observation");
  const [x0, yr] = points[n - 1]!;
  const offsets = () => points.map(([x, y]) => y - yr - nominal * (x - x0)).sort((a, b) => a - b)[n >> 1]!;
  if (x0 - points[0]![0] < span) return { x0, y0: yr + offsets(), slope: nominal };
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const [x, y] of points) {
    const u = x - x0, v = y - yr;
    sx += u; sy += v; sxx += u * u; sxy += u * v;
  }
  const d = n * sxx - sx * sx;
  if (!d) return { x0, y0: yr + offsets(), slope: nominal };
  const slope = (n * sxy - sx * sy) / d;
  return { x0, y0: yr + (sy - slope * sx) / n, slope };
}
