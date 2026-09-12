import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readSearchQuery, writeSearchQuery } from "./search-query";
import { emptySearchResults } from "./search-results";
import { useSearchPage } from "./use-search-page";

const query = readSearchQuery(new URLSearchParams("q=needle"));
const initial = { ...emptySearchResults(query), error: "", postTotalPages: 3, fileTotalPages: 4, marker: "initial" };
function pending() {
  let resolve!: (value: typeof initial) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<typeof initial>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("grouped search navigation", () => {
  beforeEach(() => window.history.replaceState(null, "", "/search?q=needle"));
  it("uses the server snapshot, then loads both pages from restored history", async () => {
    const load = vi.fn().mockImplementation(async target => ({ ...initial, ...target }));
    const view = renderHook(({ target }) => useSearchPage(initial, target, load), { initialProps: { target: query } });
    expect(load).not.toHaveBeenCalled();
    const target = { ...query, postPage: 2, filePage: 3 };
    writeSearchQuery(target); view.rerender({ target });
    await waitFor(() => expect(view.result.current.state).toMatchObject({ postPage: 2, filePage: 3 }));
  });
  it("corrects only the exhausted section without adding a history entry", async () => {
    const target = { ...query, postPage: 9, filePage: 3 };
    writeSearchQuery(target);
    const load = vi.fn().mockImplementation(async target => ({ ...initial, ...target, postTotalPages: 2 }));
    const view = renderHook(() => useSearchPage({ ...initial, ...target }, target, load));
    await waitFor(() => expect(view.result.current.state.postPage).toBe(2));
    expect(view.result.current.state.filePage).toBe(3);
    expect(new URLSearchParams(window.location.search).get("post_page")).toBe("2");
    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenLastCalledWith({ ...target, postPage: 2 });
  });
  it("ignores superseded responses and retains the latest failed target for retry", async () => {
    const old = pending(), latest = pending();
    const load = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise).mockResolvedValue({ ...initial, query: "latest", marker: "retried" });
    const view = renderHook(() => useSearchPage(initial, query, load));
    act(() => {
      const target = { ...query, query: "old" }; writeSearchQuery(target); void view.result.current.run(target);
      const next = { ...query, query: "latest" }; writeSearchQuery(next); void view.result.current.run(next);
    });
    await act(async () => old.resolve({ ...initial, postPage: 99, postTotalPages: 1, marker: "stale" }));
    expect(view.result.current.state.marker).toBe("initial");
    expect(view.result.current.loading).toBe(true);
    await act(async () => latest.reject(new Error("offline")));
    expect(view.result.current.state.error).toBe("offline");
    await act(() => view.result.current.retry());
    expect(load).toHaveBeenLastCalledWith({ ...query, query: "latest" });
    expect(view.result.current.state.marker).toBe("retried");
  });
  it("does not apply corrections after navigating away or unmounting", async () => {
    const request = pending(); const load = vi.fn().mockReturnValue(request.promise);
    const view = renderHook(() => useSearchPage(initial, query, load));
    act(() => { void view.result.current.run(query); });
    window.history.pushState(null, "", "/posts"); view.unmount();
    await act(async () => request.resolve({ ...initial, postPage: 9, postTotalPages: 1 }));
    expect(window.location.pathname).toBe("/posts");
    expect(load).toHaveBeenCalledTimes(1);
  });
  it("does not let delayed initial normalization rewrite a newer URL", () => {
    let frame!: FrameRequestCallback;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { frame = callback; return 1; });
    renderHook(() => useSearchPage(initial, query, vi.fn()));
    window.history.pushState(null, "", "/posts");
    act(() => frame(0));
    expect(window.location.pathname).toBe("/posts");
  });
});
