"use client";

import { useEffect, useState } from "react";

// Smoothed scrollY via requestAnimationFrame. Used by the briefing-header
// parallax + the back-to-top button visibility threshold + the sticky nav
// border. One subscriber per page is enough; consumers receive the same
// shared state via re-renders.
export function useScrollY(): number {
  const [y, setY] = useState(0);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = 0;
      setY(window.scrollY || window.pageYOffset || 0);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    tick();
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return y;
}
