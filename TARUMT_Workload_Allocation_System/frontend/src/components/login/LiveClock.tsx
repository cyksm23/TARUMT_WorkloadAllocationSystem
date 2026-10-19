"use client";

/**
 * LIVE CLOCK — full date + ticking HH:MM:SS.
 * Renders an empty line until mounted (avoids SSR/CSR hydration
 * mismatch) and keeps a fixed height so the layout never shifts.
 */

import { useEffect, useState } from "react";

const LINE = "mt-sm h-5 text-[13px]";

export default function LiveClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!now) {
    return (
      <p className={`${LINE} text-transparent`} aria-hidden>
        loading
      </p>
    );
  }

  const date = now.toLocaleDateString("en-MY", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const time = now.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <p className={`${LINE} text-textSecondary`}>
      {date} · <span className="font-mono">{time}</span>
    </p>
  );
}
