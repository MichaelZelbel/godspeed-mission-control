import * as React from "react";

const MOBILE_BREAKPOINT = 768;

// A window this wide can hold a pane beside its list (a People tree beside the selected person);
// below it the person takes the whole pane and a back button leads to the list (People.tsx,
// PersonDetail.tsx). At 1024 the dashboard sidebar leaves the page about 768 px.
export const PANE_BREAKPOINT = 1024;

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = React.useState(() =>
    typeof window !== "undefined" && window.matchMedia(query).matches
  );

  React.useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    mql.addEventListener("change", onChange);
    setMatches(mql.matches);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

export function useIsMobile() {
  return useMediaQuery(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
}

export function usePanesTogether() {
  return useMediaQuery(`(min-width: ${PANE_BREAKPOINT}px)`);
}
