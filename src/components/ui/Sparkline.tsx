"use client";

import { useId, useMemo } from "react";

export function Sparkline({
  data,
  height = 64,
  stroke = "var(--color-neon)",
  fill = "rgba(111,255,155,0.18)",
  className,
}: {
  data: number[];
  height?: number;
  stroke?: string;
  fill?: string;
  className?: string;
}) {
  const reactId = useId();
  const gradId = `spark-${reactId.replace(/[:]/g, "")}`;
  const { d, area } = useMemo(() => {
    if (!data.length) return { d: "", area: "" };
    const w = 200;
    const h = height;
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const step = w / (data.length - 1 || 1);
    const pts = data.map((v, i) => {
      const x = i * step;
      const y = h - ((v - min) / range) * (h - 8) - 4;
      return [x, y] as const;
    });
    const line =
      "M" +
      pts
        .map(([x, y], i) => {
          if (i === 0) return `${x},${y}`;
          const [px, py] = pts[i - 1];
          const cx = (px + x) / 2;
          return `Q ${px},${py} ${cx},${(py + y) / 2}`;
        })
        .join(" ") +
      ` T ${pts[pts.length - 1][0]},${pts[pts.length - 1][1]}`;
    const areaPath = `${line} L ${pts[pts.length - 1][0]},${h} L 0,${h} Z`;
    return { d: line, area: areaPath };
  }, [data, height]);

  return (
    <svg
      viewBox={`0 0 200 ${height}`}
      preserveAspectRatio="none"
      className={className}
      aria-hidden
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={fill} stopOpacity={1} />
          <stop offset="100%" stopColor={fill} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      <path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
