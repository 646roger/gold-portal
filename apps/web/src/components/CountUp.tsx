import { useEffect, useRef, useState } from 'react';

/** True only in a real browser that has not asked for reduced motion (false in jsdom/tests). */
const canAnimate = () =>
  typeof window !== 'undefined' &&
  typeof window.requestAnimationFrame === 'function' &&
  typeof window.matchMedia === 'function' &&
  !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const decimalsOf = (v: string) => (v.split('.')[1] ?? '').length;

/**
 * Display-only count-up. `value` is the SERVER's decimal string; the animation only decorates the
 * transition and the final committed text is always exactly `format(value)` — no money maths here.
 */
export function CountUp({ value, format, duration = 700 }: { value: string; format: (v: string) => string; duration?: number }) {
  const [shown, setShown] = useState(() => (canAnimate() && Number.isFinite(Number(value)) ? (0).toFixed(decimalsOf(value)) : value));
  const current = useRef(Number(shown));
  const raf = useRef(0);

  useEffect(() => {
    const to = Number(value);
    const from = current.current;
    if (!canAnimate() || !Number.isFinite(to) || !Number.isFinite(from) || from === to) {
      setShown(value);
      current.current = to;
      return;
    }
    const dp = decimalsOf(value);
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 4);
      const cur = from + (to - from) * eased;
      current.current = cur;
      if (p < 1) {
        setShown(cur.toFixed(dp));
        raf.current = requestAnimationFrame(tick);
      } else {
        current.current = to;
        setShown(value);
      }
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [value, duration]);

  return <>{format(shown)}</>;
}
