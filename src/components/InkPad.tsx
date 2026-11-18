import { ActionIcon, Button, ColorSwatch, Divider, Group, SegmentedControl, Tooltip } from '@mantine/core';
import { Check, Eraser, Hand, Highlighter, PenLine, Plus, Redo2, Trash2, Undo2 } from 'lucide-react';
import { getStroke } from 'perfect-freehand';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { InkPoint, InkStroke } from '../db';

/** All ink is stored in a 1000-unit-wide space so it scales to any screen width. */
const WIDTH = 1000;
const LINE_GAP = 64;
const MIN_HEIGHT = 1400;
const PEN_COLORS = ['ink', '#c62828', '#1565c0', '#2e7d32'];
const PEN_SIZES = [3, 5, 8];
const HIGHLIGHTER = { color: '#f9d71c', size: 26 };
const ERASER_RADIUS = 14;

type Tool = 'pen' | 'highlighter' | 'eraser';

interface Props {
  initial: InkStroke[];
  onChange: (strokes: InkStroke[]) => void;
}

function strokePath(s: InkStroke, last = true): Path2D {
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

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#222';
}

function drawStroke(ctx: CanvasRenderingContext2D, s: InkStroke, last = true) {
  ctx.globalAlpha = s.highlighter ? 0.38 : 1;
  ctx.fillStyle = s.color === 'ink' ? cssVar('--fg') : s.color;
  ctx.fill(strokePath(s, last));
  ctx.globalAlpha = 1;
}

/** Squared distance from point (x, y) to segment a–b. */
function segDist2(x: number, y: number, a: InkPoint, b: InkPoint) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len)) : 0;
  return (a.x + t * dx - x) ** 2 + (a.y + t * dy - y) ** 2;
}

/** True if any sample point lies within r of the stroke's path. */
function nearStroke(s: InkStroke, samples: InkPoint[], r: number) {
  const r2 = (r + s.size / 2) ** 2;
  const pts = s.points;
  return samples.some((q) =>
    pts.length === 1
      ? (pts[0].x - q.x) ** 2 + (pts[0].y - q.y) ** 2 <= r2
      : pts.some((p, i) => i > 0 && segDist2(q.x, q.y, pts[i - 1], p) <= r2),
  );
}

/** Points every few units along a–b so fast eraser swipes don't skip strokes. */
function sampleSegment(a: InkPoint, b: InkPoint, step = 6): InkPoint[] {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
  return Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n, p: 0.5 }));
}

export function InkPad({ initial, onChange }: Props) {
  const [strokes, setStrokes] = useState<InkStroke[]>(initial);
  const [undo, setUndo] = useState<InkStroke[][]>([]);
  const [redo, setRedo] = useState<InkStroke[][]>([]);
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState(PEN_COLORS[0]);
  const [size, setSize] = useState(PEN_SIZES[1]);
  /** Once a stylus is seen, fingers scroll instead of drawing (palm rejection). */
  const [fingerDraws, setFingerDraws] = useState(true);
  const [extra, setExtra] = useState(0);
  const [width, setWidth] = useState(0);
  const [themeTick, setThemeTick] = useState(0);

  const scroller = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLCanvasElement>(null);
  const live = useRef<HTMLCanvasElement>(null);
  const current = useRef<{
    id: number;
    stroke?: InkStroke;
    erased?: boolean;
    lastErase?: InkPoint;
    panY?: number;
  } | null>(null);
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;

  const bottom = strokes.reduce((m, s) => Math.max(m, ...s.points.map((p) => p.y)), 0);
  const height = Math.max(MIN_HEIGHT, Math.ceil((bottom + 500) / LINE_GAP) * LINE_GAP) + extra;
  const scale = width / WIDTH;

  // Track container width.
  useLayoutEffect(() => {
    const el = scroller.current!;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Redraw when the theme changes (default ink colour follows the theme).
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const bump = () => setThemeTick((t) => t + 1);
    mq.addEventListener('change', bump);
    const mo = new MutationObserver(bump);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mantine-color-scheme'] });
    return () => {
      mq.removeEventListener('change', bump);
      mo.disconnect();
    };
  }, []);

  const setupCanvas = useCallback(
    (c: HTMLCanvasElement | null) => {
      if (!c || !width) return null;
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(width * dpr);
      const h = Math.round(height * scale * dpr);
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
      c.style.height = `${height * scale}px`;
      const ctx = c.getContext('2d')!;
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
      ctx.clearRect(0, 0, WIDTH, height);
      return ctx;
    },
    [width, height, scale],
  );

  // Paint ruled paper + committed strokes.
  useEffect(() => {
    const ctx = setupCanvas(base.current);
    if (!ctx) return;
    ctx.strokeStyle = cssVar('--rule');
    ctx.lineWidth = 1 / scale;
    for (let y = LINE_GAP * 2; y < height; y += LINE_GAP) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(WIDTH, y);
      ctx.stroke();
    }
    for (const s of strokes) drawStroke(ctx, s);
    setupCanvas(live.current);
  }, [strokes, setupCanvas, height, scale, themeTick]);

  const commit = (next: InkStroke[]) => {
    setUndo((u) => [...u.slice(-49), strokesRef.current]);
    setRedo([]);
    setStrokes(next);
    onChange(next);
  };

  const toPoint = (e: PointerEvent | React.PointerEvent): InkPoint => {
    const r = live.current!.getBoundingClientRect();
    const isPen = e.pointerType === 'pen';
    return {
      x: Math.round(((e.clientX - r.left) / scale) * 10) / 10,
      y: Math.round(((e.clientY - r.top) / scale) * 10) / 10,
      p: isPen ? Math.round(Math.max(0.05, e.pressure) * 100) / 100 : 0.5,
    };
  };

  const eraseAt = (pt: InkPoint) => {
    const cur = current.current!;
    const samples = cur.lastErase ? sampleSegment(cur.lastErase, pt) : [pt];
    cur.lastErase = pt;
    const keep = strokesRef.current.filter((s) => !nearStroke(s, samples, ERASER_RADIUS));
    if (keep.length !== strokesRef.current.length) {
      if (!current.current?.erased) setUndo((u) => [...u.slice(-49), strokesRef.current]);
      current.current!.erased = true;
      setStrokes(keep);
      strokesRef.current = keep;
    }
  };

  const onDown = (e: React.PointerEvent) => {
    if (current.current) return;
    if (e.pointerType === 'pen' && fingerDraws) setFingerDraws(false);
    const fingerScroll = e.pointerType === 'touch' && (!fingerDraws || e.isPrimary === false);
    if (fingerScroll) {
      current.current = { id: e.pointerId, panY: e.clientY };
      return;
    }
    if (e.button > 0) return;
    e.preventDefault();
    live.current!.setPointerCapture(e.pointerId);
    const pt = toPoint(e);
    if (tool === 'eraser' || e.button === 5 /* pen eraser end */) {
      current.current = { id: e.pointerId };
      eraseAt(pt);
      return;
    }
    const stroke: InkStroke =
      tool === 'highlighter'
        ? { points: [pt], color: HIGHLIGHTER.color, size: HIGHLIGHTER.size, highlighter: true }
        : { points: [pt], color, size };
    current.current = { id: e.pointerId, stroke };
  };

  const onMove = (e: React.PointerEvent) => {
    const cur = current.current;
    if (!cur || cur.id !== e.pointerId) return;
    if (cur.panY !== undefined) {
      scroller.current!.scrollTop -= e.clientY - cur.panY;
      cur.panY = e.clientY;
      return;
    }
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
    if (!cur.stroke) {
      for (const ev of events.length ? events : [e.nativeEvent]) eraseAt(toPoint(ev));
      return;
    }
    for (const ev of events.length ? events : [e.nativeEvent]) cur.stroke.points.push(toPoint(ev));
    const ctx = setupCanvas(live.current);
    if (ctx) drawStroke(ctx, cur.stroke, false);
  };

  const onUp = (e: React.PointerEvent) => {
    const cur = current.current;
    if (!cur || cur.id !== e.pointerId) return;
    current.current = null;
    if (cur.stroke) {
      commit([...strokesRef.current, cur.stroke]);
    } else if (cur.erased) {
      setRedo([]);
      onChange(strokesRef.current);
    }
  };

  const doUndo = () => {
    const prev = undo[undo.length - 1];
    if (!prev) return;
    setUndo(undo.slice(0, -1));
    setRedo((r) => [...r, strokes]);
    setStrokes(prev);
    onChange(prev);
  };
  const doRedo = () => {
    const next = redo[redo.length - 1];
    if (!next) return;
    setRedo(redo.slice(0, -1));
    setUndo((u) => [...u, strokes]);
    setStrokes(next);
    onChange(next);
  };

  return (
    <div className="ink">
      <Group className="ink-tools" gap={4} px="sm" py={6} role="toolbar" aria-label="Handwriting tools">
        <ActionIcon.Group>
          {(
            [
              ['pen', 'Pen', PenLine],
              ['highlighter', 'Highlighter', Highlighter],
              ['eraser', 'Eraser', Eraser],
            ] as const
          ).map(([t, label, Icon]) => (
            <Tooltip key={t} label={label}>
              <ActionIcon
                variant={tool === t ? 'filled' : 'default'}
                color={tool === t ? undefined : 'gray'}
                size="lg"
                onClick={() => setTool(t)}
                aria-label={label}
                aria-pressed={tool === t}
              >
                <Icon size={18} />
              </ActionIcon>
            </Tooltip>
          ))}
        </ActionIcon.Group>
        <Divider orientation="vertical" mx={4} />
        <Group gap={6}>
          {PEN_COLORS.map((c) => (
            <ColorSwatch
              key={c}
              component="button"
              size={26}
              color={c === 'ink' ? 'var(--fg)' : c}
              onClick={() => {
                setColor(c);
                setTool('pen');
              }}
              aria-label={`Pen colour ${c === 'ink' ? 'default' : c}`}
              style={{ cursor: 'pointer', color: c === 'ink' ? 'var(--mantine-color-body)' : '#fff' }}
            >
              {color === c && tool === 'pen' && <Check size={14} strokeWidth={3} />}
            </ColorSwatch>
          ))}
        </Group>
        <Divider orientation="vertical" mx={4} />
        <SegmentedControl
          size="xs"
          value={String(size)}
          onChange={(v) => {
            setSize(Number(v));
            setTool('pen');
          }}
          aria-label="Pen size"
          data={PEN_SIZES.map((s) => ({
            value: String(s),
            label: <span className="size-dot" style={{ width: s * 1.6 + 2, height: s * 1.6 + 2 }} aria-label={`Size ${s}`} />,
          }))}
        />
        <div className="spacer" />
        <ActionIcon size="lg" onClick={doUndo} disabled={!undo.length} aria-label="Undo">
          <Undo2 size={18} />
        </ActionIcon>
        <ActionIcon size="lg" onClick={doRedo} disabled={!redo.length} aria-label="Redo">
          <Redo2 size={18} />
        </ActionIcon>
        <Tooltip label={fingerDraws ? 'Finger draws — tap so finger scrolls' : 'Finger scrolls — draw with Apple Pencil or stylus'}>
          <ActionIcon
            size="lg"
            variant={fingerDraws ? 'subtle' : 'light'}
            color={fingerDraws ? 'gray' : undefined}
            onClick={() => setFingerDraws((f) => !f)}
            aria-label={fingerDraws ? 'Finger draws' : 'Finger scrolls'}
          >
            <Hand size={18} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Clear handwriting">
          <ActionIcon
            size="lg"
            color="red"
            onClick={() => strokes.length && confirm('Erase all handwriting in this note?') && commit([])}
            disabled={!strokes.length}
            aria-label="Clear handwriting"
          >
            <Trash2 size={18} />
          </ActionIcon>
        </Tooltip>
      </Group>
      <div className="ink-scroll" ref={scroller}>
        <div className="ink-page" style={{ height: height * scale }}>
          <canvas ref={base} className="ink-canvas" aria-hidden />
          <canvas
            ref={live}
            className={`ink-canvas live tool-${tool}`}
            role="img"
            aria-label="Handwriting area"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onContextMenu={(e) => e.preventDefault()}
          />
        </div>
        <Button
          className="add-space"
          variant="subtle"
          color="gray"
          leftSection={<Plus size={16} />}
          onClick={() => setExtra((x) => x + LINE_GAP * 10)}
        >
          More space
        </Button>
      </div>
    </div>
  );
}
