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

function findDescriptor(win: Window): PropertyDescriptor | undefined {
  for (let o: any = win; o; o = Object.getPrototypeOf(o)) {
    const d = Object.getOwnPropertyDescriptor(o, "localStorage");
    if (d) return d;
  }
  return undefined;
}

/**
 * Returns whether the tab-only stand-in is now what `win.localStorage` answers with.
 * When storage works at startup it is still guarded: if the browser starts refusing site data mid-session (#1014),
 * the next read switches to tab-only storage for the rest of the tab instead of throwing.
 */
export function installTabStorage(win: Window = window): boolean {
  const original = findDescriptor(win);
  const tab = new TabStorage();
  const useTab = () => {
    try {
      Object.defineProperty(win, "localStorage", { configurable: true, enumerable: true, get: () => tab });
    } catch { /* leave the getter below; it keeps answering with the tab storage */ }
  };
  let failed = false;
  try {
    win.localStorage.getItem("godspeed:storage-probe");
  } catch {
    useTab();
    return true;
  }
  if (!original?.get) return false;
  try {
    Object.defineProperty(win, "localStorage", {
      configurable: true,
      enumerable: original.enumerable ?? true,
      get() {
        if (failed) return tab;
        try {
          return original.get!.call(win);
        } catch {
          failed = true;
          useTab();
          return tab;
        }
      },
    });
  } catch { /* storage stays unguarded */ }
  return false;
}

export const tabOnlyStorage: boolean = typeof window !== "undefined" && installTabStorage();
