import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@/context/ThemeContext";
import TopBar from "./TopBar";

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ profile: null }),
}));

describe("TopBar theme action", () => {
  afterEach(() => {
    document.documentElement.classList.remove("theme-light");
    document.body.classList.remove("theme-light");
    document.cookie = "blog_theme=; max-age=0; path=/";
    localStorage.clear();
  });

  it("places an accessible theme toggle between refresh and more actions", async () => {
    const user = userEvent.setup();
    render(<ThemeProvider initialTheme="dark"><TopBar /></ThemeProvider>);

    expect(screen.getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
      "Refresh page",
      "Switch to Light Mode",
      "More options",
    ]);

    await user.click(screen.getByRole("button", { name: "Switch to Light Mode" }));

    expect(document.documentElement).toHaveClass("theme-light");
    expect(document.body).toHaveClass("theme-light");
    expect(screen.getByRole("button", { name: "Switch to Dark Mode" })).toBeVisible();
    expect(localStorage.getItem("blog_theme")).toBe("light");
    expect(document.cookie).toContain("blog_theme=light");
  });
});
