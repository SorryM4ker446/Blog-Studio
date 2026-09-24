import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { HomepageLink } from "@/lib/links";
import { createLink, getAdminLinks, moveLink } from "@/lib/links";
import useLinksManager from "./LinksManager";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(window.location.search) }));
vi.mock("@/lib/links", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/links")>(),
  getAdminLinks: vi.fn(), createLink: vi.fn(), moveLink: vi.fn(), updateLink: vi.fn(), deleteLink: vi.fn(),
}));

const link = (id: number): HomepageLink => ({ id, title: `Link ${id}`, description: "", url: "", icon: "link", color: "blue", visible: false, position: id, version: 1 });
const initial = [link(1), link(2)];
function Harness({ active = true, links = initial, error = "" }: { active?: boolean; links?: HomepageLink[]; error?: string }) {
  const manager = useLinksManager(active, links, error);
  return <><span data-testid="loading">{String(manager.loading)}</span><span data-testid="count">{manager.count ?? "unknown"}</span>{active && <>{manager.toolbar}{manager.content}{manager.dialogs}</>}</>;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  window.history.replaceState(null, "", "/editor?tab=links");
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
});
afterEach(() => vi.unstubAllGlobals());

it.each([{ links: initial }, { links: [] }])("reuses the resolved list, including empty results, across tab changes", ({ links }) => {
  const view = render(<Harness links={links} />);
  view.rerender(<Harness active={false} links={links} />);
  view.rerender(<Harness links={links} />);
  expect(getAdminLinks).not.toHaveBeenCalled();
  expect(screen.getByTestId("loading")).toHaveTextContent("false");
  expect(screen.getByRole("button", { name: "+ New Link" })).toBeEnabled();
  expect(screen.queryAllByRole("article")).toHaveLength(links.length);
});

it("allows a draft during ordering, blocks submission and preserves it until the write finishes", async () => {
  const pending = deferred<HomepageLink[]>();
  vi.mocked(moveLink).mockReturnValue(pending.promise);
  vi.mocked(createLink).mockResolvedValue(link(3));
  render(<Harness />);
  const move = screen.getByRole("button", { name: "Move Link 1 later" });
  fireEvent.click(move);
  fireEvent.click(move);
  expect(moveLink).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "+ New Link" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "+ New Link" }));
  const dialog = screen.getByRole("dialog", { name: "New link" });
  fireEvent.change(within(dialog).getByLabelText("TITLE"), { target: { value: "Link 3" } });
  fireEvent.click(within(dialog).getByLabelText("Show on homepage"));
  expect(within(dialog).getByRole("button", { name: "Save link" })).toBeDisabled();
  expect(within(dialog).getByRole("status")).toHaveTextContent("Wait for the current link update");
  fireEvent.submit(dialog.querySelector("form")!);
  expect(createLink).not.toHaveBeenCalled();
  await act(async () => pending.resolve([{ ...link(2), position: 1 }, { ...link(1), position: 2 }]));
  expect(within(dialog).getByLabelText("TITLE")).toHaveValue("Link 3");
  fireEvent.click(within(dialog).getByRole("button", { name: "Save link" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(createLink).toHaveBeenCalledOnce();
  expect(screen.getByTestId("count")).toHaveTextContent("3");
  expect(screen.getAllByRole("article").map(node => node.getAttribute("aria-label"))).toEqual(["Link 2", "Link 1", "Link 3"]);
});

it("preserves local mutations on return without another read", async () => {
  vi.mocked(moveLink).mockResolvedValue([link(2), link(1)]);
  const view = render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Move Link 1 later" }));
  await waitFor(() => expect(screen.getAllByRole("article")[0]).toHaveAttribute("aria-label", "Link 2"));
  view.rerender(<Harness active={false} />);
  view.rerender(<Harness />);
  expect(screen.getAllByRole("article")[0]).toHaveAttribute("aria-label", "Link 2");
  expect(getAdminLinks).not.toHaveBeenCalled();
});

it("invalidates the list after a failed save so re-entering can recover current server state", async () => {
  vi.mocked(createLink).mockRejectedValue(new Error("Save could not be confirmed"));
  vi.mocked(getAdminLinks).mockResolvedValue([...initial, link(3)]);
  const view = render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "+ New Link" }));
  fireEvent.change(screen.getByLabelText("TITLE"), { target: { value: "Unconfirmed draft" } });
  fireEvent.click(screen.getByLabelText("Show on homepage"));
  fireEvent.click(screen.getByRole("button", { name: "Save link" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Save could not be confirmed"));
  expect(screen.getByLabelText("TITLE")).toHaveValue("Unconfirmed draft");
  expect(getAdminLinks).not.toHaveBeenCalled();
  view.rerender(<Harness active={false} />);
  view.rerender(<Harness />);
  await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("3"));
  expect(getAdminLinks).toHaveBeenCalledOnce();
});

it("ignores an aborted read after tab cancellation and resolves the next entry", async () => {
  const old = deferred<HomepageLink[]>(), next = deferred<HomepageLink[]>();
  vi.mocked(getAdminLinks).mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  const view = render(<Harness links={[]} error="Initial read failed" />);
  expect(screen.getByRole("button", { name: "+ New Link" })).toBeEnabled();
  const signal = vi.mocked(getAdminLinks).mock.calls[0][0]!;
  view.rerender(<Harness active={false} links={[]} error="Initial read failed" />);
  expect(signal.aborted).toBe(true);
  view.rerender(<Harness links={[]} error="Initial read failed" />);
  await act(async () => next.resolve([link(2)]));
  await act(async () => old.resolve([link(1)]));
  expect(screen.getByRole("article")).toHaveAttribute("aria-label", "Link 2");
  expect(screen.getByTestId("loading")).toHaveTextContent("false");
  view.rerender(<Harness active={false} links={[]} error="Initial read failed" />);
  view.rerender(<Harness links={[]} error="Initial read failed" />);
  expect(getAdminLinks).toHaveBeenCalledTimes(2);
});

it("retries a failed initial read and blocks saving an incomplete list without disabling draft entry", async () => {
  vi.mocked(getAdminLinks).mockRejectedValueOnce(new Error("Read unavailable")).mockResolvedValueOnce([]);
  render(<Harness links={[]} error="Initial read failed" />);
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Read unavailable"));
  fireEvent.click(screen.getByRole("button", { name: "+ New Link" }));
  expect(screen.getByRole("button", { name: "Save link" })).toBeDisabled();
  expect(screen.getByText("Close this dialog and retry loading links before saving.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(screen.getByRole("heading", { name: "No links yet" })).toBeVisible());
  expect(getAdminLinks).toHaveBeenCalledTimes(2);
});

it("refreshes after a failed reorder and leaves draft input usable while refreshing", async () => {
  vi.mocked(moveLink).mockRejectedValue(new Error("Order changed elsewhere"));
  const read = deferred<HomepageLink[]>();
  vi.mocked(getAdminLinks).mockReturnValue(read.promise);
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Move Link 1 later" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Order changed elsewhere"));
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  fireEvent.click(screen.getByRole("button", { name: "+ New Link" }));
  fireEvent.change(screen.getByLabelText("TITLE"), { target: { value: "Retained draft" } });
  expect(screen.getByRole("button", { name: "Save link" })).toBeDisabled();
  await act(async () => read.resolve(initial));
  expect(screen.getByLabelText("TITLE")).toHaveValue("Retained draft");
  expect(screen.getByRole("button", { name: "Save link" })).toBeEnabled();
});

it("rechecks the link limit when an in-flight reorder completes with a fuller list", async () => {
  const pending = deferred<HomepageLink[]>();
  vi.mocked(moveLink).mockReturnValue(pending.promise);
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Move Link 1 later" }));
  fireEvent.click(screen.getByRole("button", { name: "+ New Link" }));
  await act(async () => pending.resolve(Array.from({ length: 100 }, (_, i) => link(i + 1))));
  expect(screen.getByRole("button", { name: "Save link" })).toBeDisabled();
  expect(screen.getByText(/You can have up to 100 links/)).toBeVisible();
  fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);
  expect(createLink).not.toHaveBeenCalled();
});

it("does not carry a prior account's delayed response into a new session", async () => {
  const old = deferred<HomepageLink[]>();
  vi.mocked(getAdminLinks).mockReturnValue(old.promise);
  const view = render(<Harness key="account-1" links={[]} error="Reload for account" />);
  view.rerender(<Harness key="account-2" links={[]} />);
  await act(async () => old.resolve(initial));
  expect(screen.queryAllByRole("article")).toHaveLength(0);
  expect(screen.getByTestId("count")).toHaveTextContent("0");
});

it("counts matching links rather than the unfiltered collection", () => {
  window.history.replaceState(null, "", "/editor?tab=links&link_q=Link%202");
  render(<Harness />);
  expect(screen.getByTestId("count")).toHaveTextContent("1");
  expect(screen.getAllByRole("article")).toHaveLength(1);
});
