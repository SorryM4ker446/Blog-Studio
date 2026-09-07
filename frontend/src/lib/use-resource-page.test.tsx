import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useResourcePage } from "./use-resource-page";
import type { ResourceQuery } from "./resource-query";

const initialQuery: ResourceQuery = {query:"needle", categoryId:"2", scope:"posts", page:2};
const initial = { page:2, totalPages:3, error:"", data:"server snapshot" };
function pending<T>() { let resolve!: (value:T)=>void; let reject!: (error:Error)=>void; const promise = new Promise<T>((yes,no)=>{resolve=yes;reject=no;}); return {promise,resolve,reject}; }

describe("resource page navigation", () => {
  it("defers initial URL normalization and skips it after a newer navigation", () => {
    let frame!: FrameRequestCallback;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { frame = callback; return 1; });
    const replace = vi.spyOn(window.history, "replaceState");
    renderHook(() => useResourcePage(initial, initialQuery, initialQuery, vi.fn(), "/posts"));
    expect(replace).not.toHaveBeenCalled();
    window.history.pushState(null, "", "/editor?edit=7");
    act(() => frame(0));
    expect(window.location.pathname + window.location.search).toBe("/editor?edit=7");
    expect(replace).not.toHaveBeenCalled();
  });
  beforeEach(() => window.history.replaceState(null,"","/posts?q=needle&category=2&page=2"));
  it("uses the server snapshot and reloads all restored filters without remounting", async () => {
    const load = vi.fn().mockResolvedValue({...initial,data:"restored"});
    const view = renderHook(({query})=>useResourcePage(initial,initialQuery,query,load,"/posts"), {initialProps:{query:initialQuery}});
    expect(load).not.toHaveBeenCalled();
    expect(view.result.current.state.data).toBe("server snapshot");
    const restored = {...initialQuery,categoryId:"0",page:3};
    view.rerender({query:restored});
    await waitFor(()=>expect(view.result.current.state.data).toBe("restored"));
    expect(load).toHaveBeenCalledWith(restored);
  });
  it("retries the failed request with its complete identity and keeps older data", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({...initial,data:"retried"});
    const view=renderHook(()=>useResourcePage(initial,initialQuery,initialQuery,load,"/posts"));
    const target={...initialQuery,query:"new",page:3};
    await act(()=>view.result.current.run(target));
    expect(view.result.current.state).toMatchObject({data:"server snapshot",error:"offline"});
    await act(()=>view.result.current.retry());
    expect(load.mock.calls).toEqual([[target],[target]]);
    expect(view.result.current.state).toMatchObject({data:"retried",error:""});
  });
  it("discards both late successes and late failures while a newer page loads", async () => {
    const old=pending<typeof initial>(), middle=pending<typeof initial>(), newest=pending<typeof initial>();
    const load=vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(middle.promise).mockReturnValueOnce(newest.promise);
    const view=renderHook(()=>useResourcePage(initial,initialQuery,initialQuery,load,"/posts"));
    act(()=>{void view.result.current.run({...initialQuery,page:1});void view.result.current.run({...initialQuery,page:2});void view.result.current.run({...initialQuery,page:3});});
    await act(async()=>{old.resolve({...initial,data:"old"});middle.reject(new Error("late error"));});
    expect(view.result.current.loading).toBe(true);
    expect(view.result.current.state).toMatchObject({data:"server snapshot",error:""});
    await act(async()=>newest.resolve({...initial,page:3,data:"current"}));
    expect(view.result.current.state.data).toBe("current");
    expect(view.result.current.loading).toBe(false);
  });
  it("replaces an empty last page and retries once with the last valid page", async () => {
    const load=vi.fn().mockResolvedValueOnce({...initial,page:3,totalPages:2}).mockResolvedValueOnce({...initial,data:"last page"});
    const replace=vi.spyOn(window.history,"replaceState");
    const view=renderHook(()=>useResourcePage(initial,initialQuery,initialQuery,load,"/posts"));
    await act(()=>view.result.current.run({...initialQuery,page:3}));
    expect(load.mock.calls).toEqual([[{...initialQuery,page:3}],[initialQuery]]);
    expect(new URLSearchParams(window.location.search).get("page")).toBe("2");
    expect(replace).not.toHaveBeenCalled(); // The last valid URL was already canonical.
    expect(view.result.current.state.data).toBe("last page");
  });
  it("corrects an out-of-range server snapshot without adding browser history", async () => {
    window.history.replaceState(null,"","/editor?tab=posts&q=needle&category=2&post_page=8&file_page=4");
    const query={...initialQuery,page:8};
    const load=vi.fn().mockResolvedValueOnce({...initial,page:8,totalPages:1}).mockResolvedValueOnce({...initial,page:1,totalPages:1,data:"only page"});
    const push=vi.spyOn(window.history,"pushState");
    const view=renderHook(()=>useResourcePage({...initial,page:8,totalPages:1},query,query,load,"/editor","post_page"));
    await waitFor(()=>expect(view.result.current.state.data).toBe("only page"));
    expect(load).toHaveBeenLastCalledWith({...query,page:1});
    expect(window.location.search).toBe("?tab=posts&q=needle&category=2&file_page=4");
    expect(push).not.toHaveBeenCalled();
  });
  it("does not load an inactive list, but reconciles it when activated", async () => {
    const target={...initialQuery,page:3};const load=vi.fn().mockResolvedValue({...initial,page:3});
    const view=renderHook(({enabled})=>useResourcePage(initial,initialQuery,target,load,"/posts","page",enabled),{initialProps:{enabled:false}});
    expect(load).not.toHaveBeenCalled();
    view.rerender({enabled:true});
    await waitFor(()=>expect(load).toHaveBeenCalledWith(target));
  });
  it("does not apply results or page corrections after unmount", async () => {
    const request=pending<typeof initial>();const load=vi.fn().mockReturnValue(request.promise);
    const view=renderHook(()=>useResourcePage(initial,initialQuery,initialQuery,load,"/posts"));
    act(()=>{void view.result.current.run({...initialQuery,page:3});});view.unmount();
    await act(async()=>request.resolve({...initial,page:3,totalPages:1}));
    expect(load).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe("?q=needle&category=2&page=2");
  });
  it("does not rewrite the active tab when an inactive request corrects its own page", async () => {
    const request=pending<typeof initial>();
    const load=vi.fn().mockReturnValueOnce(request.promise).mockResolvedValueOnce({...initial,page:1,totalPages:1});
    const view=renderHook(({enabled})=>useResourcePage(initial,initialQuery,initialQuery,load,"/editor","post_page",enabled),{initialProps:{enabled:true}});
    act(()=>{void view.result.current.run({...initialQuery,page:3});});
    view.rerender({enabled:false});
    window.history.replaceState(null,"","/editor?tab=files&q=file&file_page=2");
    await act(async()=>request.resolve({...initial,page:3,totalPages:1}));
    expect(window.location.search).toBe("?tab=files&q=file&file_page=2");
    expect(view.result.current.state.page).toBe(1);
  });
  it("makes a returned load error retryable and bounds repeated page corrections", async () => {
    const load=vi.fn().mockResolvedValueOnce({...initial,error:"load unavailable"}).mockResolvedValue({...initial,page:3,totalPages:1});
    const view=renderHook(()=>useResourcePage(initial,initialQuery,initialQuery,load,"/search"));
    await act(()=>view.result.current.run(initialQuery));
    expect(view.result.current.state.error).toBe("load unavailable");
    await act(()=>view.result.current.retry());
    expect(load).toHaveBeenCalledTimes(3);
  });
});
