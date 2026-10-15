/**
 * Adapted from Motion-Primitives AnimatedBackground by ibelick.
 * Source: https://github.com/ibelick/motion-primitives/blob/120f64f6ca60348e251f929e9c81f11ccbe45eda/components/core/animated-background.tsx
 * Retains the scoped useId/layoutId selected background. Application state is
 * controlled; render props preserve native controls and their event handlers.
 * Reduced motion uses a static span, without shared-layout animation.
 *
 * MIT License
 * Copyright (c) 2024 ibelick
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import { useId, useSyncExternalStore, type ReactNode } from "react";
import { motion } from "motion/react";

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";
function subscribeReducedMotion(onChange: () => void) {
  const preference = window.matchMedia(reducedMotionQuery);
  preference.addEventListener("change", onChange);
  return () => preference.removeEventListener("change", onChange);
}
function getReducedMotion() {
  return window.matchMedia(reducedMotionQuery).matches;
}

type AnimatedSelectionProps = {
  value: string | null;
  children: (indicator: (itemValue: string) => ReactNode) => ReactNode;
};

/** Visual only: the caller owns selection, disabled state and tab semantics. */
export function AnimatedSelection({ value, children }: AnimatedSelectionProps) {
  const uniqueId = useId();
  // Read changes live; Motion 12.34's hook snapshots the preference at mount.
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotion,
    () => true,
  );
  const className =
    "pointer-events-none absolute inset-0 z-0 rounded-xl border-2 border-line-strong bg-accent-soft shadow-[0_2px_0_var(--app-hard-shadow)]";

  return children((itemValue) => {
    if (value !== itemValue) return null;
    // No Motion element or shared-layout ID remains when movement is reduced.
    if (reducedMotion !== false) {
      return (
        <span
          aria-hidden="true"
          data-animated-selection="static"
          className={className}
        />
      );
    }
    return (
      <motion.span
        aria-hidden="true"
        data-animated-selection="animated"
        layoutId={`selection-${uniqueId}`}
        initial={false}
        transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
        className={className}
      />
    );
  });
}
