"use client";

/**
 * PARTICLES — soft floating dots background (React Bits vibe).
 * Positions are seeded from the index so server and client renders
 * agree (no hydration mismatch) and never flicker between renders.
 */

import { useMemo } from "react";

const COLORS = ["#0071E3", "#EAF3FF", "#C7D9F5"];

export default function Particles({ count = 16 }: { count?: number }) {
  const dots = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const x = ((i * 613) % 940) / 10; // 0–94%
        const y = ((i * 401) % 860) / 10; // 0–86%
        const size = 4 + ((i * 37) % 7) * 1.5; // 4–13px
        return {
          x,
          y,
          size,
          delay: (i * 1.7) % 7,
          duration: 8 + ((i * 11) % 9),
          color: COLORS[i % COLORS.length],
          opacity: 0.35 + ((i * 13) % 5) * 0.1,
        };
      }),
    [count],
  );

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {dots.map((d, i) => (
        <span
          key={i}
          className="animate-float absolute rounded-full"
          style={{
            left: `${d.x}%`,
            top: `${d.y}%`,
            width: d.size,
            height: d.size,
            background: d.color,
            opacity: d.opacity,
            animationDelay: `-${d.delay}s`,
            animationDuration: `${d.duration}s`,
          }}
        />
      ))}
    </div>
  );
}
