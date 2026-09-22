export type SearchScope = "all" | "posts" | "files";
export interface ResourceQuery { query: string; categoryId: string; scope: SearchScope; page: number }
type QueryInput = { get(name: string): string | null; getAll(name: string): string[] };
export type ServerSearchParams = Record<string, string | string[] | undefined>;

export function toSearchParams(input: ServerSearchParams): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string") params.set(key, value);
    else if (Array.isArray(value)) for (const item of value) params.append(key, item);
  }
  return params;
}

function single(params: QueryInput, name: string): string {
  return params.getAll(name).length === 1 ? params.get(name) || "" : "";
}

export function readPage(value: string): number {
  const page = /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(page) && page >= 1 && page <= 1_000_000 ? page : 1;
}

export function readResourceQuery(params: QueryInput, fixedScope?: SearchScope, pageKey = "page"): ResourceQuery {
  const category = single(params, "category");
  const categoryNumber = /^\d+$/.test(category) ? Number(category) : NaN;
  const scope = single(params, "scope");
  return {
    query: single(params, "q").trim(),
    categoryId: fixedScope !== "files" && Number.isSafeInteger(categoryNumber) && categoryNumber >= 0 ? String(categoryNumber) : "",
    scope: fixedScope || (scope === "posts" || scope === "files" ? scope : "all"),
    page: readPage(single(params, pageKey)),
  };
}

export function readEditorTab(params: QueryInput): "posts" | "files" | "links" { const tab = single(params, "tab"); return tab === "files" || tab === "links" ? tab : "posts"; }

export type EditorTarget = number | "new" | null;

export function readEditorDraft(params: QueryInput): string {
  const value = single(params, "draft");
  return /^[a-zA-Z0-9-]{1,80}$/.test(value) ? value : "";
}

export function readEditorTarget(params: QueryInput): EditorTarget {
  if (readEditorTab(params) !== "posts") return null;
  const value = single(params, "edit");
  if (value === "new") return "new";
  const id = /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function writeEditorTarget(target: EditorTarget, replace = false): void {
  const params = new URLSearchParams(window.location.search);
  if (target !== "new") params.delete("draft");
  else if (readEditorTarget(params) !== "new" || !readEditorDraft(params)) params.set("draft", crypto.randomUUID());
  if (target === null) params.delete("edit");
  else { params.set("tab", "posts"); params.set("edit", String(target)); }
  const url = resourceURL("/editor", params);
  if (url !== `${window.location.pathname}${window.location.search}`) {
    window.history[replace ? "replaceState" : "pushState"](null, "", url);
  }
}

export function resourceQueryKey(query: ResourceQuery): string {
  return JSON.stringify([query.query, query.categoryId, query.scope, query.page]);
}

export function searchAPIParams(query: ResourceQuery, limit = 10): URLSearchParams {
  return new URLSearchParams({ q: query.query, scope: query.scope, page: String(query.page), limit: String(limit),
    ...(query.categoryId ? { category_id: query.categoryId } : {}) });
}

export function resourceURL(path: string, params: URLSearchParams): string {
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export function setResourceQuery(params: URLSearchParams, query: ResourceQuery, pageKey = "page", includeScope = false): void {
  for (const [key, value] of [["q", query.query], ["category", query.categoryId], [pageKey, query.page > 1 ? String(query.page) : ""]]) {
    if (value) params.set(key, value); else params.delete(key);
  }
  if (includeScope) { if (query.scope === "all") params.delete("scope"); else params.set("scope", query.scope); }
}

export function writeResourceQuery(path: string, query: ResourceQuery, options: { replace?: boolean; pageKey?: string; includeScope?: boolean } = {}): void {
  const params = new URLSearchParams(window.location.search);
  if (path === "/editor") {
    params.set("tab", readEditorTab(params));
    const inactivePageKey = options.pageKey === "file_page" ? "post_page" : "file_page";
    const inactivePage = readPage(single(params, inactivePageKey));
    if (inactivePage > 1) params.set(inactivePageKey, String(inactivePage)); else params.delete(inactivePageKey);
  }
  setResourceQuery(params, query, options.pageKey, options.includeScope);
  const url = resourceURL(path, params);
  if (url === `${window.location.pathname}${window.location.search}`) return;
  window.history[options.replace ? "replaceState" : "pushState"](null, "", url);
}
