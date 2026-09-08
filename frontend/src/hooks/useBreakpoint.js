import { useEffect, useState } from "react";

/**
 * Mismos umbrales que Bootstrap 5 (ver frontend/src/styles/breakpoints.css,
 * fuente de verdad única de breakpoints del proyecto).
 */
const BREAKPOINTS = [
  { name: "xxl", minWidth: 1400 },
  { name: "xl", minWidth: 1200 },
  { name: "lg", minWidth: 992 },
  { name: "md", minWidth: 768 },
  { name: "sm", minWidth: 576 },
  { name: "xs", minWidth: 0 },
];

const ORDER = ["xs", "sm", "md", "lg", "xl", "xxl"];

function getCurrentBreakpoint() {
  if (typeof window === "undefined") {
    return "lg";
  }
  return BREAKPOINTS.find((bp) => window.innerWidth >= bp.minWidth)?.name ?? "xs";
}

/** Breakpoint activo (`xs`..`xxl`), recalculado en cada resize real. */
export function useBreakpoint() {
  const [breakpoint, setBreakpoint] = useState(getCurrentBreakpoint);

  useEffect(() => {
    function handleResize() {
      setBreakpoint(getCurrentBreakpoint());
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return breakpoint;
}

/** Azúcar sobre `useBreakpoint` para comparaciones tipo `>= md`. */
export function useIsBreakpointAtLeast(minBreakpoint) {
  const breakpoint = useBreakpoint();
  return ORDER.indexOf(breakpoint) >= ORDER.indexOf(minBreakpoint);
}
