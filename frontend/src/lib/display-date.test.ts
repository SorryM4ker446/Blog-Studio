import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime } from "./display-date";

describe("display dates", () => {
  it("formats equivalent instants identically with explicit calendar, zone and 24-hour time", () => {
    for (const value of ["2026-09-12T16:05:09Z", "2026-09-13T00:05:09+08:00", Date.parse("2026-09-12T16:05:09Z")]) {
      expect(formatDate(value)).toBe("2026/09/13");
      expect(formatDateTime(value)).toBe("2026/09/13 00:05:09");
    }
  });

  it("handles midnight, year boundaries, leap days and epoch zero", () => {
    expect(formatDateTime("2025-12-31T16:00:00Z")).toBe("2026/01/01 00:00:00");
    expect(formatDateTime("2024-02-29T15:59:59.999999Z")).toBe("2024/02/29 23:59:59");
    expect(formatDate("2024-02-29T16:00:00Z")).toBe("2024/03/01");
    expect(formatDateTime(0)).toBe("1970/01/01 08:00:00");
  });

  it("uses the same site time through another region's daylight-saving transition", () => {
    expect(formatDateTime("2026-03-08T01:59:59-08:00")).toBe("2026/03/08 17:59:59");
    expect(formatDateTime("2026-03-08T03:00:00-07:00")).toBe("2026/03/08 18:00:00");
  });

  it("shows a stable fallback for missing, invalid and timezone-less timestamps", () => {
    for (const value of [null, undefined, "", "not-a-date", "2026-09-12", "2026-09-12T23:00:00", "2026-99-12T23:00:00Z", NaN, Infinity]) {
      expect(formatDate(value)).toBe("—");
      expect(formatDateTime(value)).toBe("—");
    }
  });
});
