import { afterEach, describe, expect, it, vi } from "vitest";
import { parsePreference, readPreference, writePreference, type PreferenceName } from "./preference-cookies";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("preference cookies", () => {
  it.each([
    ["blog_theme", "light", "dark"],
    ["sidebar_collapsed", "true", "false"],
    ["sidebar_posts_expanded", "true", "false"],
    ["sidebar_categories_all", "true", "false"],
  ] as const)("shares strict values and defaults for %s", (name, selected, fallback) => {
    expect(readPreference({ get: () => ({ value: selected }) }, name)).toBe(selected);
    expect(readPreference({ get: () => undefined }, name)).toBe(fallback);
    expect(parsePreference(name, fallback)).toBe(fallback);
    for (const value of [null, true, 1, "", "TRUE", "Light", " light ", "true; path=/", "%74rue"]) {
      expect(parsePreference(name, value)).toBe(fallback);
    }
  });

  it("writes only valid values with the same lifetime and scope", () => {
    const setter = vi.spyOn(document, "cookie", "set").mockImplementation(() => {});
    for (const name of ["blog_theme", "sidebar_collapsed", "sidebar_posts_expanded", "sidebar_categories_all"] as PreferenceName[]) {
      const value = name === "blog_theme" ? "light" : "true";
      writePreference(name, value);
      expect(setter).toHaveBeenLastCalledWith(`${name}=${value}; path=/; max-age=31536000; samesite=lax`);
    }
    setter.mockClear();
    // @ts-expect-error Exercise the runtime boundary for callers without types.
    writePreference("blog_theme", "light; injected=true");
    expect(setter).not.toHaveBeenCalled();
  });

  it("contains denied cookie writes without attempting a storage fallback", () => {
    const storage = vi.spyOn(window, "localStorage", "get");
    vi.spyOn(document, "cookie", "set").mockImplementation(() => { throw new DOMException("Denied", "SecurityError"); });
    expect(() => writePreference("blog_theme", "light")).not.toThrow();
    expect(storage).not.toHaveBeenCalled();
  });

  it("can be imported and called without browser globals", () => {
    vi.stubGlobal("document", undefined);
    expect(readPreference({ get: () => ({ value: "light" }) }, "blog_theme")).toBe("light");
    expect(() => writePreference("blog_theme", "dark")).not.toThrow();
  });
});
