import { beforeEach, describe, expect, it, vi } from "vitest";
import { readPage, readResourceQuery, readEditorTarget, writeEditorTarget, resourceQueryKey, resourceURL, searchAPIParams, setResourceQuery, toSearchParams, writeResourceQuery, type ResourceQuery } from "./resource-query";

const query: ResourceQuery = { query: "中文 & traces", categoryId: "2", scope: "posts", page: 3 };

describe("resource URL contracts", () => {
  it("reads explicit editor targets and rejects ambiguous or invalid IDs", () => {
    expect(readEditorTarget(new URLSearchParams("edit=new"))).toBe("new");
    expect(readEditorTarget(new URLSearchParams("edit=0007"))).toBe(7);
    for (const query of ["", "edit=0", "edit=-1", "edit=7abc", "edit=1.5", "edit=9007199254740993", "edit=7&edit=8", "tab=files&edit=7"]) {
      expect(readEditorTarget(new URLSearchParams(query))).toBeNull();
    }
  });

  it("keeps list filters while opening an editor and replaces a new draft with its saved ID", () => {
    window.history.replaceState(null, "", "/editor?tab=posts&q=needle&category=2&post_page=3&file_page=4");
    const push = vi.spyOn(window.history, "pushState");
    const replace = vi.spyOn(window.history, "replaceState");
    writeEditorTarget("new");
    expect(push).toHaveBeenCalledTimes(1);
    writeEditorTarget(7, true);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(readEditorTarget(new URLSearchParams(window.location.search))).toBe(7);
    writeEditorTarget(null, true);
    expect(window.location.search).toBe("?tab=posts&q=needle&category=2&post_page=3&file_page=4");
  });
  beforeEach(() => { window.history.replaceState(null, "", "/search"); });
  it.each(["", "0", "-1", "+2", "1.5", "2abc", "1000001", "9007199254740993", "１", " 2 "])("normalizes invalid page %j", (raw) => {
    expect(readPage(raw)).toBe(1);
  });
  it.each([["0002", 2], ["1000000", 1_000_000]])("accepts decimal page %s", (raw, value) => { expect(readPage(raw as string)).toBe(value); });
  it("shares strict parsing between server and browser, including duplicate values", () => {
    const params = toSearchParams({ q: ["first", "second"], category: "0002", scope: "unsupported", page: ["2", "3"], absent: undefined });
    expect(readResourceQuery(params)).toEqual({ query: "", categoryId: "2", scope: "all", page: 1 });
    expect(readResourceQuery(new URLSearchParams("q=+中+&category=0&scope=files&file_page=2"), undefined, "file_page")).toEqual({ query: "中", categoryId: "0", scope: "files", page: 2 });
    expect(readResourceQuery(new URLSearchParams("scope=files"), "posts").scope).toBe("posts");
    for (const category of ["no", "-1", "9007199254740993"]) expect(readResourceQuery(new URLSearchParams({ category })).categoryId).toBe("");
    expect(readResourceQuery(new URLSearchParams("category=1&category=2")).categoryId).toBe("");
  });
  it("encodes API filters without sharing URL parameter names or losing the page", () => {
    expect(Object.fromEntries(searchAPIParams(query, 25))).toEqual({ q: query.query, scope: "posts", category_id: "2", page: "3", limit: "25" });
    expect(Object.fromEntries(searchAPIParams({ ...query, categoryId: "" }))).toEqual({ q: query.query, scope: "posts", page: "3", limit: "10" });
    for (const patch of [{query: "other"}, {categoryId: "0"}, {scope: "all" as const}, {page: 4}]) expect(resourceQueryKey({...query, ...patch})).not.toBe(resourceQueryKey(query));
  });
  it("normalizes editor tabs and both page fields while discarding file category filters", () => {
    window.history.replaceState(null, "", "/editor?tab=files&tab=posts&post_page=bad&file_page=0002&category=3");
    const parsed = readResourceQuery(new URLSearchParams(window.location.search), "files", "file_page");
    expect(parsed.categoryId).toBe("");
    writeResourceQuery("/editor", parsed, { pageKey: "file_page", replace: true });
    expect(window.location.search).toBe("?tab=posts&file_page=2");
  });
  it("retains unrelated state, resets defaults, and keeps history updates idempotent", () => {
    window.history.replaceState(null, "", "/editor?tab=posts&file_page=7&post_page=5&keep=value");
    const push = vi.spyOn(window.history, "pushState");
    const replace = vi.spyOn(window.history, "replaceState");
    writeResourceQuery("/editor", query, { pageKey: "post_page" });
    expect(push).toHaveBeenCalledTimes(1);
    expect(new URLSearchParams(window.location.search).get("file_page")).toBe("7");
    writeResourceQuery("/editor", query, { pageKey: "post_page" });
    expect(push).toHaveBeenCalledTimes(1);
    writeResourceQuery("/editor", { ...query, query: "", categoryId: "", page: 1 }, { pageKey: "post_page", replace: true });
    expect(replace).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe("?tab=posts&file_page=7&keep=value");
    const params = new URLSearchParams();
    setResourceQuery(params, query, "page", true);
    expect(params.get("scope")).toBe("posts");
    setResourceQuery(params, {query:"", categoryId:"", scope:"all", page:1}, "page", true);
    expect(resourceURL("/search", params)).toBe("/search");
  });
});
