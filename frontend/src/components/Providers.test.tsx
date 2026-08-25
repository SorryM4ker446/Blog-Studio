import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InitialAppShellState } from "@/lib/app-shell-state";
import { Providers, SidebarContent, SidebarFooter } from "./Providers";

const { getCategoriesMock, replaceMock, navigationState } = vi.hoisted(() => ({
  getCategoriesMock: vi.fn(),
  replaceMock: vi.fn(),
  navigationState: {
    pathname: "/",
    searchParams: new URLSearchParams(),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
  usePathname: () => navigationState.pathname,
  useSearchParams: () => navigationState.searchParams,
}));

vi.mock("@/lib/api", () => ({
  getCategories: getCategoriesMock,
  getCurrentUser: vi.fn(),
  getSettings: vi.fn(),
  logoutUser: vi.fn(),
}));

const initialState: InitialAppShellState = {
  user: { id: 1, username: "admin", role: "admin" },
  profile: { name: "Admin", description: "", avatar: "", tag: "Admin" },
  profileResolved: true,
  authStatus: "authenticated",
  authNeedsClientCheck: false,
  categories: [
    { id: 1, name: "TypeScript", post_count: 4 },
    { id: 2, name: "Go", post_count: 3 },
  ],
  categoriesResolved: true,
};

const anonymousState: InitialAppShellState = {
  ...initialState,
  user: null,
  authStatus: "anonymous",
};

describe("sidebar first render state", () => {
  beforeEach(() => {
    getCategoriesMock.mockReset();
    navigationState.pathname = "/";
    navigationState.searchParams = new URLSearchParams();
    document.cookie = "sidebar_posts_expanded=; max-age=0; path=/";
  });

  it("renders server categories and the persisted expanded state without a browser reload", () => {
    render(
      <Providers
        initialAppShellState={initialState}
        initialSidebarPostsExpanded
      >
        <SidebarContent />
      </Providers>,
    );

    expect(screen.getByRole("button", { name: "Toggle categories" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: /TypeScript/ })).toBeVisible();
    expect(screen.getByRole("link", { name: /Content Editor/ })).toBeVisible();
    expect(getCategoriesMock).not.toHaveBeenCalled();
  });

  it("persists the expanded preference for the next server render", () => {
    render(
      <Providers initialAppShellState={initialState}>
        <SidebarContent />
      </Providers>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Toggle categories" }));

    expect(screen.getByRole("button", { name: "Toggle categories" })).toHaveAttribute("aria-expanded", "true");
    expect(document.cookie).toContain("sidebar_posts_expanded=true");
  });

  it("keeps the category container mounted while animating it closed", () => {
    render(
      <Providers initialAppShellState={initialState} initialSidebarPostsExpanded>
        <SidebarContent />
      </Providers>,
    );
    const toggle = screen.getByRole("button", { name: "Toggle categories" });
    const categoryContainer = screen.getByRole("link", { name: /TypeScript/ }).closest(".sidebar-categories")!;

    expect(categoryContainer).toHaveClass("expanded");
    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(categoryContainer).toBeInTheDocument();
    expect(categoryContainer).not.toHaveClass("expanded");
    expect(categoryContainer).toHaveAttribute("aria-hidden", "true");
  });

  it("marks the selected category from the current URL", () => {
    navigationState.pathname = "/posts";
    navigationState.searchParams = new URLSearchParams("category=2");

    render(
      <Providers initialAppShellState={initialState}>
        <SidebarContent />
      </Providers>,
    );

    expect(screen.getByRole("button", { name: "Toggle categories" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: /Go/ })).toHaveClass("active");
    expect(screen.getByRole("link", { name: /Go/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /TypeScript/ })).not.toHaveClass("active");
  });

  it("shows settings only to authenticated users", () => {
    const authenticatedView = render(
      <Providers initialAppShellState={initialState}>
        <SidebarFooter />
      </Providers>,
    );

    expect(screen.getByRole("link", { name: "Settings (Admin)" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Login" })).not.toBeInTheDocument();

    authenticatedView.unmount();
    render(
      <Providers initialAppShellState={anonymousState}>
        <SidebarFooter />
      </Providers>,
    );

    expect(screen.getByRole("link", { name: "Login" })).toBeVisible();
    expect(screen.queryByRole("link", { name: /Settings/ })).not.toBeInTheDocument();
  });
});
