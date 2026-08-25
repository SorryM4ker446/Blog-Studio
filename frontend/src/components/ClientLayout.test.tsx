import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Link from "next/link";
import ClientLayout from "./ClientLayout";

const navigationState = vi.hoisted(() => ({
  pathname: "/",
  searchParams: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigationState.pathname,
  useSearchParams: () => navigationState.searchParams,
}));

vi.mock("./Providers", () => ({
  useSidebar: () => ({ isCollapsed: false, toggleSidebar: vi.fn() }),
  SidebarContent: () => <nav>Sidebar content</nav>,
  SidebarFooter: () => <footer>Sidebar footer</footer>,
}));

vi.mock("./TopBar", () => ({
  default: () => <header>Top bar</header>,
}));

vi.mock("./Icons", () => ({
  TriangleIcon: () => <span>Toggle icon</span>,
  StudioLogo: () => <span>Studio logo</span>,
}));

describe("ClientLayout route transitions", () => {
  beforeEach(() => {
    navigationState.pathname = "/";
    navigationState.searchParams = new URLSearchParams();
    window.sessionStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("animates client route changes without animating the initial page", () => {
    const view = render(<ClientLayout><p>Home</p></ClientLayout>);
    let frame = screen.getByText("Home").parentElement!;

    expect(frame).toHaveClass("route-transition-frame");
    expect(frame).not.toHaveClass("route-transition-active");

    navigationState.pathname = "/editor";
    view.rerender(<ClientLayout><p>Editor</p></ClientLayout>);
    frame = screen.getByText("Editor").parentElement!;

    expect(frame).toHaveClass("route-transition-active");

    const activeFrame = frame;
    view.rerender(<ClientLayout><p>Updated editor</p></ClientLayout>);
    expect(screen.getByText("Updated editor").parentElement).toBe(activeFrame);
  });

  it("animates category navigation but preserves the frame for other query changes", () => {
    navigationState.pathname = "/posts";
    navigationState.searchParams = new URLSearchParams("category=1");
    const view = render(<ClientLayout><p>Category one</p></ClientLayout>);
    let frame = screen.getByText("Category one").parentElement!;

    expect(frame).not.toHaveClass("route-transition-active");

    navigationState.searchParams = new URLSearchParams("category=1&q=typescript");
    view.rerender(<ClientLayout><p>Filtered category one</p></ClientLayout>);
    expect(screen.getByText("Filtered category one").parentElement).not.toHaveClass("route-transition-active");

    navigationState.searchParams = new URLSearchParams("category=2");
    view.rerender(<ClientLayout><p>Category two</p></ClientLayout>);
    expect(screen.getByText("Category two").parentElement).toHaveClass("route-transition-active");
  });

  it("stores the inner content position on internal link navigation", () => {
    render(
      <ClientLayout>
        <Link href="/posts/42" onClick={(event) => event.preventDefault()}>Open post</Link>
      </ClientLayout>,
    );
    const scrollContainer = document.querySelector<HTMLElement>(".content-scroll")!;
    scrollContainer.scrollTop = 640;

    fireEvent.click(screen.getByRole("link", { name: "Open post" }));

    const storedKey = Object.keys(window.sessionStorage).find((key) => key.startsWith("blogStudio:contentScroll:"));
    expect(storedKey).toBe("blogStudio:contentScroll:%2F");
    expect(window.sessionStorage.getItem(storedKey!)).toBe("640");
  });

  it("restores the inner content position recorded on a history entry", async () => {
    navigationState.pathname = "/posts/42";
    navigationState.searchParams = new URLSearchParams();
    window.sessionStorage.setItem(
      "blogStudio:contentScroll:%2Fposts%3Fcategory%3D2%26q%3Dgo",
      "520",
    );
    const view = render(<ClientLayout><p>Post detail</p></ClientLayout>);

    window.dispatchEvent(new PopStateEvent("popstate"));
    navigationState.pathname = "/posts";
    navigationState.searchParams = new URLSearchParams("category=2&q=go");
    window.history.replaceState({}, "", "/posts?category=2&q=go");
    view.rerender(<ClientLayout><p>Filtered posts</p></ClientLayout>);

    await waitFor(() => {
      expect(document.querySelector<HTMLElement>(".content-scroll")).toHaveProperty("scrollTop", 520);
    });
  });

  it("keeps retrying a history restoration until delayed content is tall enough", async () => {
    navigationState.pathname = "/posts/42";
    navigationState.searchParams = new URLSearchParams();
    window.sessionStorage.setItem("blogStudio:contentScroll:%2Fposts", "520");
    const view = render(<ClientLayout><p>Post detail</p></ClientLayout>);
    const scrollContainer = document.querySelector<HTMLElement>(".content-scroll")!;
    let scrollTop = 0;
    let scrollHeight = 200;
    const clientHeight = 200;

    Object.defineProperties(scrollContainer, {
      clientHeight: { configurable: true, get: () => clientHeight },
      scrollHeight: { configurable: true, get: () => scrollHeight },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = Math.min(Math.max(0, value), Math.max(0, scrollHeight - clientHeight));
        },
      },
    });

    window.dispatchEvent(new PopStateEvent("popstate"));
    navigationState.pathname = "/posts";
    window.history.replaceState({}, "", "/posts");
    view.rerender(<ClientLayout><p>Posts loading</p></ClientLayout>);

    await new Promise((resolve) => window.setTimeout(resolve, 80));
    expect(scrollTop).toBe(0);
    scrollHeight = 1_000;

    await waitFor(() => expect(scrollTop).toBe(520));
  });
});
