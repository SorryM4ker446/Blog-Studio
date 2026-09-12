import { readResourceQuery, resourceURL, setResourceQuery, type ResourceQuery, type SearchScope } from "./resource-query";

export interface SearchQuery {
  query: string;
  categoryId: string;
  scope: SearchScope;
  postPage: number;
  filePage: number;
}

type QueryInput = Parameters<typeof readResourceQuery>[0];

export function readSearchQuery(params: QueryInput): SearchQuery {
  const base = readResourceQuery(params);
  const page = (key: string) => params.getAll(key).length
    ? readResourceQuery(params, undefined, key).page : base.page;
  return { query: base.query, categoryId: base.scope === "posts" ? base.categoryId : "", scope: base.scope,
    postPage: base.scope === "files" ? 1 : page("post_page"),
    filePage: base.scope === "posts" ? 1 : page("file_page") };
}

export function searchQueryKey(query: SearchQuery): string {
  return JSON.stringify([query.query, query.categoryId, query.scope, query.postPage, query.filePage]);
}

export function searchSectionQuery(query: SearchQuery, scope: "posts" | "files"): ResourceQuery {
  return { query: query.query, categoryId: query.scope === "posts" && scope === "posts" ? query.categoryId : "", scope,
    page: scope === "posts" ? query.postPage : query.filePage };
}

export function writeSearchQuery(query: SearchQuery, replace = false): void {
  const params = new URLSearchParams(window.location.search);
  params.delete("page");
  setResourceQuery(params, { ...query, categoryId: query.scope === "posts" ? query.categoryId : "", page: query.scope === "files" ? 1 : query.postPage }, "post_page", true);
  if (query.scope !== "posts" && query.filePage > 1) params.set("file_page", String(query.filePage));
  else params.delete("file_page");
  const url = resourceURL("/search", params);
  if (url !== `${window.location.pathname}${window.location.search}`) {
    window.history[replace ? "replaceState" : "pushState"](null, "", url);
  }
}
