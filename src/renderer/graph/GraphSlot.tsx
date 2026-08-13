import React, { useLayoutEffect, useRef, useState } from "react";

type Size = { width: number; height: number };

// round to whole pixels: the observer fires on subpixel deltas during CSS
// width transitions, and the canvas only needs integer dimensions
export function sizeFromRect(rect: { width: number; height: number }): Size {
  return { width: Math.round(rect.width), height: Math.round(rect.height) };
}

type GraphSlotProps = {
  children: (size: Size) => React.ReactNode;
};

// Owns the flex-1 graph slot and measures it. Panel open/close and window
// resize both change this element's size → the observer fires → children
// re-render with new dimensions. This is the single mechanism that keeps the
// force-graph canvas sized correctly without touching camera pan/zoom.
export default function GraphSlot({ children }: GraphSlotProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize(sizeFromRect(el.getBoundingClientRect()));
    measure(); // initial measure before first paint — avoids a 0×0 first frame
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="absolute inset-0">
      {children(size)}
    </div>
  );
}
