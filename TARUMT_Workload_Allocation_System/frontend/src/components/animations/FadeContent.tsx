"use client";

/**
 * React Bits–style copy-in component (reactbits.dev "FadeContent" pattern).
 * Fades content in with a subtle scale Movement when it enters the viewport.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

export interface FadeContentProps {
  children: ReactNode;
  delay?: number;
  duration?: number; // seconds
  scaleFrom?: number; // e.g. 0.98
  className?: string;
}

export default function FadeContent({
  children,
  delay = 0,
  duration = 0.6,
  scaleFrom = 0.98,
  className = "",
}: FadeContentProps) {
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

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "scale(1)" : `scale(${scaleFrom})`,
        transition: `opacity ${duration}s ease ${delay}s, transform ${duration}s ease ${delay}s`,
        willChange: "opacity, transform",
      }}
    >
      {children}
    </div>
  );
}
