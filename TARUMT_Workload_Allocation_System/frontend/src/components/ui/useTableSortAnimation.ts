"use client";

import { useCallback, useLayoutEffect, useRef } from "react";

/** FLIP cell contents, not native <tr>s: transformed table rows can paint
 * incorrectly in Chromium. Capture visual positions before changing the sort
 * so rapid clicks can restart smoothly from an in-flight transition.
 */
export default function useTableSortAnimation<Element extends HTMLElement = HTMLTableSectionElement>(order: unknown) {
  const bodyRef = useRef<Element>(null);
  const previousPositions = useRef<Map<string, number> | null>(null);
  const animations = useRef(new Set<Animation>());

  const stopAnimations = useCallback(() => {
    animations.current.forEach((animation) => animation.cancel());
    animations.current.clear();
  }, []);

  const prepareAnimation = useCallback(() => {
    const positions = new Map<string, number>();
    bodyRef.current?.querySelectorAll<HTMLElement>("[data-sort-motion]").forEach((element) => {
      positions.set(element.dataset.sortMotion!, element.getBoundingClientRect().top);
    });
    previousPositions.current = positions;
    stopAnimations();
  }, [stopAnimations]);

  useLayoutEffect(() => {
    const positions = previousPositions.current;
    previousPositions.current = null;
    if (!positions || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return stopAnimations;

    // Measure all destinations before writing animation transforms.
    const moves: Array<{ element: HTMLElement; distance: number }> = [];
    bodyRef.current?.querySelectorAll<HTMLElement>("[data-sort-motion]").forEach((element) => {
      const previousTop = positions.get(element.dataset.sortMotion!);
      if (previousTop === undefined) return;
      const distance = previousTop - element.getBoundingClientRect().top;
      if (Math.abs(distance) > 0.5 && typeof element.animate === "function") moves.push({ element, distance });
    });
    for (const { element, distance } of moves) {
      const animation = element.animate(
        [{ transform: `translateY(${distance}px)` }, { transform: "translateY(0)" }],
        { duration: 380, easing: "cubic-bezier(0.2, 0.75, 0.2, 1)" },
      );
      animations.current.add(animation);
      animation.onfinish = animation.oncancel = () => { animations.current.delete(animation); };
    }
    return stopAnimations;
  }, [order, stopAnimations]);

  return { bodyRef, prepareAnimation };
}
