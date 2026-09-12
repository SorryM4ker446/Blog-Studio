import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider, useTheme } from "./ThemeContext";

function ThemeProbe() {
  const { theme, toggleTheme } = useTheme();
  return <button type="button" onClick={toggleTheme}>{theme}</button>;
}

describe("ThemeProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.documentElement.classList.remove("theme-light");
    document.body.classList.remove("theme-light");
    localStorage.clear();
  });

  it("uses the server-selected theme on the first render without a hydration update", () => {
    localStorage.setItem("blog_theme", "dark");
    render(<ThemeProvider initialTheme="light"><ThemeProbe /></ThemeProvider>);

    expect(screen.getByRole("button")).toHaveTextContent("light");
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button")).toHaveTextContent("dark");
    expect(document.documentElement).not.toHaveClass("theme-light");
    expect(document.body).not.toHaveClass("theme-light");
  });

  it.each(["storage getter", "storage methods", "cookie setter"])("keeps theme switching usable with a denied %s", (failure) => {
    const denied = () => { throw new DOMException("Denied", "SecurityError"); };
    if (failure === "storage getter") vi.spyOn(window, "localStorage", "get").mockImplementation(denied);
    if (failure === "storage methods") {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(denied);
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(denied);
    }
    if (failure === "cookie setter") vi.spyOn(document, "cookie", "set").mockImplementation(denied);
    render(<ThemeProvider><ThemeProbe /></ThemeProvider>);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button")).toHaveTextContent("light");
    expect(document.documentElement).toHaveClass("theme-light");
    expect(document.body).toHaveClass("theme-light");
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button")).toHaveTextContent("dark");
    expect(document.documentElement).not.toHaveClass("theme-light");
  });
});
