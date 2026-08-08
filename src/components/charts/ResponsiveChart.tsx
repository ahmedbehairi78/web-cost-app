import { cloneElement, useEffect, useRef, useState, type ReactElement } from 'react';

interface ResponsiveChartProps {
  /** A single recharts chart element (LineChart, BarChart, PieChart, …). */
  children: ReactElement<{ width?: number; height?: number }>;
  className?: string;
}

/**
 * Measures its own box with a ResizeObserver and renders the recharts chart with
 * explicit numeric width/height. This avoids recharts' ResponsiveContainer, which
 * passes width(-1)/height(-1) to its child chart on the first render (before it
 * has measured), producing the noisy console warning:
 *   "The width(-1) and height(-1) of chart should be greater than 0 …"
 * The chart only mounts once the container has a positive size, so the chart never
 * receives an invalid dimension.
 */
export function ResponsiveChart({ children, className }: ResponsiveChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = Math.floor(el.clientWidth);
      const h = Math.floor(el.clientHeight);
      setSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const hasSize = size.width > 0 && size.height > 0;

  return (
    <div ref={ref} className={className} style={{ width: '100%', height: '100%' }}>
      {hasSize ? cloneElement(children, { width: size.width, height: size.height }) : null}
    </div>
  );
}

export default ResponsiveChart;
