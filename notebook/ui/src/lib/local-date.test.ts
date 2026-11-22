import { describe, expect, it } from "vitest";
import { format } from "date-fns";
import {
  DAY_FORMAT,
  NOT_SET,
  TIME_FORMAT,
  dayOf,
  localDateISO,
  localTimeHM,
  parseDateOnly,
  parseInstant,
  parseTypedDay,
  showDate,
} from "./local-date";

describe("showDate", () => {
  it("shows a plain stored day as that day, whatever zone the reader is in", () => {
    expect(showDate("2026-11-21", "day")).toBe("Nov 21, 2026");
    expect(showDate("2026-11-21T00:00:00+00:00", "day")).toBe("Nov 21, 2026");
    expect(showDate("2026-11-21", "date")).toBe("Nov 21, 2026");
  });

  it("shows a timestamp as the viewer's local day", () => {
    const ts = new Date(2026, 10, 21, 14, 5).toISOString();
    expect(showDate(ts, "date")).toBe(format(new Date(ts), DAY_FORMAT));
    expect(showDate(ts, "time")).toBe(format(new Date(ts), TIME_FORMAT));
  });

  it("shows the clock time with 24-hour digits", () => {
    expect(showDate(new Date(2026, 10, 21, 14, 5), "time")).toBe("Nov 21, 2026, 14:05");
  });

  it("shows an instant relative to now", () => {
    expect(showDate(new Date(Date.now() - 3 * 60_000), "ago")).toMatch(/minutes ago$/);
  });

  it("reads Not set for a missing or unreadable value, without throwing", () => {
    for (const value of [null, undefined, "", "not a date", "NaN", new Date(NaN)]) {
      for (const kind of ["day", "date", "time", "ago"] as const) {
        expect(showDate(value as never, kind)).toBe(NOT_SET);
      }
    }
  });

  // Criterion 4: a plain stored day renders as the same day west of UTC too.
  it("a plain stored day reads as the same day in Los Angeles", () => {
    expect(showDate("2025-03-05", "date")).toBe("Mar 5, 2025");
    expect(showDate("2025-03-05", "day")).toBe("Mar 5, 2025");
    if (process.env.TZ === "America/Los_Angeles") {
      expect(new Date(2025, 2, 5).getTimezoneOffset()).toBe(480);
    }
  });
});

describe("parseInstant", () => {
  it("reads a plain day as its local midnight", () => {
    const d = parseInstant("2026-11-21");
    expect(d?.getHours()).toBe(0);
    expect(d?.getDate()).toBe(21);
    expect(d?.getMonth()).toBe(10);
  });

  it("reads a timestamp string, epoch ms and Date, and nothing for unreadable values", () => {
    const ts = new Date(2026, 10, 21, 14, 5).getTime();
    expect(parseInstant(ts)?.getTime()).toBe(ts);
    expect(parseInstant(new Date(ts))?.getTime()).toBe(ts);
    expect(parseInstant(new Date(ts).toISOString())?.getTime()).toBe(ts);
    expect(parseInstant(null)).toBeNull();
    expect(parseInstant(undefined)).toBeNull();
    expect(parseInstant("")).toBeNull();
    expect(parseInstant("x")).toBeNull();
  });
});

describe("localTimeHM", () => {
  it("pads the clock time to two digits", () => {
    expect(localTimeHM(new Date(2026, 10, 21, 9, 5))).toBe("09:05");
    expect(localTimeHM(new Date(2026, 10, 21, 14, 5))).toBe("14:05");
    expect(localTimeHM("x")).toBe("");
  });
});

describe("parseTypedDay", () => {
  it("reads the day the user typed", () => {
    for (const text of ["2026-11-21", "21.11.2026", "11/21/2026", "2026/11/21"]) {
      const d = parseTypedDay(text);
      expect(d?.getDate()).toBe(21);
      expect(d?.getMonth()).toBe(10);
      expect(d?.getFullYear()).toBe(2026);
    }
    expect(parseTypedDay("21.13.2026")).toBeNull();
    expect(parseTypedDay("")).toBeNull();
  });
});

describe("existing helpers", () => {
  it("keep their behaviour", () => {
    expect(dayOf("2026-11-21T00:00:00+00:00")).toBe("2026-11-21");
    expect(localDateISO(new Date(2026, 10, 21))).toBe("2026-11-21");
    expect(parseDateOnly("2026-11-21T00:00:00+00:00")?.getDate()).toBe(21);
    expect(parseDateOnly("2026-11-21")?.getDate()).toBe(21);
    expect(parseDateOnly(null)).toBeNull();
  });
});
