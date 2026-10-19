"use client";

/**
 * TYPEWRITER — React Bits-style copy-in.
 * Cycles through a list of strings: types them character by character,
 * holds, deletes, then continues with the next text. A blinking caret
 * trails the visible text.
 */

import { useEffect, useState } from "react";

interface TypewriterProps {
  /** Texts to cycle through, in order, looping forever. */
  texts: readonly string[];
  /** ms to type each character */
  typingSpeed?: number;
  /** ms to delete each character */
  deletingSpeed?: number;
  /** ms to hold a fully-typed text before deleting */
  pauseMs?: number;
  className?: string;
}

export default function Typewriter({
  texts,
  typingSpeed = 40,
  deletingSpeed = 20,
  pauseMs = 2400,
  className,
}: TypewriterProps) {
  const [cycle, setCycle] = useState(0); // which text is active
  const [length, setLength] = useState(0); // visible character count
  const [deleting, setDeleting] = useState(false);

  const current = texts[cycle % texts.length];

  useEffect(() => {
    if (deleting) {
      if (length > 0) {
        const t = setTimeout(() => setLength((n) => n - 1), deletingSpeed);
        return () => clearTimeout(t);
      }
      // finished deleting -> move to the next text
      const t = setTimeout(() => {
        setDeleting(false);
        setCycle((c) => c + 1);
      }, 120);
      return () => clearTimeout(t);
    }
    if (length < current.length) {
      const t = setTimeout(() => setLength((n) => n + 1), typingSpeed);
      return () => clearTimeout(t);
    }
    // fully typed -> hold, then delete
    const t = setTimeout(() => setDeleting(true), pauseMs);
    return () => clearTimeout(t);
  }, [length, deleting, current, typingSpeed, deletingSpeed, pauseMs]);

  return (
    <span className={className}>
      {current.slice(0, length)}
      <span className="animate-caret">|</span>
    </span>
  );
}
