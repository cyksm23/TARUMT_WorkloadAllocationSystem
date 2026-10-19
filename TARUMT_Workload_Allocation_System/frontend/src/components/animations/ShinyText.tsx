"use client";

/**
 * React Bits–style copy-in component (reactbits.dev "ShinyText" pattern).
 * Text with a shimmering light sweep (CSS keyframe defined in globals.css).
 */

interface ShinyTextProps {
  text: string;
  className?: string;
  /** seconds per sweep (default 3s) */
  speed?: number;
}

export default function ShinyText({ text, className = "", speed = 3 }: ShinyTextProps) {
  return (
    <span
      className={`shiny-text ${className}`}
      style={{ backgroundSize: "200% auto", animationDuration: `${speed}s` }}
      aria-label={text}
    >
      {text}
    </span>
  );
}
