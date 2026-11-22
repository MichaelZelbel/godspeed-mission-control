// When the browser refuses site data, reading window.localStorage throws a SecurityError (#989).
// Every reader then fails, so this stands in for it with storage that lasts only for the open tab.
// sessionStorage is left alone on purpose: its two readers already cope, and the stale-chunk reload
// guard in ErrorBoundary needs a value that survives a reload, which memory cannot give.

export class TabStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(String(key)) ?? null; }
  setItem(key: string, value: string) { this.values.set(String(key), String(value)); }
  removeItem(key: string) { this.values.delete(String(key)); }
  clear() { this.values.clear(); }
  [name: string]: any;
}

/** Returns whether the tab-only stand-in is now what `win.localStorage` answers with. */
export function installTabStorage(win: Window = window): boolean {
  try {
    win.localStorage.getItem("godspeed:storage-probe");
    return false;
  } catch {
    try {
      const tab = new TabStorage();
      Object.defineProperty(win, "localStorage", { configurable: true, enumerable: true, get: () => tab });
      return true;
    } catch {
      return false;
    }
  }
}

export const tabOnlyStorage: boolean = typeof window !== "undefined" && installTabStorage();
