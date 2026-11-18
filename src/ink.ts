import { getStroke } from 'perfect-freehand';
import type { InkStroke } from './db';

/** All ink is stored in a 1000-unit-wide space so it scales to any screen width. */
export const INK_WIDTH = 1000;

/** Smooth, pressure-sensitive outline of a stroke as a canvas path. */
export function strokePath(s: InkStroke, last = true): Path2D {
  const outline = getStroke(
    s.points.map((p) => [p.x, p.y, p.p]),
    {
      size: s.size,
      thinning: s.highlighter ? 0 : 0.55,
      smoothing: 0.5,
      streamline: 0.45,
      simulatePressure: s.points.every((p) => p.p === 0.5),
      last,
    },
  );
  if (!outline.length) return new Path2D();
  const d = outline.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length];
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      return acc;
    },
    ['M', ...outline[0], 'Q'] as (string | number)[],
  );
  d.push('Z');
  return new Path2D(d.join(' '));
}

export function drawStroke(ctx: CanvasRenderingContext2D, s: InkStroke, defaultColor: string, last = true) {
  ctx.globalAlpha = s.highlighter ? 0.38 : 1;
  ctx.fillStyle = s.color === 'ink' ? defaultColor : s.color;
  ctx.fill(strokePath(s, last));
  ctx.globalAlpha = 1;
}

export interface InkImage {
  png: Uint8Array;
  dataUrl: string;
  /** Pixel size of the image. */
  width: number;
  height: number;
}

/**
 * Renders handwriting as white-background PNGs for export, cropped to the area that has ink
 * (full page width, so the layout matches what was written). Tall handwriting is cut into
 * slices no taller than `maxAspect` × width so each fits on a printed page.
 * Returns [] when there is no ink.
 */
export async function renderInkImages(strokes: InkStroke[], pixelWidth = 1600, maxAspect = 1.25): Promise<InkImage[]> {
  if (!strokes.length) return [];
  const ys = strokes.flatMap((s) => s.points.map((p) => p.y));
  const pad = 30;
  const top = Math.max(0, Math.min(...ys) - pad);
  const bottom = Math.max(...ys) + pad;
  const scale = pixelWidth / INK_WIDTH;
  const sliceUnits = (pixelWidth * maxAspect) / scale;

  const images: InkImage[] = [];
  for (let y0 = top; y0 < bottom; y0 += sliceUnits) {
    const y1 = Math.min(bottom, y0 + sliceUnits);
    const width = pixelWidth;
    const height = Math.max(1, Math.round((y1 - y0) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.setTransform(scale, 0, 0, scale, 0, -y0 * scale);
    for (const s of strokes) drawStroke(ctx, s, '#1a1a1a');
    const dataUrl = canvas.toDataURL('image/png');
    const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), 'image/png'));
    images.push({ png: new Uint8Array(await blob.arrayBuffer()), dataUrl, width, height });
  }
  return images;
}
