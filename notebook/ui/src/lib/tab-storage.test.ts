import { describe, expect, it } from "vitest";
import { installTabStorage } from "./tab-storage";

function windowWith(get: () => Storage) {
  const win = {} as any;
  Object.defineProperty(win, "localStorage", { configurable: true, get });
  return win as Window;
}

describe("installTabStorage", () => {
  it("replaces storage the browser refuses with storage that works for the tab", () => {
    const win = windowWith(() => { throw new DOMException("denied", "SecurityError"); });
    expect(installTabStorage(win)).toBe(true);
    const s = win.localStorage;
    expect(s.getItem("a")).toBeNull();
    s.setItem("a", "1");
    s.setItem("b", 2 as any);
    expect(s.getItem("a")).toBe("1");
    expect(s.getItem("b")).toBe("2");
    expect(s.length).toBe(2);
    expect([s.key(0), s.key(1), s.key(2)]).toEqual(["a", "b", null]);
    s.removeItem("a");
    expect(s.getItem("a")).toBeNull();
    s.clear();
    expect(s.length).toBe(0);
    expect(win.localStorage).toBe(s);
  });

  it("leaves working storage alone", () => {
    const real = { getItem: () => null } as unknown as Storage;
    const win = windowWith(() => real);
    expect(installTabStorage(win)).toBe(false);
    expect(win.localStorage).toBe(real);
  });

  it("switches to tab-only storage when the browser starts refusing it mid-session", () => {
    let blocked = false;
    const real = { getItem: () => "x" } as unknown as Storage;
    const win = windowWith(() => { if (blocked) throw new DOMException("denied", "SecurityError"); return real; });
    expect(installTabStorage(win)).toBe(false);
    expect(win.localStorage).toBe(real);
    blocked = true;
    const s = win.localStorage;
    s.setItem("a", "1");
    expect(win.localStorage.getItem("a")).toBe("1");
    blocked = false;
    expect(win.localStorage.getItem("a")).toBe("1");
  });
});
