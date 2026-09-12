import { describe, expect, it } from "vitest";
import { readSearchQuery, searchQueryKey, searchSectionQuery, writeSearchQuery } from "./search-query";

const parse = (value: string) => readSearchQuery(new URLSearchParams(value));

describe("advanced search query", () => {
  it("restores separate pages and migrates legacy page links with explicit pages taking precedence", () => {
    expect(parse("q=+needle+&category=0&page=3&post_page=2")).toEqual({ query: "needle", categoryId: "", scope: "all", postPage: 2, filePage: 3 });
    expect(parse("scope=posts&page=2")).toMatchObject({ postPage: 2, filePage: 1 });
    expect(parse("scope=files&page=4")).toMatchObject({ postPage: 1, filePage: 4 });
  });
  it("strictly normalizes duplicated, invalid and inactive pages", () => {
    for (const value of ["2x", "-1", "1000001", "0"]) expect(parse(`post_page=${value}`).postPage).toBe(1);
    expect(parse("page=3&post_page=2&post_page=4&file_page=2x")).toMatchObject({ postPage: 1, filePage: 1 });
    expect(parse("scope=files&post_page=5").postPage).toBe(1);
  });
  it("keeps each kind's request and identity independent of the other page", () => {
    const query = parse("q=needle&category=2&post_page=3&file_page=4");
    expect(searchSectionQuery(query, "posts")).toEqual({ query: "needle", categoryId: "", scope: "posts", page: 3 });
    expect(searchSectionQuery(query, "files")).toEqual({ query: "needle", categoryId: "", scope: "files", page: 4 });
    expect(searchQueryKey(query)).not.toBe(searchQueryKey({ ...query, filePage: 5 }));
  });
  it("canonicalizes legacy URLs while dropping categories outside posts scope", () => {
    window.history.replaceState(null, "", "/search?q=needle&page=2&category=3&extra=keep");
    writeSearchQuery(parse(window.location.search), true);
    expect(window.location.search).toBe("?q=needle&extra=keep&post_page=2&file_page=2");
    writeSearchQuery({ ...parse(window.location.search), scope: "files", filePage: 1 });
    expect(window.location.search).toBe("?q=needle&extra=keep&scope=files");
  });
  it("only applies article categories in posts scope", () => {
    const posts = parse("q=needle&scope=posts&category=2");
    expect(posts.categoryId).toBe("2");
    expect(searchSectionQuery(posts, "posts").categoryId).toBe("2");
    expect(searchSectionQuery({ ...posts, scope: "all" }, "posts").categoryId).toBe("");
    expect(parse("scope=files&category=2").categoryId).toBe("");
    expect(parse("scope=all&category=2").categoryId).toBe("");
  });

});
