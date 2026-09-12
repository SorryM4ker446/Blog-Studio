export function editorReturnPath(value: string | null, articleId: string): string | null {
  if (!value?.startsWith("/editor?")) return null;
  const url = new URL(value, "https://editor.invalid");
  if (url.origin !== "https://editor.invalid" || url.pathname !== "/editor" || url.hash
    || url.searchParams.getAll("edit").length !== 1 || url.searchParams.get("edit") !== articleId
    || (url.searchParams.has("tab") && url.searchParams.get("tab") !== "posts")) return null;
  return `${url.pathname}${url.search}`;
}
