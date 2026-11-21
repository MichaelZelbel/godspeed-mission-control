import * as React from "react";

const MOBILE_BREAKPOINT = 768;

// A window this wide can hold a pane beside its list (a People tree beside the selected person);
// below it the person takes the whole pane and a back button leads to the list (People.tsx,
// PersonDetail.tsx). At 1024 the dashboard sidebar leaves the page about 768 px.
export const PANE_BREAKPOINT = 1024;

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = React.useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches
  );

  React.useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    mql.addEventListener("change", onChange);
    setMatches(mql.matches);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

export function useIsMobile() {
  // The width, not just the media query: a test's matchMedia may be a stub whose answer never
  // changes, while the window's innerWidth is what the resize effect reads.
  const narrow = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;
  const [isMobile, setIsMobile] = React.useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(narrow).matches
  );

  React.useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(narrow);
    const onChange = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, [narrow]);

  return isMobile;
}

export function usePanesTogether() {
  return useMediaQuery(`(min-width: ${PANE_BREAKPOINT}px)`);
}
