"use client";

/**
 * React Bits–style copy-in component (reactbits.dev "AnimatedContent" pattern).
 * Wraps children in a fade + slide-up entrance animation, staggered via `delay`.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

export interface AnimatedContentProps {
  children: ReactNode;
  /** seconds before the animation starts */
  delay?: number;
  /** slide direction */
  direction?: "up" | "down" | "left" | "right";
  distance?: string;
  className?: string;
}

export default function AnimatedContent({
  children,
  delay = 0,
  direction = "up",
  distance = "24px",
  className = "",
}: AnimatedContentProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { threshold: 0.1 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const offset: Record<string, string> = {
    up: `0, ${distance}`,
    down: `0, -${distance}`,
    left: `${distance}, 0`,
    right: `-${distance}, 0`,
  };

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translate(0, 0)" : `translate(${offset[direction]})`,
        transition: `opacity 0.7s cubic-bezier(0.16,1,0.3,1) ${delay}s, transform 0.7s cubic-bezier(0.16,1,0.3,1) ${delay}s`,
        transitionDelay: `${delay}s`,
        willChange: "opacity, transform",
      }}
    >
      {children}
    </div>
  );
}
