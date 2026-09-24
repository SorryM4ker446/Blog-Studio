import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Link from "next/link";
import ClientLayout from "./ClientLayout";
import { installNavigationEntries, readNavigationEntry, saveEntryScroll } from "@/lib/navigation-entry";

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
  let dispose: () => void;
  afterEach(() => dispose());
  beforeEach(() => {
    navigationState.pathname = "/";
    navigationState.searchParams = new URLSearchParams();
    window.sessionStorage.clear();
    window.history.replaceState({}, "", "/");
    dispose = installNavigationEntries();
  });

  it("focuses main content for a new path while preserving focus on query changes and history", () => {
    const view = render(<ClientLayout><button>Keep focus</button></ClientLayout>);
    const button = screen.getByRole("button", { name: "Keep focus" });
    button.focus();
    navigationState.pathname = "/posts";
    view.rerender(<ClientLayout><button>Keep focus</button></ClientLayout>);
    expect(screen.getByRole("main")).toHaveFocus();
    screen.getByRole("button", { name: "Keep focus" }).focus();
    navigationState.searchParams = new URLSearchParams("q=example");
    view.rerender(<ClientLayout><button>Keep focus</button></ClientLayout>);
    expect(screen.getByRole("button", { name: "Keep focus" })).toHaveFocus();
    window.dispatchEvent(new PopStateEvent("popstate"));
    navigationState.pathname = "/drive";
    view.rerender(<ClientLayout><button>Keep focus</button></ClientLayout>);
    expect(screen.getByRole("main")).not.toHaveFocus();
  });

  it("retains route entry animation when returning from an article to its list", () => {
    navigationState.pathname = "/posts/12";
    const view = render(<ClientLayout><p>Article</p></ClientLayout>);
    navigationState.pathname = "/posts";
    navigationState.searchParams = new URLSearchParams("category=2&page=2");
    view.rerender(<ClientLayout><p>Restored list</p></ClientLayout>);
    expect(screen.getByText("Restored list").parentElement).toHaveClass("route-transition-active");
  });

  it("retains route entry animation when returning from an article to Content Editor", () => {
    navigationState.pathname = "/posts/12";
    const view = render(<ClientLayout><p>Article</p></ClientLayout>);
    navigationState.pathname = "/editor";
    navigationState.searchParams = new URLSearchParams("page=2");
    view.rerender(<ClientLayout><p>Editor list</p></ClientLayout>);
    expect(screen.getByText("Editor list").parentElement).toHaveClass("route-transition-active");
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

    expect(readNavigationEntry()?.scroll).toBe(640);
  });

  it("resets inner content scroll on a fresh path navigation", () => {
    navigationState.pathname = "/posts";
    navigationState.searchParams = new URLSearchParams();
    window.history.replaceState({}, "", "/posts");
    const view = render(<ClientLayout><p>Posts list</p></ClientLayout>);
    const scroll = document.querySelector<HTMLElement>(".content-scroll")!;
    scroll.scrollTop = 640;
    fireEvent.scroll(scroll);
    expect(readNavigationEntry()?.scroll).toBe(640);

    window.history.pushState({}, "", "/posts/42");
    navigationState.pathname = "/posts/42";
    view.rerender(<ClientLayout><p>Post detail</p></ClientLayout>);

    expect(scroll.scrollTop).toBe(0);
    expect(readNavigationEntry()?.scroll).toBe(0);
  });

  it("resets a fresh detail navigation and restores the list position on history return", async () => {
    navigationState.pathname = "/posts";
    navigationState.searchParams = new URLSearchParams();
    window.history.replaceState({}, "", "/posts");
    const view = render(<ClientLayout><p>Posts list</p></ClientLayout>);
    const scroll = document.querySelector<HTMLElement>(".content-scroll")!;
    scroll.scrollTop = 640;
    fireEvent.scroll(scroll);
    expect(readNavigationEntry()?.scroll).toBe(640);
    const listState = history.state;

    window.history.pushState({}, "", "/posts/42");
    navigationState.pathname = "/posts/42";
    view.rerender(<ClientLayout><p>Post detail</p></ClientLayout>);
    expect(scroll.scrollTop).toBe(0);

    window.history.replaceState(listState, "", "/posts");
    window.dispatchEvent(new PopStateEvent("popstate"));
    navigationState.pathname = "/posts";
    view.rerender(<ClientLayout><p>Posts list</p></ClientLayout>);

    await waitFor(() => expect(scroll.scrollTop).toBe(640));
    expect(readNavigationEntry()?.scroll).toBe(640);
  });

  it("records the latest position synchronously before refresh or closing the page", () => {
    render(<ClientLayout><p>Contents</p></ClientLayout>);
    const content = document.querySelector<HTMLElement>(".content-scroll")!;
    content.scrollTop = 241;
    fireEvent.scroll(content);
    window.dispatchEvent(new Event("beforeunload"));
    expect(readNavigationEntry()?.scroll).toBe(241);
    content.scrollTop = 320;
    window.dispatchEvent(new Event("pagehide"));
    expect(readNavigationEntry()?.scroll).toBe(320);
  });

  it("restores a reload before paint without triggering entry animation", () => {
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([{ type: "reload" } as PerformanceNavigationTiming]);
    saveEntryScroll(280);
    render(<ClientLayout><p>Reloaded content</p></ClientLayout>);
    expect(document.querySelector(".content-scroll")).toHaveProperty("scrollTop", 280);
    expect(screen.getByText("Reloaded content").parentElement).not.toHaveClass("route-transition-active");
  });

  it("keeps recording scroll after the skip link focuses main content without navigation", async () => {
    render(<ClientLayout><p>Contents</p></ClientLayout>);
    fireEvent.click(screen.getByRole("link", { name: "Skip to main content" }));
    expect(screen.getByRole("main")).toHaveFocus();
    const content = document.querySelector<HTMLElement>(".content-scroll")!;
    content.scrollTop = 140;
    fireEvent.scroll(content);
    await waitFor(() => expect(readNavigationEntry()?.scroll).toBe(140));
  });

  it("uses the committed route when history fires before passive listeners can refresh", () => {
    navigationState.pathname = "/posts";
    history.replaceState({}, "", "/posts");
    const listeners = vi.spyOn(window, "addEventListener");
    const view = render(<ClientLayout><p>List</p></ClientLayout>);
    const onPop = listeners.mock.calls.find(([name]) => name === "popstate")![1] as EventListener;
    history.pushState({}, "", "/posts/42");
    navigationState.pathname = "/posts/42";
    view.rerender(<ClientLayout><p>Detail</p></ClientLayout>);
    history.replaceState({}, "", "/posts");
    saveEntryScroll(400);
    const scroll = document.querySelector<HTMLElement>(".content-scroll")!;
    onPop(new PopStateEvent("popstate"));
    expect(scroll.scrollTop).toBe(0);
    navigationState.pathname = "/posts";
    view.rerender(<ClientLayout><p>List</p></ClientLayout>);
    expect(scroll.scrollTop).toBe(400);
  });

  it("restores the inner content position recorded on a history entry", async () => {
    navigationState.pathname = "/posts/42";
    navigationState.searchParams = new URLSearchParams();

    const view = render(<ClientLayout><p>Post detail</p></ClientLayout>);

    window.dispatchEvent(new PopStateEvent("popstate"));
    navigationState.pathname = "/posts";
    navigationState.searchParams = new URLSearchParams("category=2&q=go");
    window.history.replaceState({}, "", "/posts?category=2&q=go");
    saveEntryScroll(520);
    view.rerender(<ClientLayout><p>Filtered posts</p></ClientLayout>);

    await waitFor(() => {
      expect(document.querySelector<HTMLElement>(".content-scroll")).toHaveProperty("scrollTop", 520);
    });
  });

  it("keeps retrying a history restoration until delayed content is tall enough", async () => {
    navigationState.pathname = "/posts/42";
    navigationState.searchParams = new URLSearchParams();

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
    saveEntryScroll(520);
    view.rerender(<ClientLayout><p>Posts loading</p></ClientLayout>);

    await new Promise((resolve) => window.setTimeout(resolve, 80));
    expect(scrollTop).toBe(0);
    scrollHeight = 1_000;

    await waitFor(() => expect(scrollTop).toBe(520));
  });
});