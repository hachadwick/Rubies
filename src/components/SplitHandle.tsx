import { useCallback, useState, type CSSProperties } from 'react';

/** The Bible pane's share of the width, in percent, when side by side. */
export const SPLIT_DEFAULT = 48.8;
const SPLIT_KEY = 'rubies.split';
/** Neither pane gets narrower than this many pixels, nor less than MIN_PCT of the width. */
const MIN_PX = 320;
const MIN_PCT = 25;

function readSplit(): number {
  try {
    const v = Number(localStorage.getItem(SPLIT_KEY));
    return v >= MIN_PCT && v <= 100 - MIN_PCT ? v : SPLIT_DEFAULT;
  } catch {
    return SPLIT_DEFAULT;
  }
}

/** The Bible/notes split, remembered on this device, and the CSS variable that applies it to the layout. */
export function useSplit() {
  const [split, setSplitState] = useState(readSplit);
  const setSplit = useCallback((v: number) => {
    setSplitState(v);
    try {
      localStorage.setItem(SPLIT_KEY, String(Math.round(v * 10) / 10));
    } catch {
      /* private mode: the width just isn't remembered */
    }
  }, []);
  return { split, setSplit, style: { '--split': `${split}%` } as CSSProperties };
}

/** How narrow a pane can get before its header (chapter picker, buttons) would be squashed: its min-content width. */
function minWidth(pane: Element | null | undefined): number {
  if (!(pane instanceof HTMLElement)) return 0;
  const old = pane.style.width;
  pane.style.width = 'min-content';
  const w = pane.getBoundingClientRect().width;
  pane.style.width = old;
  return w;
}

/**
 * Keeps each pane at least MIN_PX wide (and MIN_PCT of the width), and never narrower than its header needs, in the
 * container `handle` sits in. The stylesheet enforces the header minimum too, for rotation and window resizes.
 */
function clamp(pct: number, handle: HTMLElement): number {
  const box = handle.parentElement?.getBoundingClientRect();
  const width = box?.width ?? 0;
  if (!width) return Math.min(Math.max(pct, MIN_PCT), 100 - MIN_PCT);
  const floor = Math.max((MIN_PCT / 100) * width, MIN_PX);
  const minLeft = (Math.max(floor, minWidth(handle.previousElementSibling)) / width) * 100;
  const minRight = (Math.max(floor, minWidth(handle.nextElementSibling)) / width) * 100;
  if (minLeft + minRight > 100) return (minLeft / (minLeft + minRight)) * 100; // no room: share it fairly
  return Math.min(Math.max(pct, minLeft), 100 - minRight);
}

/**
 * The divider between the Bible and the notes: drag it (mouse, finger or pencil), or focus it and use the arrow
 * keys (Home/End for the limits). Double-click or double-tap puts it back in the middle.
 */
export function SplitHandle({ split, onChange }: { split: number; onChange: (pct: number) => void }) {
  const [dragging, setDragging] = useState(false);

  const containerWidth = (el: HTMLElement) => el.parentElement?.getBoundingClientRect() ?? null;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const box = containerWidth(e.currentTarget);
    if (!box?.width) return;
    onChange(clamp(((e.clientX - box.left) / box.width) * 100, e.currentTarget));
  };

  const stop = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 10 : 2;
    const next =
      e.key === 'ArrowLeft' ? split - step
      : e.key === 'ArrowRight' ? split + step
      : e.key === 'Home' ? 0
      : e.key === 'End' ? 100
      : e.key === 'Enter' ? SPLIT_DEFAULT
      : null;
    if (next === null) return;
    e.preventDefault();
    onChange(clamp(next, e.currentTarget));
  };

  return (
    <div
      className={`split-handle ${dragging ? 'is-dragging' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the Bible and notes"
      aria-valuemin={MIN_PCT}
      aria-valuemax={100 - MIN_PCT}
      aria-valuenow={Math.round(split)}
      aria-valuetext={`Bible ${Math.round(split)}%, notes ${Math.round(100 - split)}%`}
      title="Drag to resize · double-click to reset"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
      onDoubleClick={() => onChange(SPLIT_DEFAULT)}
      onKeyDown={onKeyDown}
    >
      <span className="split-grip" aria-hidden />
    </div>
  );
}
