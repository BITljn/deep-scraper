import { useEffect, useRef, useState } from "react";

function cubicOut(t: number): number {
  const p = 1 - t;
  return 1 - p * p * p;
}

export function useAnimatedNumber(target: number, duration = 600): number {
  const [value, setValue] = useState(target);
  const latestRef = useRef(value);
  latestRef.current = value;
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const from = latestRef.current;
    let start: number | null = null;

    const tick = (now: number) => {
      if (start === null) {
        start = now;
      }
      const elapsed = now - start;
      const t = Math.min(1, elapsed / duration);
      const eased = cubicOut(t);
      setValue(from + (target - from) * eased);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return value;
}
