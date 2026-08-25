import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ThemeProvider, useTheme } from "./ThemeContext";

function ThemeProbe() {
  const { theme, toggleTheme } = useTheme();
  return <button type="button" onClick={toggleTheme}>{theme}</button>;
}

describe("ThemeProvider", () => {
  afterEach(() => {
    document.documentElement.classList.remove("theme-light");
    document.body.classList.remove("theme-light");
    localStorage.clear();
  });

  it("uses the server-selected theme on the first render without a hydration update", () => {
    render(<ThemeProvider initialTheme="light"><ThemeProbe /></ThemeProvider>);

    expect(screen.getByRole("button")).toHaveTextContent("light");
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button")).toHaveTextContent("dark");
    expect(document.documentElement).not.toHaveClass("theme-light");
    expect(document.body).not.toHaveClass("theme-light");
  });
});
